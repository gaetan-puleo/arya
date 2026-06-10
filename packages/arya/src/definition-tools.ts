import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stringify as stringifyYaml } from '@std/yaml';
import { Cron } from 'croner';
import type { ContentPart, Tool } from 'mu-core';
import type { Scheduler } from './scheduler';

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

interface TaskWriterArgs {
  id?: string;
  cron?: string;
  prompt?: string;
  agent?: string;
  timezone?: string;
  channel?: string;
}

export interface TaskWriterDeps {
  tasksDir: string;
  /** Late-bound: the scheduler is created after the tools, and is absent in the TUI. */
  getScheduler: () => Scheduler | undefined;
}

const err = (text: string): ContentPart[] => [{ type: 'text', text: `Error: ${text}` }];

/**
 * `create_task` — author a cron-scheduled task. Persists a YAML def into the
 * tasks dir (re-read on every launch) and, when a scheduler is running, registers
 * it live via {@link Scheduler.add} so it fires without a restart.
 */
export const createTaskWriterTool = (deps: TaskWriterDeps): Tool => ({
  name: 'create_task',
  description:
    'Schedule recurring work: persist a task (cron expression + prompt) that an agent runs on schedule. Saved to the tasks directory and registered live when the scheduler is running.',
  parameters: {
    type: 'object',
    properties: {
      id: { type: 'string', description: 'Unique task id (letters, digits, "-", "_"); also the filename.' },
      cron: {
        type: 'string',
        description: 'Cron expression, e.g. "0 9 * * *" (5 fields) or with leading seconds (6 fields).',
      },
      prompt: { type: 'string', description: 'The prompt handed to the agent on each run.' },
      agent: { type: 'string', description: 'Optional agent name to run the task as (defaults to the primary agent).' },
      timezone: { type: 'string', description: 'Optional IANA timezone, e.g. "Europe/Paris".' },
      channel: { type: 'string', description: 'Optional channel label for the task.' },
    },
    required: ['id', 'cron', 'prompt'],
    additionalProperties: false,
  },
  run: async (input): Promise<ContentPart[]> => {
    const { id, cron, prompt, agent, timezone, channel } = (input ?? {}) as TaskWriterArgs;
    if (!id || !cron || !prompt) return err('create_task requires `id`, `cron`, and `prompt`.');
    if (!ID_RE.test(id)) return err(`invalid task id "${id}" (use letters, digits, "-" and "_").`);
    try {
      new Cron(cron); // validates the expression; throws if malformed
    } catch (e) {
      return err(`invalid cron "${cron}": ${e instanceof Error ? e.message : String(e)}`);
    }

    const scheduler = deps.getScheduler();
    if (scheduler?.tasks().some((t) => t.id === id)) return err(`a task with id "${id}" already exists.`);
    const file = join(deps.tasksDir, `${id}.yaml`);
    if (existsSync(file)) return err(`${file} already exists.`);

    const def: Record<string, unknown> = { id, cron, prompt };
    if (agent) def.agent = agent;
    if (timezone) def.timezone = timezone;
    if (channel) def.channel = channel;
    await mkdir(deps.tasksDir, { recursive: true });
    await writeFile(file, stringifyYaml(def), 'utf-8');

    // Persisted to disk; the scheduler reloads from there (the file watcher would
    // catch it too, but reloading here makes it fire immediately).
    if (scheduler) {
      await scheduler.reload();
      return [{ type: 'text', text: `Created task "${id}" at ${file} and scheduled it live (${cron}).` }];
    }
    return [{
      type: 'text',
      text: `Created task "${id}" at ${file}. It will run on the next launch (no scheduler active).`,
    }];
  },
});
