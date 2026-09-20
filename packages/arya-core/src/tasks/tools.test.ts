import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TaskStore } from './store';
import { createTaskTools } from './tools';

const txt = (parts: { type: string; text?: string }[]): string =>
  parts.map((p) => p.text ?? '').join('');

let dir: string;
let store: TaskStore;
let tools: ReturnType<typeof createTaskTools>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arya-tasktools-'));
  store = new TaskStore(dir);
  tools = createTaskTools(store);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const tool = (name: string) => {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} missing`);
  return t;
};

describe('task tools', () => {
  it('task_create returns the created card', async () => {
    const out = txt((await tool('task_create').run({ title: 'Write docs', priority: 'high' })) as never);
    expect(out).toContain('Write docs');
    expect(out).toContain('(todo)');
    expect(out).toContain('!high');
  });

  it('task_list shows tasks and honours filters', async () => {
    await tool('task_create').run({ title: 'A', status: 'todo' });
    await tool('task_create').run({ title: 'B', status: 'done' });
    const all = txt((await tool('task_list').run({})) as never);
    expect(all).toContain('A');
    expect(all).toContain('B');
    const done = txt((await tool('task_list').run({ status: 'done' })) as never);
    expect(done).toContain('B');
    expect(done).not.toContain('A');
  });

  it('task_move changes the column', async () => {
    const created = txt((await tool('task_create').run({ title: 'M' })) as never);
    const id = created.match(/\[([^\]]+)\]/)?.[1] ?? '';
    const moved = txt((await tool('task_move').run({ id, status: 'in_review' })) as never);
    expect(moved).toContain('→ in_review');
    expect(store.get(id)?.status).toBe('in_review');
  });

  it('task_move rejects an invalid status', async () => {
    const created = txt((await tool('task_create').run({ title: 'M' })) as never);
    const id = created.match(/\[([^\]]+)\]/)?.[1] ?? '';
    const out = txt((await tool('task_move').run({ id, status: 'bogus' })) as never);
    expect(out).toContain('invalid status');
  });

  it('task_get returns notes and timestamps', async () => {
    const created = txt((await tool('task_create').run({ title: 'G', notes: 'detail here' })) as never);
    const id = created.match(/\[([^\]]+)\]/)?.[1] ?? '';
    const got = txt((await tool('task_get').run({ id })) as never);
    expect(got).toContain('detail here');
    expect(got).toContain('created:');
  });

  it('task_update edits fields', async () => {
    const created = txt((await tool('task_create').run({ title: 'U' })) as never);
    const id = created.match(/\[([^\]]+)\]/)?.[1] ?? '';
    await tool('task_update').run({ id, assignee: 'arya', priority: 'urgent' });
    const t = store.get(id);
    expect(t?.assignee).toBe('arya');
    expect(t?.priority).toBe('urgent');
  });
});
