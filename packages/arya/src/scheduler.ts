import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import { parse as parseYaml } from '@std/yaml';
import type { AryaRuntime } from './runtime';
import type { SchedulerEvent, SchedulerTask } from './protocol';

type LoadedTask = SchedulerTask & { agent?: string };

export interface Scheduler {
  tasks(): SchedulerTask[];
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

export function createScheduler(options: SchedulerOptions): Scheduler {
  const { runtime, onEvent, log } = options;
  const loaded = options.tasksDir ? loadTasks(options.tasksDir, log) : [];
  const jobs: Cron[] = [];

  for (const task of loaded) {
    const wireTask = toWireTask(task);
    try {
      const job = new Cron(task.cron, { name: task.id, timezone: task.timezone }, async () => {
        onEvent({ type: 'task_started', task: wireTask, at: Date.now() });
        const started = Date.now();
        try {
          await runtime.runAgentTask(task.agent ?? '', task.prompt);
          onEvent({ type: 'task_completed', task: wireTask, at: Date.now(), durationMs: Date.now() - started });
        } catch (err) {
          onEvent({
            type: 'task_failed',
            task: wireTask,
            at: Date.now(),
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      jobs.push(job);
      log?.(`scheduled task "${task.id}" (${task.cron})`);
    } catch (err) {
      log?.(`invalid cron for task "${task.id}": ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    tasks: () => loaded.map(toWireTask),
    stop: () => {
      for (const job of jobs) job.stop();
    },
  };
}
