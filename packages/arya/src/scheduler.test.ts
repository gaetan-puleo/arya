import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type WireSchedulerEvent as SchedulerEvent } from 'mu-coding';
import { createScheduler } from './scheduler';
import { hashOutput, MonitorStateStore, parseWakeGate } from './scheduler-guards';

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
      'id: daily\ncron: "0 9 * * *"\nprompt: do it\ntimezone: UTC\nagent: arya\n',
    );
    const scheduler = createScheduler({ tasksDir: dir, runTask: stubRunTask(), onEvent: () => {} });
    try {
      expect(scheduler.tasks()).toEqual([
        { id: 'daily', cron: '0 9 * * *', prompt: 'do it', timezone: 'UTC' },
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
      });
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('runs a command task via the shell without invoking the agent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-test-'));
    const out = `${dir}/ran.txt`;
    await writeFile(`${dir}/c.yaml`, `id: shell\ncron: "* * * * * *"\ncommand: "echo hi > ${out}"\n`);
    let agentCalled = false;
    const events: SchedulerEvent[] = [];
    const scheduler = createScheduler({
      tasksDir: dir,
      runTask: () => {
        agentCalled = true;
        return Promise.resolve('nope');
      },
      onEvent: (event) => events.push(event),
    });
    try {
      expect(scheduler.tasks()).toEqual([
        { id: 'shell', cron: '* * * * * *', prompt: '', timezone: undefined, command: `echo hi > ${out}` },
      ]);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect(agentCalled).toBe(false);
      const { readFile } = await import('node:fs/promises');
      expect((await readFile(out, 'utf-8')).trim()).toBe('hi');
      expect(events.map((e) => e.type)).toContain('task_completed');
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a failing command task emits task_failed with the error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-test-'));
    await writeFile(`${dir}/f.yaml`, 'id: boom\ncron: "* * * * * *"\ncommand: "exit 3"\n');
    const events: SchedulerEvent[] = [];
    const scheduler = createScheduler({ tasksDir: dir, runTask: stubRunTask(), onEvent: (e) => events.push(e) });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const failed = events.find((e) => e.type === 'task_failed');
      expect(failed).toBeDefined();
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('scheduler guards', () => {
  it('parseWakeGate: only {"wakeAgent": false} on the last line silences', () => {
    expect(parseWakeGate('some output\n{"wakeAgent": false}')).toBe(false);
    expect(parseWakeGate('{"wakeAgent": true}')).toBe(true);
    expect(parseWakeGate('plain text')).toBe(true);
    expect(parseWakeGate('')).toBe(true);
    expect(parseWakeGate('a\nb\n{"wakeAgent": false}\n')).toBe(false);
  });

  it('hashOutput is stable and content-sensitive', () => {
    expect(hashOutput('abc')).toBe(hashOutput('abc'));
    expect(hashOutput('abc')).not.toBe(hashOutput('abd'));
  });

  it('MonitorStateStore persists across instances', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-guard-'));
    const path = join(dir, 'state.json');
    try {
      const a = new MonitorStateStore(path);
      a.set('t1', { lastOutputHash: 'h1', lastChangedAt: 123, lastOutput: 'out' });
      const b = new MonitorStateStore(path);
      expect(b.get('t1').lastOutputHash).toBe('h1');
      expect(b.get('missing')).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('monitor gate: first run delivers, identical second run is silent', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-guard-'));
    const statePath = join(dir, 'state.json');
    await writeFile(`${dir}/m.yaml`, 'id: mon\ncron: "* * * * * *"\ncommand: "echo hello"\nmonitor: true\n');
    const events: SchedulerEvent[] = [];
    const scheduler = createScheduler({ tasksDir: dir, statePath, runTask: stubRunTask(), onEvent: (e) => events.push(e) });
    try {
      await new Promise((resolve) => setTimeout(resolve, 2600));
      const completed = events.filter((e) => e.type === 'task_completed');
      expect(completed.length).toBeGreaterThanOrEqual(2);
      expect(completed[0].silent).toBeFalsy();
      expect(completed.slice(1).every((e) => e.silent === true)).toBe(true);
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('wake gate: a command ending with wakeAgent=false completes silently', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-guard-'));
    const statePath = join(dir, 'state.json');
    await writeFile(`${dir}/w.yaml`, 'id: wake\ncron: "* * * * * *"\ncommand: "printf \'x\\n{\\"wakeAgent\\": false}\'"\n');
    const events: SchedulerEvent[] = [];
    const scheduler = createScheduler({ tasksDir: dir, statePath, runTask: stubRunTask(), onEvent: (e) => events.push(e) });
    try {
      await new Promise((resolve) => setTimeout(resolve, 1300));
      const completed = events.filter((e) => e.type === 'task_completed');
      expect(completed.length).toBeGreaterThanOrEqual(1);
      expect(completed.every((e) => e.silent === true)).toBe(true);
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('preflight: a monitor task without a command is refused (not scheduled)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-guard-'));
    await writeFile(`${dir}/p.yaml`, 'id: bad\ncron: "* * * * * *"\nprompt: do it\nmonitor: true\n');
    const logs: string[] = [];
    const scheduler = createScheduler({ tasksDir: dir, runTask: stubRunTask(), onEvent: () => {}, log: (m) => logs.push(m) });
    try {
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(scheduler.tasks().map((t) => t.id)).not.toContain('bad');
      expect(logs.some((l) => l.includes('preflight') && l.includes('monitor'))).toBe(true);
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('overlap guard: a slow task logs a skip when the next tick fires mid-run', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'arya-guard-'));
    const statePath = join(dir, 'state.json');
    await writeFile(`${dir}/o.yaml`, 'id: slow\ncron: "* * * * * *"\ncommand: "sleep 2"\n');
    const logs: string[] = [];
    const scheduler = createScheduler({ tasksDir: dir, statePath, runTask: stubRunTask(), onEvent: () => {}, log: (m) => logs.push(m) });
    try {
      await new Promise((resolve) => setTimeout(resolve, 3200));
      expect(logs.some((l) => l.includes('skipped') && l.includes('still in progress'))).toBe(true);
    } finally {
      scheduler.stop();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
