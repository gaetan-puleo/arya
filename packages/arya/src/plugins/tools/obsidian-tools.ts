/**
 * Obsidian vault tools.
 *
 * Tools:
 *  - obsidian-search   : Search note content and frontmatter for keywords
 *  - obsidian-tags     : Find notes containing a specific tag
 *  - obsidian-list     : List all notes in the vault
 *  - obsidian-read     : Read full content of a specific note
 *  - obsidian-backlinks : Find notes that link to a target note
 *
 * Requires OBSIDIAN_VAULT_PATH environment variable.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import type { PluginTool } from 'mu-core';

const VAULT_EXCLUDE_DIRS = new Set([
  '.obsidian', '.git', '_attachments', '__pycache__', 'node_modules',
]);

function getVaultPath(): string {
  const env = process.env.OBSIDIAN_VAULT_PATH?.trim();
  if (!env) throw new Error('OBSIDIAN_VAULT_PATH environment variable is not set');
  return resolve(env);
}

async function* walkVault(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (VAULT_EXCLUDE_DIRS.has(entry.name)) continue;
      yield* walkVault(join(dir, entry.name));
    } else if (entry.isFile() && extname(entry.name) === '.md') {
      yield join(dir, entry.name);
    }
  }
}

function extractTags(raw: string): string[] {
  // Simple frontmatter tag extraction (no gray-matter dependency)
  const tags: string[] = [];
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch) {
    const fm = fmMatch[1];
    const tagMatch = fm.match(/tags:\s*\[([^\]]*)\]/i);
    if (tagMatch) {
      tagMatch[1].split(',').forEach((t) => {
        const trimmed = t.trim().replace(/^#/, '');
        if (trimmed) tags.push(trimmed);
      });
    }
  }
  // Inline tags
  const inlineTags = raw.match(/#[a-zA-Z][a-zA-Z0-9_-]*/g);
  if (inlineTags) tags.push(...inlineTags.map((t) => t.replace(/^#/, '')));
  return [...new Set(tags)];
}

function noteContains(raw: string, query: string): boolean {
  return raw.toLowerCase().includes(query.toLowerCase());
}

function snippetAround(text: string, query: string, window = 120): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text.slice(0, window);
  const start = Math.max(0, idx - window / 2);
  const end = Math.min(text.length, idx + query.length + window / 2);
  const snippet = text.slice(start, end);
  return (start > 0 ? '…' : '') + snippet + (end < text.length ? '…' : '');
}

function relPath(subPath: string | undefined, filePath: string): string {
  const vault = getVaultPath();
  const rel = filePath.startsWith(vault) ? filePath.slice(vault.length) : filePath;
  return subPath ? join(subPath, rel) : rel;
}

function formatNoteContent(raw: string): string {
  const tags = extractTags(raw);
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  const lines: string[] = [];

  if (fmMatch) {
    lines.push('---');
    lines.push(fmMatch[1]);
    lines.push('---');
  }

  if (tags.length > 0) lines.push(`Tags: ${tags.join(', ')}`);
  lines.push('');
  lines.push(fmMatch ? fmMatch[2] : raw);
  return lines.join('\n');
}

async function scanVault(
  vault: string,
  subPath: string | undefined,
  maxResults: number,
  check: (filePath: string, raw: string, rp: string) => boolean,
): Promise<{ relPath: string; raw: string }[]> {
  const searchDir = subPath ? join(vault, subPath) : vault;
  const results: { relPath: string; raw: string }[] = [];

  for await (const filePath of walkVault(searchDir)) {
    try {
      const raw = await readFile(filePath, 'utf8');
      const rp = relPath(subPath, filePath);
      if (check(filePath, raw, rp)) {
        results.push({ relPath: rp, raw });
        if (results.length >= maxResults) break;
      }
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

export function createObsidianSearchTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'obsidian-search',
        description: 'Search note content and frontmatter for keywords across the Obsidian vault.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query (matched case-insensitively in content and frontmatter)' },
            path: { type: 'string', description: 'Subdirectory within the vault to search' },
            limit: { type: 'integer', description: 'Max results to return (default: 20, max: 100)' },
          },
          required: ['query'],
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const vault = getVaultPath();
      const { query, path: subPath, limit } = args as { query: string; path?: string; limit?: number };
      const maxResults = Math.min(Math.max(limit ?? 20, 1), 100);

      const results = await scanVault(vault, subPath, maxResults, (_fp, raw) =>
        noteContains(raw, query),
      );

      if (!results.length) return `No notes found matching "${query}".`;

      const rows = results.map(
        (r) => `| ${r.relPath} | - | ${snippetAround(r.raw, query, 100)} |`,
      );
      return [
        '| Path | Tags | Snippet |',
        '|------|------|---------|',
        ...rows,
        '',
        `Total: ${results.length} note(s)`,
      ].join('\n');
    },
  };
}

export function createObsidianTagsTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'obsidian-tags',
        description: 'Find notes containing a specific tag (from frontmatter or inline #tags).',
        parameters: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Tag to search for (without the # symbol)' },
            path: { type: 'string', description: 'Subdirectory within the vault to search' },
            limit: { type: 'integer', description: 'Max results to return (default: 20, max: 100)' },
          },
          required: ['tag'],
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const vault = getVaultPath();
      const { tag, path: subPath, limit } = args as { tag: string; path?: string; limit?: number };
      const maxResults = Math.min(Math.max(limit ?? 20, 1), 100);
      const normalizedTag = tag.trim().toLowerCase();

      const results = await scanVault(vault, subPath, maxResults, (_fp, raw, _rp) => {
        const tags = extractTags(raw);
        return tags.some((t) => t.toLowerCase().replace(/^#/, '') === normalizedTag);
      });

      if (!results.length) return `No notes found with tag "${tag}".`;

      const rows = results.map((r) => {
        const tags = extractTags(r.raw);
        const matching = tags.filter((t) => t.toLowerCase().replace(/^#/, '') === normalizedTag);
        const others = tags.filter((t) => !matching.includes(t));
        return `| ${r.relPath} | ${matching.join(', ')} | ${others.join(', ') || '-'} |`;
      });
      return [
        '| Path | Target Tag | Other Tags |',
        '|------|------------|------------|',
        ...rows,
        '',
        `Total: ${results.length} note(s)`,
      ].join('\n');
    },
  };
}

export function createObsidianListTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'obsidian-list',
        description: 'List all notes in the Obsidian vault (optionally restricted to a subdirectory).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Subdirectory within the vault to list' },
          },
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const vault = getVaultPath();
      const { path: subPath } = args as { path?: string };

      const searchDir = subPath ? join(vault, subPath) : vault;
      const files: string[] = [];

      for await (const filePath of walkVault(searchDir)) {
        files.push(relPath(subPath, filePath));
      }

      if (!files.length) return `No notes found${subPath ? ` in "${subPath}"` : ''}.`;

      const sorted = files.sort();
      return [
        '| # | Path |',
        '|---|------|',
        ...sorted.map((f, i) => `| ${i + 1} | ${f} |`),
        '',
        `Total: ${sorted.length} note(s)`,
      ].join('\n');
    },
  };
}

export function createObsidianReadTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'obsidian-read',
        description: 'Read the full content of a specific note by its path relative to the vault root.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Note path relative to vault root (e.g. "projects/alpha.md")' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const vault = getVaultPath();
      const notePath = (args as { path: string }).path.trim();
      if (!notePath) throw new Error('Path is required');

      const filePath = join(vault, notePath.endsWith('.md') ? notePath : `${notePath}.md`);
      const resolved = resolve(filePath);

      if (!resolved.startsWith(vault)) {
        throw new Error(`Path "${notePath}" resolves outside the vault`);
      }

      try {
        const raw = await readFile(filePath, 'utf8');
        return formatNoteContent(raw);
      } catch (err: unknown) {
        const e = err as { code?: string; message?: string };
        if (e?.code === 'ENOENT') {
          throw new Error(`Note not found: "${notePath}" (tried "${filePath}")`);
        }
        throw new Error(`Failed to read note "${notePath}": ${e?.message || String(err)}`);
      }
    },
  };
}

export function createObsidianBacklinksTool(): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'obsidian-backlinks',
        description: 'Find notes that contain a wiki-link ([[...]]) to a target note.',
        parameters: {
          type: 'object',
          properties: {
            target: { type: 'string', description: 'Target note filename (with or without .md)' },
            path: { type: 'string', description: 'Subdirectory within the vault to search' },
            limit: { type: 'integer', description: 'Max results to return (default: 20, max: 100)' },
          },
          required: ['target'],
          additionalProperties: false,
        },
      },
    },
    permission: {
      matchKey: () => undefined,
    },
    async execute(args) {
      const vault = getVaultPath();
      const { target, path: subPath, limit } = args as { target: string; path?: string; limit?: number };
      const maxResults = Math.min(Math.max(limit ?? 20, 1), 100);

      const targetName = target.trim().replace(/\.md$/, '');
      const patterns = [`[[${targetName}]]`, `[[${targetName}|`];

      const results = await scanVault(vault, subPath, maxResults, (_fp, raw, _rp) =>
        patterns.some((p) => raw.toLowerCase().includes(p)),
      );

      if (!results.length) return `No notes found linking to "${target}".`;

      const rows = results.map((r) => {
        const matching = r.raw
          .split('\n')
          .filter((l) => patterns.some((p) => l.toLowerCase().includes(p)))
          .slice(0, 3)
          .join('\n')
          .trim();
        return `| ${r.relPath} | ${matching.slice(0, 120)}${matching.length > 120 ? '…' : ''} |`;
      });
      return [
        '| Path | Linked Line |',
        '|------|-------------|',
        ...rows,
        '',
        `Total: ${results.length} note(s)`,
      ].join('\n');
    },
  };
}
