import { type ContentPart, text } from 'mu-core';
import type { Tool } from 'mu-core';
import { type TaskStore, type TaskFilter } from './store';
import { type Task, TASK_PRIORITIES, TASK_STATUSES, isTaskPriority, isTaskStatus } from './model';

const asObj = (input: unknown): Record<string, unknown> =>
  (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const fmt = (t: Task): string => {
  const bits = [`[${t.id}]`, t.title, `(${t.status})`];
  if (t.assignee) bits.push(`@${t.assignee}`);
  if (t.priority !== 'normal') bits.push(`!${t.priority}`);
  return bits.join(' ');
};

/**
 * Kanban task tools. Agents create, read, update and move tasks on the shared
 * board; the store persists to disk and emits wire events so views stay in sync.
 * Read tools are safe; create/update/move/remove are mutating and gated by the
 * caller's permission profile.
 */
export const createTaskTools = (store: TaskStore): Tool[] => [
  {
    name: 'task_create',
    description: `Create a task on the board. status ∈ {${TASK_STATUSES.join(', ')}} (default todo); priority ∈ {${TASK_PRIORITIES.join(', ')}} (default normal).`,
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        status: { type: 'string', enum: [...TASK_STATUSES] },
        assignee: { type: 'string' },
        priority: { type: 'string', enum: [...TASK_PRIORITIES] },
        notes: { type: 'string' },
      },
      required: ['title'],
    },
    run: async (input): Promise<ContentPart[]> => {
      const o = asObj(input);
      const t = store.create({
        title: str(o.title),
        status: isTaskStatus(o.status) ? o.status : undefined,
        assignee: str(o.assignee) || undefined,
        priority: isTaskPriority(o.priority) ? o.priority : undefined,
        notes: str(o.notes) || undefined,
      });
      return [text(`created ${fmt(t)}`)];
    },
  },
  {
    name: 'task_list',
    description: 'List tasks, optionally filtered by status and/or assignee. Sorted by priority then recency.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...TASK_STATUSES] },
        assignee: { type: 'string' },
      },
    },
    run: async (input): Promise<ContentPart[]> => {
      const o = asObj(input);
      const filter: TaskFilter = {};
      if (isTaskStatus(o.status)) filter.status = o.status;
      if (str(o.assignee)) filter.assignee = str(o.assignee);
      const tasks = store.list(filter);
      if (tasks.length === 0) return [text('no tasks')];
      return [text(tasks.map(fmt).join('\n'))];
    },
  },
  {
    name: 'task_get',
    description: 'Get one task by id, including its notes.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: async (input): Promise<ContentPart[]> => {
      const t = store.get(str(asObj(input).id));
      if (!t) return [text('task not found')];
      const lines = [fmt(t)];
      if (t.notes) lines.push(`notes: ${t.notes}`);
      lines.push(`created: ${t.createdAt}  updated: ${t.updatedAt}`);
      return [text(lines.join('\n'))];
    },
  },
  {
    name: 'task_update',
    description: 'Update a task title/assignee/priority/notes (not status — use task_move).',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        assignee: { type: 'string' },
        priority: { type: 'string', enum: [...TASK_PRIORITIES] },
        notes: { type: 'string' },
      },
      required: ['id'],
    },
    run: async (input): Promise<ContentPart[]> => {
      const o = asObj(input);
      const t = store.update(str(o.id), {
        title: typeof o.title === 'string' ? o.title : undefined,
        assignee: typeof o.assignee === 'string' ? o.assignee : undefined,
        priority: o.priority !== undefined ? (isTaskPriority(o.priority) ? o.priority : (undefined as never)) : undefined,
        notes: typeof o.notes === 'string' ? o.notes : undefined,
      });
      return [text(`updated ${fmt(t)}`)];
    },
  },
  {
    name: 'task_move',
    description: `Move a task to a new column. status ∈ {${TASK_STATUSES.join(', ')}}.`,
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        status: { type: 'string', enum: [...TASK_STATUSES] },
      },
      required: ['id', 'status'],
    },
    run: async (input): Promise<ContentPart[]> => {
      const o = asObj(input);
      if (!isTaskStatus(o.status)) return [text(`invalid status: ${str(o.status)}`)];
      const t = store.move(str(o.id), o.status);
      return [text(`moved ${t.id} → ${t.status}`)];
    },
  },
];
