import type { Task } from './model';
import type { TaskEvent } from './store';
import type { WireTask, WireTaskEvent } from '../ws/protocol';

export const toWireTask = (t: Task): WireTask => ({
  id: t.id,
  title: t.title,
  status: t.status,
  assignee: t.assignee,
  priority: t.priority,
  notes: t.notes,
  createdAt: t.createdAt,
  updatedAt: t.updatedAt,
});

export const toWireTaskEvent = (e: TaskEvent): WireTaskEvent => {
  const task = toWireTask(e.task);
  if (e.type === 'created') return { type: 'created', task, at: e.at };
  if (e.type === 'removed') return { type: 'removed', task, at: e.at };
  const previous = toWireTask(e.previous ?? e.task);
  return { type: e.type, task, previous, at: e.at };
};

export * from './model';
export { TaskStore, type TaskEvent, type TaskEventType, type TaskFilter } from './store';
export { createTaskTools } from './tools';
