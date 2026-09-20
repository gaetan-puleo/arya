import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  type NewTaskInput,
  type Task,
  type TaskPatch,
  type TaskStatus,
  isTaskPriority,
  isTaskStatus,
  priorityRank,
  slugify,
} from './model';

export type TaskEventType = 'created' | 'updated' | 'moved' | 'removed';

export interface TaskEvent {
  type: TaskEventType;
  task: Task;
  previous?: Task;
  at: string;
}

export interface TaskFilter {
  status?: TaskStatus;
  assignee?: string;
}

const rand4 = (): string => Math.random().toString(36).slice(2, 6);

/**
 * A kanban task store backed by a directory of per-task YAML files
 * (`<dir>/<id>.yaml`). Both humans and agents drive it: manual edits on disk are
 * picked up via `reload()`, agent mutations go through `create/update/move/remove`
 * which persist and emit events for live wire sync.
 */
export class TaskStore {
  private tasks = new Map<string, Task>();
  private listeners = new Set<(e: TaskEvent) => void>();

  constructor(private readonly dir?: string) {}

  onEvent(cb: (e: TaskEvent) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(e: TaskEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Load all task files from the backing dir into memory. */
  load(): void {
    if (!this.dir || !existsSync(this.dir)) return;
    for (const file of readdirSync(this.dir).sort()) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      try {
        const task = this.parseTask(parseYaml(readFileSync(join(this.dir, file), 'utf-8')));
        if (task) this.tasks.set(task.id, task);
      } catch {
        /* skip malformed file */
      }
    }
  }

  /** Re-read the whole board from disk (for external/manual edits). */
  reload(): void {
    this.tasks.clear();
    this.load();
  }

  list(filter: TaskFilter = {}): Task[] {
    let out = [...this.tasks.values()];
    if (filter.status) out = out.filter((t) => t.status === filter.status);
    if (filter.assignee) out = out.filter((t) => t.assignee === filter.assignee);
    return out.sort(
      (a, b) =>
        priorityRank(b.priority) - priorityRank(a.priority) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(input: NewTaskInput): Task {
    const title = (input.title ?? '').trim();
    if (!title) throw new Error('task: title is required');
    if (input.status !== undefined && !isTaskStatus(input.status)) {
      throw new Error(`task: invalid status: ${String(input.status)}`);
    }
    if (input.priority !== undefined && !isTaskPriority(input.priority)) {
      throw new Error(`task: invalid priority: ${String(input.priority)}`);
    }
    const now = new Date().toISOString();
    const task: Task = {
      id: this.uniqueId(title),
      title,
      status: input.status ?? 'todo',
      assignee: input.assignee?.trim() || undefined,
      priority: input.priority ?? 'normal',
      notes: input.notes?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    };
    this.tasks.set(task.id, task);
    this.persist(task);
    this.emit({ type: 'created', task, at: now });
    return task;
  }

  update(id: string, patch: TaskPatch): Task {
    const cur = this.tasks.get(id);
    if (!cur) throw new Error(`task: not found: ${id}`);
    const previous = { ...cur };
    const next: Task = { ...cur };
    if (typeof patch.title === 'string' && patch.title.trim()) next.title = patch.title.trim();
    if ('assignee' in patch) next.assignee = patch.assignee?.trim() || undefined;
    if ('notes' in patch) next.notes = patch.notes?.trim() || undefined;
    if (patch.priority !== undefined) {
      if (!isTaskPriority(patch.priority)) throw new Error(`task: invalid priority: ${String(patch.priority)}`);
      next.priority = patch.priority;
    }
    next.updatedAt = new Date().toISOString();
    this.tasks.set(id, next);
    this.persist(next);
    this.emit({ type: 'updated', task: next, previous, at: next.updatedAt });
    return next;
  }

  move(id: string, status: TaskStatus): Task {
    if (!isTaskStatus(status)) throw new Error(`task: invalid status: ${String(status)}`);
    const cur = this.tasks.get(id);
    if (!cur) throw new Error(`task: not found: ${id}`);
    if (cur.status === status) return cur;
    const previous = { ...cur };
    const next: Task = { ...cur, status, updatedAt: new Date().toISOString() };
    this.tasks.set(id, next);
    this.persist(next);
    this.emit({ type: 'moved', task: next, previous, at: next.updatedAt });
    return next;
  }

  remove(id: string): boolean {
    const cur = this.tasks.get(id);
    if (!cur) return false;
    this.tasks.delete(id);
    if (this.dir) {
      try {
        rmSync(join(this.dir, `${id}.yaml`), { force: true });
        rmSync(join(this.dir, `${id}.yml`), { force: true });
      } catch {
        /* best effort */
      }
    }
    this.emit({ type: 'removed', task: cur, at: new Date().toISOString() });
    return true;
  }

  private uniqueId(title: string): string {
    const base = slugify(title) || 'task';
    let id = `${base}-${rand4()}`;
    while (this.tasks.has(id)) id = `${base}-${rand4()}`;
    return id;
  }

  private persist(task: Task): void {
    if (!this.dir) return;
    mkdirSync(this.dir, { recursive: true });
    writeFileSync(join(this.dir, `${task.id}.yaml`), stringifyYaml(task), 'utf-8');
  }

  private parseTask(raw: unknown): Task | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;
    const title = typeof o.title === 'string' ? o.title.trim() : '';
    if (!title) return null;
    const id = typeof o.id === 'string' && o.id ? o.id : slugify(title) || 'task';
    const now = new Date().toISOString();
    return {
      id,
      title,
      status: isTaskStatus(o.status) ? o.status : 'todo',
      assignee: typeof o.assignee === 'string' && o.assignee ? o.assignee : undefined,
      priority: isTaskPriority(o.priority) ? o.priority : 'normal',
      notes: typeof o.notes === 'string' && o.notes ? o.notes : undefined,
      createdAt: typeof o.createdAt === 'string' ? o.createdAt : now,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : now,
    };
  }
}
