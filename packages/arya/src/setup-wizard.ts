// Interactive terminal setup wizard for arya's config.json.
//
// `arya setup` runs this. Unlike the old in-channel flow, questions are asked
// directly on the terminal (stdin/stdout). It reuses the small helpers in
// init.ts (port/host validation, config read/write) and adds a live model
// picker that queries the provider's `/models` endpoint. Sections are
// independently runnable:  `arya setup`, `arya setup model`, `arya setup server`.

import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import {
  type Config,
  isLoopbackHost,
  isValidPort,
  PROVIDER_PORTS,
  readConfig,
  writeConfig,
} from './init';

type SetupSection = 'model' | 'server';

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
};
const color = (s: string, c: string): string => (stdout.isTTY ? `${c}${s}${C.reset}` : s);

interface Ask {
  question(prompt: string, def?: string): Promise<string>;
  confirm(prompt: string, def: boolean): Promise<boolean>;
  close(): void;
}

function makeAsk(): Ask {
  const rl = createInterface({ input: stdin, output: stdout });
  const question = async (prompt: string, def?: string): Promise<string> => {
    const suffix = def != null && def !== '' ? color(` [${def}]`, C.dim) : '';
    const answer = (await rl.question(`${color('?', C.cyan)} ${prompt}${suffix} `)).trim();
    return answer || (def ?? '');
  };
  const confirm = async (prompt: string, def: boolean): Promise<boolean> => {
    const ans = (await question(prompt, def ? 'Y/n' : 'y/N')).toLowerCase();
    if (!ans || ans === (def ? 'y/n' : 'y/n')) return def;
    return ans.startsWith('y');
  };
  return { question, confirm, close: () => rl.close() };
}

function header(label: string): void {
  stdout.write(`\n${color(`⚕ ${label}`, C.bold + C.magenta)}\n`);
}

/** Fetch the model ids advertised by an OpenAI-compatible `/models` endpoint. */
async function fetchModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  const headers: Record<string, string> = {};
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    if (!res.ok) return [];
    const body = (await res.json()) as { data?: Array<{ id?: unknown }> };
    return Array.isArray(body.data)
      ? body.data.map((m) => (typeof m?.id === 'string' ? m.id : '')).filter(Boolean)
      : [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** Ask provider → base URL → model (+ apiKey, capabilities). Mutates `config`. */
async function sectionModel(ask: Ask, config: Config): Promise<void> {
  header('Model & Provider');

  // Provider → host → port → baseUrl (a full URL short-circuits the port question).
  const existingBase = typeof config.baseUrl === 'string' ? config.baseUrl : '';
  const provider = (await ask.question(
    'Provider? (llama-swap / ollama / openai / other)',
    typeof config.kind === 'string' && config.kind ? config.kind : 'llama-swap',
  )).toLowerCase();
  if (provider && provider !== 'other') config.kind = provider;

  const host = await ask.question('Provider host or full URL', existingBase || 'localhost');
  if (/^https?:\/\//i.test(host)) {
    config.baseUrl = host.replace(/\/+$/, '');
  } else {
    const portDef = PROVIDER_PORTS[provider] ?? '8080';
    let port = Number(await ask.question('Provider port', portDef));
    while (!isValidPort(port)) {
      stdout.write(color('  Port must be an integer in [1, 65535].\n', C.yellow));
      port = Number(await ask.question('Provider port', portDef));
    }
    config.baseUrl = `http://${host}:${port}/v1`;
  }

  const apiKey = await ask.question(
    'API key (leave blank if none)',
    typeof config.apiKey === 'string' ? config.apiKey : '',
  );
  if (apiKey) config.apiKey = apiKey;

  // Live model picker — list what the endpoint advertises, else fall back to typing.
  const baseUrl = String(config.baseUrl);
  stdout.write(color(`  Querying ${baseUrl}/models …\n`, C.dim));
  const models = await fetchModels(baseUrl, apiKey || undefined);
  const currentModel = typeof config.model === 'string' ? config.model : '';
  if (models.length > 0) {
    models.forEach((m, i) => stdout.write(`  ${color(String(i + 1), C.cyan)}. ${m}\n`));
    const def = currentModel && models.includes(currentModel) ? currentModel : models[0];
    const choice = await ask.question('Model (number or id)', def);
    const asIndex = Number(choice);
    config.model = Number.isInteger(asIndex) && asIndex >= 1 && asIndex <= models.length
      ? models[asIndex - 1]
      : choice;
  } else {
    stdout.write(color('  Could not reach the endpoint — enter the model id manually.\n', C.yellow));
    config.model = await ask.question('Model id (as your provider names it)', currentModel || 'qwen2.5-coder:7b');
  }

  // Multimodal capabilities (off by default; only meaningful if the model supports them).
  const caps = (config.capabilities && typeof config.capabilities === 'object'
    ? { ...(config.capabilities as Record<string, unknown>) }
    : {}) as { vision?: boolean; audio?: boolean };
  caps.vision = await ask.confirm('Does this model accept image input (vision)?', caps.vision === true);
  caps.audio = await ask.confirm('Does this model accept audio input?', caps.audio === true);
  config.capabilities = caps;
}

/** Ask wsPort / wsHost / authToken. Mutates `config`. */
async function sectionServer(ask: Ask, config: Config): Promise<void> {
  header('Server (WebSocket for companion / TUI)');

  let port = Number(await ask.question('WebSocket port', isValidPort(config.wsPort) ? String(config.wsPort) : '3001'));
  while (!isValidPort(port)) {
    stdout.write(color('  Port must be an integer in [1, 65535].\n', C.yellow));
    port = Number(await ask.question('WebSocket port', '3001'));
  }
  config.wsPort = port;

  const host = await ask.question(
    'Bind address (0.0.0.0 to reach from other devices)',
    typeof config.wsHost === 'string' && config.wsHost ? config.wsHost : '127.0.0.1',
  );
  config.wsHost = host;

  // A non-loopback bind requires a token (bootstrap refuses an empty one).
  if (!isLoopbackHost(host)) {
    const existingToken = typeof config.authToken === 'string' ? config.authToken : '';
    if (existingToken) {
      const keep = await ask.confirm('Keep the existing access token?', true);
      if (!keep) config.authToken = crypto.randomUUID();
    } else {
      config.authToken = crypto.randomUUID();
      stdout.write(color(`  Generated access token: ${config.authToken}\n`, C.green));
      stdout.write(color('  (Companion: paste it into Settings → Token.)\n', C.dim));
    }
  } else {
    const token = await ask.question(
      'Access token (optional on loopback, blank = none)',
      typeof config.authToken === 'string' ? config.authToken : '',
    );
    if (token) config.authToken = token;
  }
}

function summary(config: Config, configPath: string): void {
  header('Summary');
  const row = (k: string, v: unknown): void => {
    if (v === undefined || v === '') return;
    stdout.write(`  ${color(k.padEnd(14), C.cyan)} ${String(v)}\n`);
  };
  row('baseUrl', config.baseUrl);
  row('model', config.model);
  row('wsHost', config.wsHost);
  row('wsPort', config.wsPort);
  if (config.authToken) row('authToken', '••••••••');
  const caps = config.capabilities as { vision?: boolean; audio?: boolean } | undefined;
  if (caps?.vision || caps?.audio) {
    row('capabilities', [caps.vision && 'vision', caps.audio && 'audio'].filter(Boolean).join(', '));
  }
  stdout.write(`\n  ${color('Config:', C.dim)} ${configPath}\n`);
  stdout.write(`\n  ${color('Start arya:', C.green)} arya serve\n`);
}

export interface SetupWizardOptions {
  configPath: string;
  /** When set, run only this section; otherwise the full wizard. */
  section?: SetupSection;
}

/**
 * Run the interactive terminal setup wizard. Returns the path written, or null
 * if the environment is non-interactive (no TTY) — the caller should exit then.
 */
export async function runSetupWizard(opts: SetupWizardOptions): Promise<string | null> {
  if (!stdin.isTTY) {
    stdout.write(
      `[arya] Non-interactive environment (no TTY) — cannot run the setup wizard.\n` +
        `       Edit ${opts.configPath} directly (see CONFIG.md for the fields).\n`,
    );
    return null;
  }

  const config = readConfig(opts.configPath);

  stdout.write(color('\n⚕ arya setup\n', C.bold + C.magenta));
  stdout.write(color('  Press Enter to accept the [default]. Ctrl+C to abort.\n', C.dim));

  const ask = makeAsk();
  try {
    if (!opts.section || opts.section === 'model') await sectionModel(ask, config);
    if (!opts.section || opts.section === 'server') await sectionServer(ask, config);
  } finally {
    ask.close();
  }

  writeConfig(opts.configPath, config);
  summary(config, opts.configPath);
  return opts.configPath;
}
