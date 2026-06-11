import type { Skill } from 'mu-harness';

// Skill bodies use single-quoted lines (backticks stay literal) and `~~~` code
// fences (so they don't collide with markdown's ``` in the model's view).
const lines = (...l: string[]): string => l.join('\n');

const MANAGE_TASK = lines(
  'Scheduled tasks are YAML files at `definitions/tasks/<id>.yaml` (one task per file). They hot-reload — no restart for any action below.',
  '',
  '**Create** — use `write` to add a file:',
  '- `id` (required): unique id (letters/digits/`-`/`_`); also the filename.',
  '- `cron` (required): cron expression, e.g. "0 9 * * *" (5 fields) or with leading seconds (6 fields). Check the field count and ranges.',
  '- `prompt` (required): the instruction handed to the agent on each run.',
  '- `agent` (optional): which agent runs it (defaults to the primary agent).',
  '- `timezone` (optional): IANA timezone, e.g. "Europe/Paris".',
  '',
  '~~~yaml',
  'id: daily-standup',
  'cron: "0 9 * * *"',
  'prompt: Summarize the latest commits.',
  'agent: arya',
  '~~~',
  '',
  '**Edit** — `read` the file, then `edit` it (or `write` the full new content). Keep `id` matching the filename.',
  '**Delete** — remove the file.',
);

const MANAGE_AGENT = lines(
  'Sub-agents are Markdown files at `definitions/agents/<name>.md`. They hot-reload — delegatable via `subagent`, no restart for any action below.',
  '',
  '**Create** — use `write` to add a file. Frontmatter:',
  '- `name` (required): kebab-case; also the filename.',
  '- `description` (required): one line — shown in the delegation roster.',
  '- `color` (optional): hex, e.g. "#10B981".',
  '- `tools` (optional): per-tool grants — each tool maps to allow | ask | deny, or a nested {glob: decision} map. Omitted tools are denied; be least-privilege.',
  '',
  'The body is the system prompt. Example:',
  '~~~markdown',
  '---',
  'name: researcher',
  'description: Reads code and docs to answer focused questions.',
  'color: "#8B5CF6"',
  'tools:',
  '  read: allow',
  '  webfetch: allow',
  '  write: deny',
  '---',
  'You are a research sub-agent. Answer concisely, citing files.',
  '~~~',
  '',
  '**Edit** — `read` then `edit` (or `write`) the file. Keep `name` matching the filename.',
  '**Delete** — remove the file.',
);

const MANAGE_SKILL = lines(
  'Skills are `skills/<name>/SKILL.md` files. They hot-reload — loadable via `skill`, no restart for any action below.',
  '',
  '**Create** — use `write` to add `skills/<name>/SKILL.md`. Frontmatter:',
  '- `name` (required): kebab-case; must match the directory name.',
  '- `description` (required): one line on when to use it.',
  '',
  'The body is the instructions to follow. Example:',
  '~~~markdown',
  '---',
  'name: release-notes',
  'description: Draft release notes from the commit log since the last tag.',
  '---',
  '1. Run git log <last-tag>..HEAD --oneline.',
  '2. Group commits by type (feat / fix / chore).',
  '3. Write a concise changelog.',
  '~~~',
  '',
  '**Edit** — `read` then `edit` (or `write`) the SKILL.md. Keep `name` matching the directory.',
  '**Delete** — remove the skill directory.',
);

export const BUILTIN_SKILLS: Skill[] = [
  {
    name: 'manage-task',
    description: 'Create, edit, or delete a scheduled (cron) task. Use for any recurring or timed work to automate.',
    prompt: MANAGE_TASK,
  },
  {
    name: 'manage-agent',
    description:
      'Create, edit, or delete a sub-agent (persona + tool permissions) to delegate to. Use for a reusable role.',
    prompt: MANAGE_AGENT,
  },
  {
    name: 'manage-skill',
    description: 'Create, edit, or delete a skill (a reusable workflow loaded on demand). Use to capture a procedure.',
    prompt: MANAGE_SKILL,
  },
];
