import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { TaskStore, type TaskEvent } from './store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'arya-tasks-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('TaskStore', () => {
  it('creates a task with defaults and persists a YAML file', () => {
    const s = new TaskStore(dir);
    const t = s.create({ title: 'Ship the board' });
    expect(t.status).toBe('todo');
    expect(t.priority).toBe('normal');
    expect(t.id).toMatch(/^ship-the-board-/);
    const file = join(dir, `${t.id}.yaml`);
    expect(existsSync(file)).toBe(true);
    const onDisk = parseYaml(readFileSync(file, 'utf-8')) as Record<string, unknown>;
    expect(onDisk.title).toBe('Ship the board');
  });

  it('emits created/updated/moved/removed events with previous state', () => {
    const s = new TaskStore(dir);
    const events: TaskEvent[] = [];
    s.onEvent((e) => events.push(e));
    const t = s.create({ title: 'A' });
    s.update(t.id, { priority: 'urgent' });
    s.move(t.id, 'in_progress');
    s.remove(t.id);
    expect(events.map((e) => e.type)).toEqual(['created', 'updated', 'moved', 'removed']);
    expect(events[1].previous?.priority).toBe('normal');
    expect(events[2].previous?.status).toBe('todo');
    expect(events[2].task.status).toBe('in_progress');
  });

  it('move to the same status is a no-op (no event)', () => {
    const s = new TaskStore(dir);
    const t = s.create({ title: 'A', status: 'todo' });
    const events: TaskEvent[] = [];
    s.onEvent((e) => events.push(e));
    const same = s.move(t.id, 'todo');
    expect(same.status).toBe('todo');
    expect(events).toHaveLength(0);
  });

  it('lists filtered by status/assignee, sorted by priority then recency', () => {
    const s = new TaskStore(dir);
    s.create({ title: 'low', priority: 'low', assignee: 'arya', status: 'todo' });
    s.create({ title: 'urgent', priority: 'urgent', assignee: 'arya', status: 'todo' });
    s.create({ title: 'other', priority: 'high', assignee: 'bob', status: 'in_progress' });
    const aryaTodo = s.list({ status: 'todo', assignee: 'arya' });
    expect(aryaTodo.map((t) => t.title)).toEqual(['urgent', 'low']);
    expect(s.list({ status: 'in_progress' }).map((t) => t.title)).toEqual(['other']);
  });

  it('reload() re-reads the board from disk', () => {
    const s = new TaskStore(dir);
    const t = s.create({ title: 'Persisted', status: 'in_review' });
    const s2 = new TaskStore(dir);
    s2.reload();
    const reloaded = s2.get(t.id);
    expect(reloaded?.title).toBe('Persisted');
    expect(reloaded?.status).toBe('in_review');
  });

  it('rejects invalid status/priority on create', () => {
    const s = new TaskStore(dir);
    expect(() => s.create({ title: 'x', status: 'nope' as never })).toThrow();
    expect(() => s.create({ title: 'x', priority: 'nope' as never })).toThrow();
  });

  it('update/move/get on a missing id throws', () => {
    const s = new TaskStore(dir);
    expect(() => s.update('ghost', { title: 'x' })).toThrow();
    expect(() => s.move('ghost', 'done')).toThrow();
    expect(s.get('ghost')).toBeUndefined();
  });
});
