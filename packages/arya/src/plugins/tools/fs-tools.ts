/**
 * Filesystem tools for arya-agent.
 *
 * Tools:
 *  - read_file  : Read file content with optional line range
 *  - write_file : Write/overwrite a file
 *  - list_dir   : List directory contents
 *
 * Each tool declares a permission.matchKey so agent definitions can
 * authorise them via globs (e.g. src/...: allow, .../.env: deny).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import type { PluginTool } from 'mu-core';

/** Resolve a potentially relative path against cwd, rejecting escapes. */
function safePath(rawPath: string, cwd: string): string | null {
  if (typeof rawPath !== 'string' || !rawPath.length) return null;
  const resolved = rawPath.startsWith('/') ? rawPath : resolve(cwd, rawPath);
  // Prevent directory traversal outside cwd
  if (!resolved.startsWith(cwd + '/') && resolved !== cwd) return null;
  return resolved;
}

/* ── read_file ─────────────────────────────────────────────────────────────── */

export function createReadFileTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'fs.read_file',
        description: 'Read the contents of a text file. Supports optional line range (1-indexed).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative file path.' },
            start: { type: 'integer', description: '1-indexed first line (inclusive).' },
            end: { type: 'integer', description: '1-indexed last line (inclusive).' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'reading',
      kind: 'file-read',
      fields: { path: 'path' },
    },
    permission: {
      matchKey: (args) => (args.path as string) ?? undefined,
    },
    execute(args) {
      const cwd = getCwd();
      const rawPath = args.path as string;
      const resolved = safePath(rawPath, cwd);
      if (!resolved) return { content: `Error: Invalid or disallowed path: ${rawPath}`, error: true };
      if (!existsSync(resolved)) return { content: `Error: File not found: ${resolved}`, error: true };
      if (statSync(resolved).isDirectory()) return { content: `Error: Path is a directory: ${resolved}`, error: true };

      try {
        const content = readFileSync(resolved, 'utf-8');
        const lines = content.split('\n');
        const totalLines = lines.length;
        const startLine = Math.max(1, (args.start as number) ?? 1);
        const endLine = (args.end as number) ?? totalLines;
        const clampedStart = Math.min(startLine, totalLines);
        const clampedEnd = Math.min(endLine, totalLines);

        if (clampedStart > clampedEnd) {
          return { content: `Error: start line (${startLine}) exceeds end line (${endLine})` };
        }

        const selected = lines.slice(clampedStart - 1, clampedEnd);
        const numbered = selected.map((line, i) => `${String(clampedStart + i).padStart(4)} │ ${line}`).join('\n');
        const header = `── ${resolved} (lines ${clampedStart}-${clampedEnd}, ${selected.length} lines) ──`;
        return { content: `${header}\n${numbered}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error reading file: ${msg}`, error: true };
      }
    },
  };
}

/* ── write_file ────────────────────────────────────────────────────────────── */

export function createWriteFileTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'fs.write_file',
        description: 'Write content to a file. Creates parent directories if they do not exist.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Absolute or relative file path.' },
            content: { type: 'string', description: 'File content to write.' },
          },
          required: ['path', 'content'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'writing',
      kind: 'file-write',
      fields: { path: 'path' },
    },
    permission: {
      matchKey: (args) => (args.path as string) ?? undefined,
    },
    execute(args) {
      const cwd = getCwd();
      const rawPath = args.path as string;
      const content = args.content as string;
      const resolved = safePath(rawPath, cwd);
      if (!resolved) return { content: `Error: Invalid or disallowed path: ${rawPath}`, error: true };

      try {
        // Ensure parent directories exist
        const parentDir = dirname(resolved);
        if (!existsSync(parentDir)) {
          mkdirSync(parentDir, { recursive: true });
        }
        writeFileSync(resolved, content, 'utf-8');
        return { content: `Successfully wrote ${content.split('\n').length} line(s) to ${resolved}` };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error writing file: ${msg}`, error: true };
      }
    },
  };
}

/* ── list_dir ──────────────────────────────────────────────────────────────── */

export function createListDirTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'fs.list_dir',
        description: 'List the contents of a directory. Optionally recurse with a depth limit.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Directory path to list.' },
            recursive: { type: 'boolean', description: 'Recursively list subdirectories.' },
            depth: { type: 'integer', description: 'Max recursion depth (default: 2).' },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'listing',
      kind: 'directory',
      fields: { path: 'path' },
    },
    permission: {
      matchKey: (args) => (args.path as string) ?? undefined,
    },
    execute(args) {
      const cwd = getCwd();
      const rawPath = args.path as string;
      const resolved = safePath(rawPath, cwd);
      if (!resolved) return { content: `Error: Invalid or disallowed path: ${rawPath}`, error: true };
      if (!existsSync(resolved)) return { content: `Error: Directory not found: ${resolved}`, error: true };
      if (!statSync(resolved).isDirectory()) return { content: `Error: Path is not a directory: ${resolved}`, error: true };

      try {
        const recursive = (args.recursive as boolean) ?? false;
        const maxDepth = (args.depth as number) ?? 2;
        const lines = listDirRecursive(resolved, '', 0, maxDepth, recursive);
        return { content: lines || '(empty directory)' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: `Error listing directory: ${msg}`, error: true };
      }
    },
  };
}

function listDirRecursive(dir: string, prefix: string, depth: number, maxDepth: number, recursive: boolean): string {
  const entries = readdirSync(dir).sort();
  const lines: string[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const isLast = i === entries.length - 1;
    const connector = isLast ? '└── ' : '├── ';
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    const icon = stat.isDirectory() ? '📁' : '📄';
    lines.push(`${prefix}${connector}${icon} ${entry}`);

    if (recursive && stat.isDirectory() && depth < maxDepth) {
      const extension = isLast ? '    ' : '│   ';
      lines.push(listDirRecursive(fullPath, prefix + extension, depth + 1, maxDepth, recursive));
    }
  }

  return lines.join('\n');
}
