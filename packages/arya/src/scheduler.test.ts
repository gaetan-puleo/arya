import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createScheduler } from './scheduler';
import type { AryaRuntime } from './runtime';
import type { SchedulerEvent } from './protocol';

const stubRuntime = (onTask?: (agent: string, prompt: string) => void): AryaRuntime =>
  ({
    runAgentTask: async (agent: string, prompt: string) => {
      onTask?.(agent, prompt);
      return 'ok';
    },
  }) as unknown as AryaRuntime;

describe('scheduler', () => {
  it('loads YAML task defs and exposes them as wire tasks', async () => {
    const dir = await Deno.makeTempDir();
    await Deno.writeTextFile(
      `${dir}/t.yaml`,
      'id: daily\ncron: "0 9 * * *"\nprompt: do it\ntimezone: UTC\nchannel: ops\nagent: arya\n',
    );
    const scheduler = createScheduler({ tasksDir: dir, runtime: stubRuntime(), onEvent: () => {} });
    try {
      expect(scheduler.tasks()).toEqual([
        { id: 'daily', cron: '0 9 * * *', prompt: 'do it', timezone: 'UTC', channel: 'ops' },
      ]);
    } finally {
      scheduler.stop();
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('fires a due task through the runtime and emits start/complete wire events', async () => {
    const dir = await Deno.makeTempDir();
    await Deno.writeTextFile(`${dir}/t.yaml`, 'id: tick\ncron: "* * * * * *"\nprompt: ping\nagent: arya\n');
    const prompts: string[] = [];
    const events: SchedulerEvent[] = [];
    const scheduler = createScheduler({
      tasksDir: dir,
      runtime: stubRuntime((_agent, prompt) => prompts.push(prompt)),
      onEvent: (event) => events.push(event),
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(prompts).toContain('ping');
      const types = events.map((e) => e.type);
      expect(types).toContain('task_started');
      expect(types).toContain('task_completed');
      const started = events.find((e) => e.type === 'task_started');
      expect(started?.task).toEqual({ id: 'tick', cron: '* * * * * *', prompt: 'ping', timezone: undefined, channel: undefined });
    } finally {
      scheduler.stop();
      await Deno.remove(dir, { recursive: true });
    }
  });
});
