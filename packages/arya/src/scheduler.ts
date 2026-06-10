import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from '@std/yaml';
import {
  createMemoryTaskStore,
  createScheduler as createSchedulerEngine,
  type SchedulerEvent as EngineSchedulerEvent,
  type Task,
  type TaskInput,
} from 'mu-harness';
import type { AryaRuntime } from './runtime';
import type { SchedulerEvent, SchedulerTask } from './protocol';

export type LoadedTask = SchedulerTask & { agent?: string };

export interface Scheduler {
  tasks(): SchedulerTask[];
  /**
   * Register a task in the running engine without a restart, reusing the
   * existing in-memory store + engine reload. The caller persists the YAML;
   * this only makes it fire live.
   */
  add(task: LoadedTask): Promise<void>;
  stop(): void;
}

export interface SchedulerOptions {
  tasksDir?: string;
  runtime: AryaRuntime;
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
    if (!id || !cron || !prompt) continue;
    tasks.push({ id, cron, prompt, timezone: str(o.timezone), channel: str(o.channel), agent: str(o.agent) });
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
      log?.(`failed to load tasks from ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return tasks;
}

const toWireTask = (task: LoadedTask): SchedulerTask => ({
  id: task.id,
  cron: task.cron,
  prompt: task.prompt,
  timezone: task.timezone,
  channel: task.channel,
});

const toTaskInput = (task: LoadedTask): TaskInput => ({
  prompt: task.prompt,
  agent: task.agent,
  schedule: { kind: 'cron', expr: task.cron, timezone: task.timezone },
});

const toEngineTask = (task: LoadedTask): Task => ({ id: task.id, enabled: true, createdAt: 0, ...toTaskInput(task) });

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { runtime, onEvent, log } = options;
  const loaded = options.tasksDir ? loadTasks(options.tasksDir, log) : [];
  const added: LoadedTask[] = [];
  const byId = new Map(loaded.map((task) => [task.id, task]));

  // The harness' in-memory store seeds initial tasks under their own ids; add()
  // goes through its create() (which assigns a fresh id) + engine.reload().
  const store = createMemoryTaskStore(loaded.map(toEngineTask));

  const wireTaskOf = (task: Task): SchedulerTask => {
    const original = byId.get(task.id);
    return original ? toWireTask(original) : { id: task.id, cron: '', prompt: task.prompt };
  };

  const emit = (event: EngineSchedulerEvent): void => {
    const task = wireTaskOf(event.task);
    if (event.type === 'task_started') onEvent({ type: 'task_started', task, at: event.at });
    else if (event.type === 'task_completed') {
      onEvent({ type: 'task_completed', task, at: event.at, durationMs: event.durationMs });
    } else onEvent({ type: 'task_failed', task, at: event.at, error: event.error });
  };

  const engine = createSchedulerEngine({
    store,
    run: async (task) => {
      try {
        const output = await runtime.runAgentTask(byId.get(task.id)?.agent ?? '', task.prompt);
        return { ok: true, output };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    },
    onEvent: emit,
  });

  for (const task of loaded) log?.(`scheduled task "${task.id}" (${task.cron})`);
  void engine.start();

  return {
    tasks: () => [...loaded, ...added].map(toWireTask),
    add: async (task) => {
      const created = await store.create(toTaskInput(task));
      // The store mints its own id; key the wire-task lookup by it so emitted
      // events still surface the author-chosen id/cron/channel.
      byId.set(created.id, task);
      added.push(task);
      await engine.reload();
      log?.(`scheduled task "${task.id}" (${task.cron})`);
    },
    stop: () => engine.stop(),
  };
}
