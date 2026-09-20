import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createApprovalManager,
  createHarness,
  createPluginStore,
  createSessionsCommand,
  envStr,
  type Harness,
  importModule,
  loadAgents,
  type Plugin,
  readConfig,
} from 'mu-coding';
import { type ChannelAdapter, serveHost, webSocketAdapter, type WireModel } from 'arya-core';
import {
  BrowserController,
  createBrowserTools,
  registerDefaultBrowserProviders,
  selectBrowserProvider,
  type BrowserSession,
  PcController,
  createPcTools,
  createVisionTools,
  TaskStore,
  createTaskTools,
  toWireTaskEvent,
  MemoryStore,
  createMemoryTools,
  createMemoryHook,
  createTelegramAdapter,
  createAdminServer,
  AdminAuth,
  priorityRank,
  type TaskStatus,
  type WirePanelItem,
  type WirePanelSection,
} from 'arya-core';
import { createLocalProvider, listLocalModels, type LocalProviderConfig } from 'mu-local-provider';
import { createMuTools } from 'mu-tools';
import webfetchPlugin from 'mu-webfetch';

import { aryaDirs, resolveXdg } from './xdg';
import { isLoopbackHost, isValidPort } from './init';
import { BUILTIN_AGENTS } from './default-agents';
import { BUILTIN_SKILLS } from './default-skills';
import { createScheduler, type Scheduler } from './scheduler';
import { withCallModeReasoning } from './voice-routing';
import { watchDefinitions } from 'mu-coding';
import { errMsg } from 'mu-core';

type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3, silent: 4 };
function makeLog(scope: string, levelEnvVar: string) {
  const raw = (process.env[levelEnvVar] ?? 'info').toLowerCase();
  const level: LogLevel = (raw in LEVEL_ORDER ? raw : 'info') as LogLevel;
  const threshold = LEVEL_ORDER[level];
  const at = (lvl: LogLevel) => LEVEL_ORDER[lvl] >= threshold;
  return {
    debug: (msg: string) => at('debug') && console.log(`[${scope}] ${msg}`),
    info: (msg: string) => at('info') && console.log(`[${scope}] ${msg}`),
    warn: (msg: string) => at('warn') && console.warn(`[${scope}] ${msg}`),
    error: (msg: string) => at('error') && console.error(`[${scope}] ${msg}`),
  };
}
const log = makeLog('arya', 'ARYA_LOG_LEVEL');

export interface PanelItemConfig {
  label: string;
  value?: string;
  status?: 'running' | 'done' | 'error';
  marker?: string;
}

export interface PanelSectionConfig {
  title: string;
  /** Built-in live source. 'tasks' renders the TaskStore as panel rows. */
  source?: 'tasks';
  /** Static rows (key/value or labeled). Used when `source` is unset. */
  items?: PanelItemConfig[];
}

export interface BootstrapConfig {
  kind?: LocalProviderConfig['kind'];
  baseUrl: string;
  model: string;
  apiKey?: string;
  wsPort: number;
  wsHost?: string;
  authToken?: string;
  primaryAgent?: string;
  agentsDir?: string;
  tasksDir?: string;
  /** Modalities the configured model accepts. Image/audio attachments are dropped when off. */
  capabilities?: { vision?: boolean; audio?: boolean };
  /** Speech-to-text model for `/voice`; falls back to the selected model when unset. */
  voiceModel?: string;
  /** Extra `chat_template_kwargs` for the MAIN model's requests (not the voice model).
   * E.g. `{ "enable_thinking": false }` to turn off Qwen3 reasoning in chat. */
  chatTemplateKwargs?: Record<string, unknown>;
  /** Chrome DevTools Protocol endpoint for browser control (Chrome launched with
   * --remote-debugging-port). Env fallback: ARYA_CDP_URL. */
  cdpUrl?: string;
  /** Browser backend: 'remote' | 'obscura' | 'local'. When unset, auto-selects
   * (cdpUrl → remote, else first available of obscura/local). Env: ARYA_BROWSER_PROVIDER. */
  browserProvider?: string;
  /** Port for the admin dashboard (HTTP + /admin WS). Unset = admin disabled.
   * Env: ARYA_ADMIN_PORT. Auth: login/password via the SQLite-backed AdminAuth. */
  adminPort?: number;
  /** Admin login credentials, seeded into SQLite on first boot. Env:
   * ARYA_ADMIN_USER / ARYA_ADMIN_PASSWORD. Defaults to admin/admin (change it). */
  adminUser?: string;
  adminPassword?: string;
  /** Vision model for `screen_analyze` (halogen has no vision). Env fallbacks:
   * ARYA_VISION_BASE_URL / ARYA_VISION_MODEL / ARYA_VISION_API_KEY. */
  vision?: { baseUrl: string; model: string; apiKey?: string };
  /** Telegram bot channel. When `botToken` is set, arya long-polls the Bot API and
   * bridges each chat to a session. Env: TELEGRAM_BOT_TOKEN / TELEGRAM_ALLOWED_CHAT_IDS
   * (comma-separated). */
  telegram?: { botToken: string; allowedChatIds?: number[] };
  /** TLS for the WS + admin servers: PEM key + cert file paths. When set, both
   * serve over https/wss. Env: ARYA_TLS_KEY / ARYA_TLS_CERT. */
  tls?: { keyPath: string; certPath: string };
  /** Declarative side-panel sections pushed to connected TUI clients. Each section
   * is a built-in live source (e.g. 'tasks') or a static list of items. */
  panel?: PanelSectionConfig[];
}

const isPlugin = (value: unknown): value is Plugin =>
  typeof value === 'object' && value !== null && typeof (value as { name?: unknown }).name === 'string';

async function loadInstalledPlugins(pluginsDir: string, skip: Set<string>): Promise<Plugin[]> {
  const store = createPluginStore({ dir: pluginsDir });
  const out: Plugin[] = [];
  for (const name of await store.list()) {
    if (!/\.(?:[cm]?ts|tsx)$/.test(name)) continue;
    try {
      const mod = await importModule(join(pluginsDir, name));
      const plugin = mod.default;
      if (!isPlugin(plugin)) {
        log.warn(`plugin "${name}" has no valid default export — skipping`);
        continue;
      }
      if (skip.has(plugin.name)) {
        log.warn(`plugin "${name}" (${plugin.name}) shadows a built-in — skipping`);
        continue;
      }
      skip.add(plugin.name);
      out.push(plugin);
      log.info(`loaded plugin "${plugin.name}" from ${name}`);
    } catch (err) {
      log.error(`failed to load plugin "${name}": ${errMsg(err)}`);
    }
  }
  return out;
}

function validatePort(value: unknown): number {
  if (!isValidPort(value)) {
    throw new Error(`[arya] Invalid wsPort: ${JSON.stringify(value)}. Must be an integer in [1, 65535].`);
  }
  return value as number;
}

function validateConfig(obj: Record<string, unknown>, configPath: string | undefined, cwd: string): BootstrapConfig {
  const r = readConfig(obj);
  const missing: string[] = [];
  if (!r.str('baseUrl')) missing.push('baseUrl');
  if (!r.str('model')) missing.push('model');
  if (r.raw('wsPort') == null) missing.push('wsPort');
  if (missing.length > 0) {
    throw new Error(
      `[arya] Missing required config field(s): ${missing.join(', ')}.\n` +
        `       Run \`arya init\` to set them up interactively, or edit ${configPath ?? '~/.config/arya/config.json'}.`,
    );
  }

  const wsPort = validatePort(obj.wsPort);
  const wsHost = r.str('wsHost', '127.0.0.1');
  const authToken = r.str('authToken');
  const apiKey = r.str('apiKey');
  const kind = r.str('kind') as LocalProviderConfig['kind'] | undefined;
  const primaryAgent = r.str('primaryAgent');
  const agentsDir = r.str('agentsDir', join(cwd, 'definitions', 'agents'));
  const tasksDir = r.str('tasksDir', join(cwd, 'definitions', 'tasks'));
  const caps = r.obj('capabilities');
  const capabilities = { vision: caps.vision === true, audio: caps.audio === true };

  if (!authToken) {
    if (!isLoopbackHost(wsHost)) {
      throw new Error(
        `[arya] Refusing to start: authToken is empty/missing and wsHost is "${wsHost}" (non-loopback).\n` +
          `       Set a non-empty "authToken" in your config, or set "wsHost": "127.0.0.1".`,
      );
    }
    log.info(
      `[arya] WARNING: authToken is empty — relying on loopback-only bind (${wsHost}). Set authToken to harden.`,
    );
  }

  const ctk = r.raw('chatTemplateKwargs');
  const adminPortNum = r.num('adminPort');
  const envAdminPort = envStr('ARYA_ADMIN_PORT');
  const vr = readConfig(r.obj('vision'));
  const tr = readConfig(r.obj('telegram'));
  const tl = readConfig(r.obj('tls'));

  return {
    kind,
    baseUrl: r.str('baseUrl') as string,
    model: r.str('model') as string,
    apiKey,
    wsPort,
    wsHost,
    authToken,
    primaryAgent,
    agentsDir,
    tasksDir,
    capabilities,
    voiceModel: r.str('voiceModel'),
    chatTemplateKwargs: ctk && typeof ctk === 'object' ? r.obj('chatTemplateKwargs') : undefined,
    cdpUrl: r.str('cdpUrl') ?? envStr('ARYA_CDP_URL'),
    browserProvider: r.str('browserProvider') ?? envStr('ARYA_BROWSER_PROVIDER'),
    adminPort: (adminPortNum && adminPortNum > 0 ? adminPortNum : undefined) ?? (envAdminPort ? Number(envAdminPort) : undefined),
    adminUser: r.str('adminUser') ?? envStr('ARYA_ADMIN_USER'),
    adminPassword: r.str('adminPassword') ?? envStr('ARYA_ADMIN_PASSWORD'),
    vision: (() => {
      const baseUrl = vr.str('baseUrl') ?? envStr('ARYA_VISION_BASE_URL');
      const model = vr.str('model') ?? envStr('ARYA_VISION_MODEL');
      if (!baseUrl || !model) return undefined;
      return { baseUrl, model, apiKey: vr.str('apiKey') ?? envStr('ARYA_VISION_API_KEY') };
    })(),
    telegram: (() => {
      const botToken = tr.str('botToken') ?? envStr('TELEGRAM_BOT_TOKEN');
      if (!botToken) return undefined;
      const rawAllowed =
        tr.arr('allowedChatIds') ??
        (envStr('TELEGRAM_ALLOWED_CHAT_IDS') ? envStr('TELEGRAM_ALLOWED_CHAT_IDS')!.split(',') : undefined);
      const allowedChatIds = rawAllowed
        ?.map((v) => Number(typeof v === 'string' ? v.trim() : v))
        .filter((n) => Number.isFinite(n));
      return { botToken, allowedChatIds: allowedChatIds && allowedChatIds.length ? allowedChatIds : undefined };
    })(),
    tls: (() => {
      const keyPath = tl.str('keyPath') ?? envStr('ARYA_TLS_KEY');
      const certPath = tl.str('certPath') ?? envStr('ARYA_TLS_CERT');
      if (!keyPath && !certPath) return undefined;
      if (!keyPath || !certPath) {
        log.warn(
          `[arya] TLS half-configured (key=${keyPath ? 'set' : 'missing'}, cert=${certPath ? 'set' : 'missing'}) — TLS DISABLED, serving in cleartext. Set both keyPath+certPath.`,
        );
        return undefined;
      }
      return { keyPath, certPath };
    })(),
    panel: (r.arr('panel') as PanelSectionConfig[] | undefined) ?? undefined,
  };
}

export function loadConfig(cwd: string, configPath?: string): BootstrapConfig {
  if (!configPath) return validateConfig({}, undefined, cwd);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  } catch (err) {
    const msg = errMsg(err);
    throw new Error(`[arya] Failed to load config from ${configPath}: ${msg}`);
  }
  return validateConfig(parsed, configPath, cwd);
}

export interface BootstrapHandle {
  shutdown: () => Promise<void>;
}

async function buildHarness(cwd: string, config: BootstrapConfig) {
  const xdg = resolveXdg();
  const primaryName = config.primaryAgent ?? 'arya';
  const agentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  // Definitions (agents/tasks/skills) are authored as files via the `write` tool
  // (guided by the create-* skills) and hot-reloaded — no dedicated create_* tools.
  const tools = createMuTools({ getCwd: () => cwd });
  // Hermes-style control: browser (CDP) + PC (keyboard/mouse/windows/launch/shot)
  // + vision-on-demand. The browser backend is a BrowserProvider that owns the
  // browser lifecycle and hands back a CDP endpoint; the shared BrowserController
  // drives the page. PC tools always (they self-report the detected desktop);
  // vision tool always (reports "not configured" until a vision model is wired).
  registerDefaultBrowserProviders();
  const provider = selectBrowserProvider({
    provider: config.browserProvider,
    cdpUrl: config.cdpUrl,
  });
  let browser: BrowserController | undefined;
  let browserSession: BrowserSession | undefined;
  if (provider?.isAvailable()) {
    try {
      browserSession = await provider.createSession('arya');
      browser = new BrowserController({ cdpUrl: browserSession.cdpUrl });
      log.info(`browser: using provider '${provider.name}' → ${browserSession.cdpUrl}`);
    } catch (err) {
      log.warn(`browser: provider '${provider.name}' failed: ${errMsg(err)}`);
    }
  }
  const pc = new PcController();
  // Kanban task board: a file-backed store (definitions/tasks/*.yaml) that both
  // humans and agents drive. Events are pushed to the WS adapter in bootstrap().
  const taskStore = new TaskStore(config.tasksDir ?? join(cwd, 'definitions', 'tasks'));
  taskStore.load();
  // Long-term memory: a bounded, file-backed curated store (MEMORY.md / USER.md)
  // the agent drives, injected into the system prompt each turn via the memory
  // hook. Lives in the arya data home as plain markdown you can `cat` and diff.
  const memoryStore = new MemoryStore(join(xdg.dataHome, 'arya', 'memory'));
  const controlTools = [
    ...(browser ? createBrowserTools(browser) : []),
    ...createPcTools(pc),
    ...createVisionTools({ capture: () => pc.screenshot(), vision: config.vision }),
    ...createTaskTools(taskStore),
    ...createMemoryTools(memoryStore),
  ];
  const allTools = [...tools, ...controlTools];
  const builtinPlugins: Plugin[] = [webfetchPlugin];
  const installedPlugins = await loadInstalledPlugins(
    aryaDirs('arya').pluginsDir,
    new Set(builtinPlugins.map((p) => p.name)),
  );
  const plugins = [...builtinPlugins, ...installedPlugins];
  const approvals = createApprovalManager();

  const configAgents = await loadAgents(join(xdg.configHome, 'arya', 'agents'));
  const projectAgents = config.agentsDir && existsSync(config.agentsDir) ? await loadAgents(config.agentsDir) : [];
  const userAgents = [...projectAgents, ...configAgents];
  // Built-in agents fill in only when the user hasn't defined one by the same
  // name, so arya always exists (with its color) even with no agent .md on disk.
  const builtinAgents = BUILTIN_AGENTS.filter((b) => !userAgents.some((u) => u.name === b.name));
  const allAgents = [...userAgents, ...builtinAgents];

  const primary = allAgents.find((a) => a.name === primaryName) ?? allAgents[0];

  let harnessRef: Harness | undefined;
  // Filled in by bootstrap once the WS adapter exists; the provider fires onModelInfo
  // lazily on the first model load, which routes detected modalities into the adapter.
  const capsSink: { apply?: (caps: { vision: boolean; audio: boolean }) => void } = {};
  const modelLoadingSink: { apply?: (model: string, loading: boolean) => void } = {};
  const harness = await createHarness({
    hostName: 'arya',
    xdg,
    cwd,
    providers: {
      // Wrap the provider so a call-mode turn (carrying the zero-width marker) disables
      // the chat model's reasoning for that one turn — fast spoken replies. Speech-to-text
      // itself rides the session-less `voice:transcribe` endpoint (harness.voice), not the
      // chat path. See voice-routing.ts.
      local: withCallModeReasoning(
        createLocalProvider({
          kind: config.kind,
          baseUrl: config.baseUrl,
          model: config.model,
          apiKey: config.apiKey,
          // llama.cpp reports input modalities in /props (read for free alongside the context
          // window). When present, they OVERRIDE the manual `capabilities` config flag.
          onModelInfo: ({ modalities }) => {
            if (modalities) capsSink.apply?.({ vision: modalities.vision, audio: modalities.audio });
          },
          // Cold-start on the first message → surface a loader to all channels.
          onModelLoading: (model, loading) => modelLoadingSink.apply?.(model, loading),
          // Extra chat-template kwargs (main model only) — e.g. disable Qwen3 reasoning.
          chatTemplateKwargs: config.chatTemplateKwargs,
        }),
        { log: (msg) => log.info(msg) },
      ),
    },
    model: `local/${config.model}`,
    tools: allTools,
    plugins,
    voice: { model: config.voiceModel },
    approvals: {
      manager: approvals,
      // Read the live registry so a hot-reloaded primary's grants take effect.
      activeAgent: () => harnessRef?.agents.get(primaryName) ?? primary,
    },
    // Built-in arya is the lowest-priority fallback; the harness loads the real
    // agents from agentDirs (definitions/agents + global config) and an override
    // of the same name wins. mergedAgents() re-reads these dirs on reload.
    defaultAgents: BUILTIN_AGENTS,
    // Skills embedded in the binary (the manage-* authoring skills), always
    // available via the `skill` tool regardless of cwd; disk skills can override.
    skills: BUILTIN_SKILLS,
    // Inject the curated memory digest + persistence nudge into every turn.
    hooks: createMemoryHook(memoryStore),
    system: primary?.prompt,
    sourceUrl: 'https://github.com/gaetan-puleo/arya',
    title: true,
    // Agent dirs loaded (and watched) at boot: the repo's definitions/agents and
    // the global config dir; a same-named override there wins over the built-in.
    agentDirs: { local: agentsDir, config: join(xdg.configHome, 'arya', 'agents') },
  });
  harnessRef = harness;

  return { harness, approvals, primaryName, capsSink, modelLoadingSink, browser, provider, browserSession, taskStore, memoryStore };
}

/** Read TLS key/cert PEM once, shared by the WS + admin servers. */
function loadTls(config: BootstrapConfig, log: ReturnType<typeof makeLog>): { key: string; cert: string } | undefined {
  if (!config.tls) return undefined;
  try {
    const tls = {
      key: readFileSync(config.tls.keyPath, 'utf-8'),
      cert: readFileSync(config.tls.certPath, 'utf-8'),
    };
    log.info(`TLS enabled — key: ${config.tls.keyPath}, cert: ${config.tls.certPath}`);
    return tls;
  } catch (err) {
    throw new Error(
      `[arya] TLS enabled but could not read key/cert: ${errMsg(err)}`,
    );
  }
}

const taskStatusToPanel = (s: TaskStatus): 'running' | 'done' | 'error' | undefined => {
  if (s === 'done') return 'done';
  if (s === 'in_progress' || s === 'in_review') return 'running';
  return undefined;
};

/**
 * Build the live side-panel provider from declarative config. Each configured
 * section is either a built-in source ('tasks', read live from the TaskStore) or a
 * static list of items. The returned closure is cheap to call on every task event.
 */
export function buildPanelProvider(config: BootstrapConfig, taskStore: TaskStore): () => WirePanelSection[] {
  const sections = config.panel ?? [];
  return () =>
    sections.map((s) => {
      if (s.source === 'tasks') {
        const items: WirePanelItem[] = taskStore
          .list()
          .sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority))
          .map((t) => ({ label: t.title, status: taskStatusToPanel(t.status) }));
        return { title: s.title, items };
      }
      return { title: s.title, items: (s.items ?? []).map((i) => ({ ...i })) };
    });
}

/** Admin dashboard (HTTP + /admin WS): kanban + sub-agent CRUD, SQLite-backed
 * login seeded from config. Returns undefined when adminPort is not configured. */
function wireAdmin(
  config: BootstrapConfig,
  cwd: string,
  taskStore: TaskStore,
  tls: { key: string; cert: string } | undefined,
  log: ReturnType<typeof makeLog>,
): { admin: { listen: () => Promise<void>; close: () => Promise<void> }; adminAuth: AdminAuth } | undefined {
  if (!config.adminPort) return undefined;
  const adminAgentsDir = config.agentsDir ?? join(cwd, 'definitions', 'agents');
  const dbPath = join(resolveXdg().dataHome, 'arya', 'admin.db');
  const adminAuth = new AdminAuth(dbPath);
  const user = config.adminUser ?? 'admin';
  if (config.adminPassword) {
    // Config password is authoritative: insert or update the hash so a later
    // config change actually takes effect (a seeded admin/admin must not survive).
    const res = adminAuth.upsertUser(user, config.adminPassword);
    if (res === 'updated') log.info(`admin: password updated for "${user}" from config`);
  } else if (!adminAuth.hasUsers()) {
    adminAuth.ensureUser('admin', 'admin');
    log.warn('admin: seeded default user "admin"/"admin" — set adminUser/adminPassword and change it');
  }
  const admin = createAdminServer({
    port: config.adminPort,
    host: config.wsHost,
    auth: adminAuth,
    taskStore,
    agentsDir: adminAgentsDir,
    chatPort: config.wsPort,
    chatToken: config.authToken,
    tls,
    log: (msg) => log.info(`admin: ${msg}`),
  });
  return { admin, adminAuth };
}

export async function bootstrap(cwd: string = process.cwd(), configPath?: string): Promise<BootstrapHandle> {
  const config = loadConfig(cwd, configPath);
  const { harness, approvals, primaryName, capsSink, modelLoadingSink, browser, provider, browserSession, taskStore, memoryStore } =
    await buildHarness(cwd, config);

  harness.commands.register(createSessionsCommand(harness.sessions), { override: true });

  log.info(`Bootstrap — cwd: ${cwd}`);
  log.info(`Config — baseUrl: ${config.baseUrl}, model: ${config.model}`);
  log.info(`Loaded ${harness.agents.list().length} agent(s); primary: ${primaryName}`);

  // TLS material is read once and shared by the WS + admin servers.
  const tls = loadTls(config, log);

  const panelProvider = buildPanelProvider(config, taskStore);

  const adapter = webSocketAdapter({
    port: config.wsPort,
    host: config.wsHost,
    authToken: config.authToken,
    activeAgentId: primaryName,
    capabilities: config.capabilities,
    tls,
    panelProvider,
    // Image attachments are base64 in the chat frame — well above the 1MB default.
    maxPayloadBytes: 16 * 1024 * 1024,
    listModels: async (): Promise<WireModel[]> =>
      (await listLocalModels({ kind: config.kind, baseUrl: config.baseUrl, apiKey: config.apiKey }))
        .map((m) => ({ id: m.id, ownedBy: m.ownedBy })),
    log: (msg) => log.info(`ws: ${msg}`),
  });

  // Kanban board: every store mutation (agent or manual) is broadcast to all WS
  // clients as a `task_event` so board views stay in sync.
  taskStore.onEvent((e) => {
    adapter.push({ type: 'task_event', event: toWireTaskEvent(e) });
    adapter.push({ type: 'panel:update', sections: panelProvider() });
  });

  // Admin dashboard (HTTP + /admin WS): kanban + sub-agent CRUD. Auth is a
  // login/password backed by SQLite; the admin user is seeded from config on
  // first boot. Started only when adminPort is configured.
  const wired = wireAdmin(config, cwd, taskStore, tls, log);
  const admin = wired?.admin;
  const adminAuth = wired?.adminAuth;
  if (admin) {
    await admin.listen();
    log.info(`Admin dashboard — ${tls ? 'https' : 'http'}://${config.wsHost}:${config.adminPort}/ (login: ${config.adminUser ?? 'admin'})`);
  }

  // Now that the adapter exists, route detected modalities into it. Until the first model
  // load fires this, clients see the manual `capabilities` config flag the adapter started with.
  capsSink.apply = (caps) => {
    log.info(`model capabilities detected — vision:${caps.vision} audio:${caps.audio}`);
    adapter.setCapabilities(caps);
  };
  modelLoadingSink.apply = (model, loading) =>
    adapter.push({ type: 'model_loading', model: `local/${model}`, loading });

  // The host (channel adapter + background services + lifecycle) is assembled at
  // the end via serveHost, once the scheduler and watcher exist.

  // Voice (companion call mode): the companion records audio and transcribes each
  // segment through the session-less `voice:transcribe` endpoint (harness.voice, the
  // voice model only — no session/persistence), then sends the concatenated transcript
  // as a normal text chat turn answered by the main model.

  // Eagerly detect the configured model's input modalities (vision/audio) so the
  // server advertises real capabilities from the start — no manual `capabilities`
  // config flag needed. Without this, caps only refine on the first model load
  // (after that turn's attachments were already filtered), so the first image/
  // audio turn would be dropped. Probing /props loads the model (a llama-swap
  // cold start), so run it in the background and broadcast once it resolves;
  // mirrors mu's coding-agent. setCapabilities is idempotent with the later
  // onModelInfo path.
  void harness.models.capabilities()
    .then((modalities) => {
      if (modalities) {
        log.info(`detected model capabilities — vision:${modalities.vision} audio:${modalities.audio}`);
        adapter.setCapabilities({ vision: modalities.vision, audio: modalities.audio });
      }
    })
    .catch((err) => log.warn(`capability probe failed: ${errMsg(err)}`));

  let scheduler: Scheduler | undefined;
  let schedulerStateFile: string | undefined;
  if (config.tasksDir) {
    schedulerStateFile = join(resolveXdg().dataHome, 'arya', 'scheduler-state.json');
    scheduler = createScheduler({
      tasksDir: config.tasksDir,
      statePath: schedulerStateFile,
      runTask: (agent, prompt) => harness.dispatchSubAgent(agent || primaryName, prompt, '').then((r) => r.text),
      onEvent: (event) => adapter.push({ type: 'scheduler_event', event }),
      log: (msg) => log.info(`scheduler: ${msg}`),
    });
    log.info(`Scheduler — ${scheduler.tasks().length} task(s) loaded`);
  }

  // Hot-reload definitions (agents/skills/tasks) on file changes — no restart.
  const cfgDir = harness.config.configDir;
  const watcher = watchDefinitions({
    dirs: [config.agentsDir, join(cfgDir, 'agents'), config.tasksDir, join(cwd, 'skills'), join(cfgDir, 'skills')]
      .filter((p): p is string => Boolean(p)),
    onChange: async () => {
      await harness.reloadDefinitions();
      await scheduler?.reload();
      adapter.push({
        type: 'agents',
        agents: harness.agents.list().map((a) => ({ name: a.name, description: a.description, color: a.color })),
        activeAgentId: primaryName,
      });
      // Re-broadcast commands too: a reloaded skill adds/removes slash commands, and
      // without this the client's command palette stays stale until it reconnects.
      adapter.push({
        type: 'commands',
        commands: harness.commands.list().map((c) => ({ command: `/${c.name}`, description: c.description })),
      });
      log.info('reloaded definitions');
    },
    // Runtime scheduler state must never bounce back as a definition reload, even
    // if it ever lands inside a watched dir.
    ignore: (f) => f.endsWith('scheduler-state.json'),
    log: (msg) => log.info(`watch: ${msg}`),
  });

  // arya as a thin consumer of mu's autonomous-host primitive: serveHost owns the
  // channel host + ordered lifecycle. Services stop in reverse on shutdown
  // (watcher → scheduler → channels → harness.close()).
  const sched = scheduler;
  const channelAdapters: ChannelAdapter[] = [adapter];
  if (config.telegram?.botToken) {
    channelAdapters.push(
      createTelegramAdapter({
        botToken: config.telegram.botToken,
        allowedChatIds: config.telegram.allowedChatIds,
        log: (m) => log.info(`telegram: ${m}`),
      }),
    );
    log.info(`Telegram channel enabled${config.telegram.allowedChatIds ? ` (allowlist: ${config.telegram.allowedChatIds.join(',')})` : ''}`);
  }
  const host = await serveHost({
    harness,
    approvals,
    adapters: channelAdapters,
    services: [
      ...(sched ? [{ stop: () => sched.stop() }] : []),
      { stop: () => watcher.stop() },
      ...(admin
        ? [
            {
              stop: async () => {
                await admin!.close();
                adminAuth?.close();
              },
            },
          ]
        : []),
      ...(browser
        ? [
            {
              stop: async () => {
                await browser.close();
                if (browserSession && provider) {
                  await provider.closeSession(browserSession.providerSessionId).catch(() => {});
                }
              },
            },
          ]
        : []),
      { stop: () => memoryStore.close() },
    ],
  });
  log.info(`Listening on ${config.wsHost}:${config.wsPort} — accepting connections`);

  return {
    shutdown: async () => {
      log.info('Shutting down...');
      await host.shutdown();
      log.info('Stopped');
    },
  };
}
