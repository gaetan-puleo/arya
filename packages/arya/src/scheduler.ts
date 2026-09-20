import { exec } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  createMemoryTaskStore,
  createScheduler as createSchedulerEngine,
  type SchedulerEvent as EngineSchedulerEvent,
  type Task,
} from 'mu-coding';
import { type WireSchedulerEvent as SchedulerEvent, type WireSchedulerTask as SchedulerTask } from 'arya-core';
import { hashOutput, MonitorStateStore, parseWakeGate } from './scheduler-guards';
import { errMsg } from 'mu-core';

export type LoadedTask = SchedulerTask & {
  agent?: string;
  command?: string;
  timeout?: number;
  /** Only wake (agent / delivery) when the command output changes vs last run. */
  monitor?: boolean;
};

export interface Scheduler {
  tasks(): SchedulerTask[];
  reload(): Promise<void>;
  stop(): void;
}

export interface SchedulerOptions {
  tasksDir?: string;
  /** Path to the persisted monitor-state JSON (lives outside the watched YAML). */
  statePath?: string;
  runTask: (agent: string, prompt: string) => Promise<string>;
  onEvent: (event: SchedulerEvent) => void;
  log?: (message: string) => void;
}

const str = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);

function parseTasks(raw: unknown): LoadedTask[] {
  const list = Array.isArray(raw) ? raw : [raw];
  const tasks: LoadedTask[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const o = entry as Record<string, unknown>;
    const id = str(o.id);
    const cron = str(o.cron);
    const prompt = str(o.prompt);
    const command = str(o.command);
    if (!id || !cron || (!prompt && !command)) continue;
    const timeout = typeof o.timeout === 'number' && o.timeout > 0 ? o.timeout : undefined;
    const monitor = o.monitor === true;
    tasks.push({ id, cron, prompt: prompt ?? '', timezone: str(o.timezone), agent: str(o.agent), command, timeout, monitor });
  }
  return tasks;
}

function loadTasks(dir: string, log?: (m: string) => void): LoadedTask[] {
  let files: string[];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith('.yaml') || name.endsWith('.yml')).sort();
  } catch {
    return [];
  }
  const tasks: LoadedTask[] = [];
  for (const file of files) {
    try {
      tasks.push(...parseTasks(parseYaml(readFileSync(join(dir, file), 'utf-8'))));
    } catch (err) {
      log?.(`failed to load tasks from ${file}: ${errMsg(err)}`);
    }
  }
  return tasks;
}

const toWireTask = (task: LoadedTask): SchedulerTask => ({
  id: task.id,
  cron: task.cron,
  prompt: task.prompt,
  timezone: task.timezone,
  ...(task.command ? { command: task.command } : {}),
});

const toEngineTask = (task: LoadedTask): Task => ({
  id: task.id,
  prompt: task.prompt,
  agent: task.agent,
  schedule: { kind: 'cron', expr: task.cron, timezone: task.timezone },
  enabled: true,
  createdAt: 0,
});

const DEFAULT_SHELL_TIMEOUT_SEC = 300;

/** Run a shell command directly (no agent). Resolves with combined stdout+stderr;
 * rejects on non-zero exit or timeout. The YAML file is trusted input. */
function runShell(command: string, timeoutSec: number): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: timeoutSec * 1000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = [stdout, stderr].filter(Boolean).join('\n').trim();
      if (err) reject(new Error(out || err.message));
      else resolve(out || '(no output)');
    });
  });
}

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { runTask, onEvent, log } = options;
  let byId = new Map<string, LoadedTask>();

  const wireTaskOf = (task: Task): SchedulerTask => {
    const original = byId.get(task.id);
    return original ? toWireTask(original) : { id: task.id, cron: '', prompt: task.prompt };
  };

  const emit = (event: EngineSchedulerEvent): void => {
    const task = wireTaskOf(event.task);
    if (event.type === 'task_started') onEvent({ type: 'task_started', task, at: event.at });
    else if (event.type === 'task_completed') {
      onEvent({
        type: 'task_completed',
        task,
        at: event.at,
        durationMs: event.durationMs,
        ...(event.result?.silent ? { silent: true } : {}),
        ...(event.result?.output !== undefined ? { output: event.result.output } : {}),
      });
    } else onEvent({ type: 'task_failed', task, at: event.at, error: event.error });
  };

  // Guards: overlap set (in-memory, per instance) + persisted monitor state.
  const running = new Set<string>();
  const monitorState = new MonitorStateStore(
    options.statePath ?? join(options.tasksDir ?? '.', '.scheduler-state.json'),
  );

  const run = async (task: Task) => {
    const original = byId.get(task.id);
    if (!original) return { ok: false, error: `unknown task ${task.id}` };

    // Overlap guard: a tick that fires while the previous run is still going is
    // skipped silently — no pile-up of long-running tasks.
    if (running.has(task.id)) {
      log?.(`task "${task.id}" skipped — previous run still in progress`);
      return { ok: true, output: 'skipped: previous run still in progress', silent: true };
    }
    running.add(task.id);
    try {
      let sourceOutput: string | undefined;
      if (original.command) {
        try {
          sourceOutput = await runShell(original.command, original.timeout ?? DEFAULT_SHELL_TIMEOUT_SEC);
        } catch (err) {
          // Command failed: report it, leave the monitor hash untouched.
          return { ok: false, error: errMsg(err) };
        }
        // Monitor gate: unchanged output → silent, no agent, no delivery.
        if (original.monitor) {
          const h = hashOutput(sourceOutput);
          if (monitorState.get(task.id).lastOutputHash === h) {
            log?.(`task "${task.id}" monitor: no change — silent`);
            return { ok: true, output: 'no change', silent: true };
          }
          monitorState.set(task.id, { lastOutputHash: h, lastChangedAt: Date.now(), lastOutput: sourceOutput });
        }
        // Wake gate: last stdout line {"wakeAgent": false} → silent.
        if (!parseWakeGate(sourceOutput)) {
          log?.(`task "${task.id}" wake gate off — silent`);
          return { ok: true, output: 'wakeAgent=false', silent: true };
        }
      }
      // Act: agent if a prompt is set (source output injected as context), else deliver output.
      if (original.prompt) {
        const ctx = sourceOutput ? `Latest check output:\n${sourceOutput}\n\n` : '';
        const output = await runTask(original.agent ?? '', ctx + original.prompt);
        return { ok: true, output };
      }
      return { ok: true, output: sourceOutput ?? '' };
    } finally {
      running.delete(task.id);
    }
  };

  // Rebuild the engine + store from the YAML on disk. Builds the NEXT engine
  // first and only swaps it in once it starts cleanly — a bad cron (or any
  // build error) leaves the previous engine running instead of killing all
  // scheduled work.
  let engine: ReturnType<typeof createSchedulerEngine> | undefined;
  const build = async (): Promise<void> => {
    const loaded = options.tasksDir ? loadTasks(options.tasksDir, log) : [];
    // Preflight: drop jobs that can't run as configured, so they don't re-fire
    // every tick. A monitor needs a `command` to watch.
    const valid = loaded.filter((task) => {
      if (task.monitor && !task.command) {
        log?.(`task "${task.id}" refused at preflight: monitor requires a \`command\``);
        return false;
      }
      return true;
    });
    const nextEngine = createSchedulerEngine({
      store: createMemoryTaskStore(valid.map(toEngineTask)),
      run,
      onEvent: emit,
      onError: (err, task) => log?.(`task "${task.id}" failed to schedule: ${errMsg(err)}`),
    });
    const previousById = byId;
    const previousEngine = engine;
    // Publish the new task view synchronously so `tasks()` reflects the reload
    // immediately; roll it back if the engine fails to start.
    byId = new Map(valid.map((task) => [task.id, task]));
    try {
      await nextEngine.start();
    } catch (err) {
      byId = previousById;
      log?.(`scheduler rebuild failed: ${errMsg(err)} — keeping previous engine`);
      return;
    }
    engine = nextEngine;
    previousEngine?.stop();
    for (const task of valid) log?.(`scheduled task "${task.id}" (${task.cron})`);
  };

  build().catch((err) => log?.(`scheduler build crashed: ${errMsg(err)}`));

  return {
    tasks: () => [...byId.values()].map(toWireTask),
    reload: async () => {
      // build() swaps the engine and stops the previous one only after the new
      // one starts cleanly — don't stop first (that would kill scheduling if the
      // rebuild fails).
      await build();
    },
    stop: () => engine?.stop(),
  };
}
