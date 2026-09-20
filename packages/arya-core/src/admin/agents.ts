import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

export interface AdminAgentInput {
  name: string;
  description?: string;
  color?: string;
  prompt: string;
  /** Permission map, same shape as the agent frontmatter `tools:` block. */
  tools?: Record<string, unknown>;
}

export interface AdminAgentSummary {
  name: string;
  file: string;
  description: string;
  color?: string;
}

const slug = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

/** Minimal `---` frontmatter splitter (matches the mu-coding agent file shape). */
export function splitFrontmatter(src: string): { fields: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(src);
  if (!m) return { fields: {}, body: src };
  let fields: Record<string, unknown> = {};
  try {
    const parsed = parseYaml(m[1]);
    if (parsed && typeof parsed === 'object') fields = parsed as Record<string, unknown>;
  } catch {
    /* malformed frontmatter → treat as no fields */
  }
  return { fields, body: m[2] ?? '' };
}

/** Write an agent definition as `<dir>/<slug(name)>.md` with YAML frontmatter. */
export function writeAgentFile(dir: string, input: AdminAgentInput): string {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('agent: name is required');
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(name)) {
    throw new Error('agent: name must be alphanumeric (with - / _), no spaces');
  }
  if (!(input.prompt ?? '').trim()) throw new Error('agent: prompt is required');
  const fm: Record<string, unknown> = { name };
  if (input.description?.trim()) fm.description = input.description.trim();
  if (input.color?.trim()) fm.color = input.color.trim();
  if (input.tools && Object.keys(input.tools).length > 0) fm.tools = input.tools;
  const content = `---\n${stringifyYaml(fm)}---\n${input.prompt.trim()}\n`;
  mkdirSync(dir, { recursive: true });
  const file = `${slug(name)}.md`;
  writeFileSync(join(dir, file), content, 'utf-8');
  return file;
}

/** List agent definition files in `dir` (name + description), without full parse. */
export function listAgentFiles(dir: string): AdminAgentSummary[] {
  if (!existsSync(dir)) return [];
  const out: AdminAgentSummary[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.md')).sort()) {
    try {
      const { fields } = splitFrontmatter(readFileSync(join(dir, file), 'utf-8'));
      out.push({
        name: typeof fields.name === 'string' && fields.name ? fields.name : basename(file, '.md'),
        file,
        description: typeof fields.description === 'string' ? fields.description : '',
        color: typeof fields.color === 'string' ? fields.color : undefined,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out;
}

/** Delete an agent definition file by its on-disk file name (safety-checked). */
export function deleteAgentFile(dir: string, file: string): boolean {
  if (!file.endsWith('.md') || file.includes('/') || file.includes('..')) {
    throw new Error('agent: invalid file name');
  }
  const full = join(dir, file);
  if (!existsSync(full)) return false;
  rmSync(full, { force: true });
  return true;
}
