export const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'in_review', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assignee?: string;
  priority: TaskPriority;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewTaskInput {
  title: string;
  status?: TaskStatus;
  assignee?: string;
  priority?: TaskPriority;
  notes?: string;
}

export type TaskPatch = Partial<
  Pick<Task, 'title' | 'assignee' | 'priority' | 'notes'>
>;

export const isTaskStatus = (v: unknown): v is TaskStatus =>
  typeof v === 'string' && (TASK_STATUSES as readonly string[]).includes(v);

export const isTaskPriority = (v: unknown): v is TaskPriority =>
  typeof v === 'string' && (TASK_PRIORITIES as readonly string[]).includes(v);

export const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

/** Priority weight for sorting (higher = more urgent). */
export const priorityRank = (p: TaskPriority): number => TASK_PRIORITIES.indexOf(p);
