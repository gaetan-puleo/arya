import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { createTaskWriterTool } from './definition-tools';
import { createScheduler, type Scheduler } from './scheduler';
import type { AryaRuntime } from './runtime';

const text = (parts: unknown): string => (parts as Array<{ text: string }>)[0].text;
const stubRuntime = (): AryaRuntime => ({ runAgentTask: async () => 'ok' }) as unknown as AryaRuntime;

describe('create_task', () => {
  it('persists a YAML def and registers it live in the scheduler', async () => {
    const dir = await Deno.makeTempDir();
    const scheduler = createScheduler({ tasksDir: dir, runtime: stubRuntime(), onEvent: () => {} });
    const tool = createTaskWriterTool({ tasksDir: dir, getScheduler: () => scheduler });
    try {
      const res = await tool.run({ id: 'daily', cron: '0 9 * * *', prompt: 'do it', agent: 'arya' }, {});
      expect(text(res)).toContain('scheduled it live');

      const yaml = await Deno.readTextFile(`${dir}/daily.yaml`);
      expect(yaml).toContain('id: daily');
      expect(yaml).toContain('do it');
      expect(yaml).toContain('agent: arya');

      expect(scheduler.tasks().map((t) => t.id)).toContain('daily');
    } finally {
      scheduler.stop();
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('without a running scheduler, persists only (runs next launch)', async () => {
    const dir = await Deno.makeTempDir();
    const tool = createTaskWriterTool({ tasksDir: dir, getScheduler: () => undefined });
    try {
      const res = await tool.run({ id: 'later', cron: '0 9 * * *', prompt: 'p' }, {});
      expect(text(res)).toContain('next launch');
      expect(await Deno.readTextFile(`${dir}/later.yaml`)).toContain('id: later');
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('rejects a malformed cron', async () => {
    const dir = await Deno.makeTempDir();
    const tool = createTaskWriterTool({ tasksDir: dir, getScheduler: () => undefined });
    try {
      const res = await tool.run({ id: 'bad', cron: 'not a cron', prompt: 'p' }, {});
      expect(text(res)).toContain('invalid cron');
      expect(await Deno.stat(`${dir}/bad.yaml`).catch(() => null)).toBeNull();
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('rejects an invalid id and refuses duplicates', async () => {
    const dir = await Deno.makeTempDir();
    const scheduler: Scheduler = createScheduler({ tasksDir: dir, runtime: stubRuntime(), onEvent: () => {} });
    const tool = createTaskWriterTool({ tasksDir: dir, getScheduler: () => scheduler });
    try {
      expect(text(await tool.run({ id: 'bad/id', cron: '0 9 * * *', prompt: 'p' }, {}))).toContain('invalid task id');

      await tool.run({ id: 'dup', cron: '0 9 * * *', prompt: 'p' }, {});
      expect(text(await tool.run({ id: 'dup', cron: '0 9 * * *', prompt: 'p2' }, {}))).toContain('already exists');
    } finally {
      scheduler.stop();
      await Deno.remove(dir, { recursive: true });
    }
  });

  it('requires id, cron and prompt', async () => {
    const tool = createTaskWriterTool({ tasksDir: '/tmp/x', getScheduler: () => undefined });
    expect(text(await tool.run({ id: 'x' }, {}))).toContain('requires');
  });
});
