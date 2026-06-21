import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type WireSchedulerEvent as SchedulerEvent } from 'mu-harness';
import { createScheduler } from './scheduler';

const stubRunTask = (onTask?: (agent: string, prompt: string) => void) =>
(agent: string, prompt: string): Promise<string> => {
  onTask?.(agent, prompt);
  return Promise.resolve('ok');
};

describe('scheduler', () => {
  it('loads YAML task defs and exposes them as wire tasks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-test-'));
    await writeFile(
      `${dir}/t.yaml`,
      'id: daily\ncron: "0 9 * * *"\nprompt: do it\ntimezone: UTC\nchannel: ops\nagent: arya\n',
    );
    const scheduler = createScheduler({ tasksDir: dir, runTask: stubRunTask(), onEvent: () => {} });
    try {
      expect(scheduler.tasks()).toEqual([
        { id: 'daily', cron: '0 9 * * *', prompt: 'do it', timezone: 'UTC', channel: 'ops' },
      ]);
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('reload() picks up a task added to disk and drops a deleted one', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-test-'));
    const prompts: string[] = [];
    const scheduler = createScheduler({
      tasksDir: dir,
      runTask: stubRunTask((_agent, prompt) => prompts.push(prompt)),
      onEvent: () => {},
    });
    try {
      expect(scheduler.tasks()).toEqual([]);

      // Create on disk → reload → live (appears + fires).
      await writeFile(`${dir}/live.yaml`, 'id: live\ncron: "* * * * * *"\nprompt: tick\n');
      await scheduler.reload();
      expect(scheduler.tasks().map((t) => t.id)).toContain('live');
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(prompts).toContain('tick');

      // Delete on disk → reload → gone.
      await rm(`${dir}/live.yaml`, { force: true });
      await scheduler.reload();
      expect(scheduler.tasks()).toEqual([]);
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('fires a due task through the runtime and emits start/complete wire events', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-test-'));
    await writeFile(`${dir}/t.yaml`, 'id: tick\ncron: "* * * * * *"\nprompt: ping\nagent: arya\n');
    const prompts: string[] = [];
    const events: SchedulerEvent[] = [];
    const scheduler = createScheduler({
      tasksDir: dir,
      runTask: stubRunTask((_agent, prompt) => prompts.push(prompt)),
      onEvent: (event) => events.push(event),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(prompts).toContain('ping');
      const types = events.map((e) => e.type);
      expect(types).toContain('task_started');
      expect(types).toContain('task_completed');
      const started = events.find((e) => e.type === 'task_started');
      expect(started?.task).toEqual({
        id: 'tick',
        cron: '* * * * * *',
        prompt: 'ping',
        timezone: undefined,
        channel: undefined,
      });
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
