// Agent memory — a bounded, file-backed curated store, in Markdown.
//
// Two human-editable files live in the store dir:
//   MEMORY.md  — the agent's own durable notes (conventions, decisions, facts)
//   USER.md    — the user profile (preferences, context about the person)
//
// Entries are separated by a section-sign delimiter (U+00A7) so a bare "§" in
// prose survives a round-trip. The model mirrors Hermes' builtin memory:
//   * char-bounded per target — overflow asks the agent to consolidate
//   * dedup on load
//   * substring-addressed edits (add / replace / remove) — no numeric ids, so a
//     human editing the file by hand never breaks addressing
//   * atomic writes (temp + rename) and a re-read before every mutation, so an
//     external edit between turns is picked up rather than clobbered
//
// No DB, no native build step — just files you can `cat` and `git diff`.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type MemoryTarget = 'memory' | 'user';

export const ENTRY_DELIMITER = '\n§\n';
export const DEFAULT_MEMORY_CHAR_LIMIT = 2200;
export const DEFAULT_USER_CHAR_LIMIT = 1375;

export interface MemoryStoreOptions {
  memoryCharLimit?: number;
  userCharLimit?: number;
}

export interface MemoryResult {
  ok: boolean;
  message: string;
  usage?: string;
  matches?: string[];
}

const parseEntries = (raw: string): string[] =>
  raw.split(ENTRY_DELIMITER).map((e) => e.trim()).filter(Boolean);

const dedupe = (entries: string[]): string[] => [...new Map(entries.map((e) => [e, e])).values()];

export class MemoryStore {
  private readonly dir: string;
  private readonly limits: Record<MemoryTarget, number>;

  constructor(dir: string, opts: MemoryStoreOptions = {}) {
    this.dir = dir;
    this.limits = {
      memory: opts.memoryCharLimit ?? DEFAULT_MEMORY_CHAR_LIMIT,
      user: opts.userCharLimit ?? DEFAULT_USER_CHAR_LIMIT,
    };
    mkdirSync(this.dir, { recursive: true });
  }

  pathFor(target: MemoryTarget): string {
    return join(this.dir, target === 'user' ? 'USER.md' : 'MEMORY.md');
  }

  private readEntries(target: MemoryTarget): string[] {
    const p = this.pathFor(target);
    if (!existsSync(p)) return [];
    try {
      return dedupe(parseEntries(readFileSync(p, 'utf-8')));
    } catch {
      return [];
    }
  }

  private writeEntries(target: MemoryTarget, entries: string[]): void {
    const p = this.pathFor(target);
    mkdirSync(dirname(p), { recursive: true });
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, entries.join(ENTRY_DELIMITER), 'utf-8');
    renameSync(tmp, p);
  }

  private usage(target: MemoryTarget): string {
    return `${this.readEntries(target).join(ENTRY_DELIMITER).length}/${this.limits[target]} chars`;
  }

  add(target: MemoryTarget, content: string): MemoryResult {
    const trimmed = content.trim();
    if (!trimmed) return { ok: false, message: 'Content cannot be empty.' };
    const entries = this.readEntries(target);
    if (entries.includes(trimmed)) {
      return { ok: true, message: 'Entry already exists (no duplicate added).', usage: this.usage(target) };
    }
    const projected = entries.length ? entries.join(ENTRY_DELIMITER).length + ENTRY_DELIMITER.length + trimmed.length : trimmed.length;
    if (projected > this.limits[target]) {
      return {
        ok: false,
        message:
          `Memory at ${this.usage(target)}. Adding this entry (${trimmed.length} chars) would exceed the limit. ` +
          'Consolidate: use memory_replace to merge overlapping entries into shorter ones, or memory_forget to drop stale ones, then retry.',
        usage: this.usage(target),
        matches: entries,
      };
    }
    this.writeEntries(target, [...entries, trimmed]);
    return { ok: true, message: 'Entry added.', usage: this.usage(target) };
  }

  replace(target: MemoryTarget, oldText: string, newContent: string): MemoryResult {
    const old = oldText.trim();
    const next = newContent.trim();
    if (!old) return { ok: false, message: 'old_text cannot be empty.' };
    if (!next) return { ok: false, message: 'new_content cannot be empty. Use memory_forget to delete.' };
    const entries = this.readEntries(target);
    const match = this.findUnique(entries, old);
    if (match.ambiguous) return { ok: false, message: `Multiple entries matched "${old}". Be more specific.`, matches: match.all };
    if (match.index === -1) return { ok: false, message: `No entry matched "${old}".`, matches: entries };
    const replaced = [...entries];
    replaced[match.index] = next;
    if (replaced.join(ENTRY_DELIMITER).length > this.limits[target]) {
      return { ok: false, message: `Replacement would exceed the limit (${this.usage(target)}). Shorten the new content.`, matches: entries };
    }
    this.writeEntries(target, replaced);
    return { ok: true, message: 'Entry replaced.', usage: this.usage(target) };
  }

  remove(target: MemoryTarget, oldText: string): MemoryResult {
    const old = oldText.trim();
    if (!old) return { ok: false, message: 'old_text cannot be empty.' };
    const entries = this.readEntries(target);
    const match = this.findUnique(entries, old);
    if (match.ambiguous) return { ok: false, message: `Multiple entries matched "${old}". Be more specific.`, matches: match.all };
    if (match.index === -1) return { ok: false, message: `No entry matched "${old}".`, matches: entries };
    const removed = [...entries];
    removed.splice(match.index, 1);
    this.writeEntries(target, removed);
    return { ok: true, message: 'Entry removed.', usage: this.usage(target) };
  }

  private findUnique(entries: string[], needle: string): { index: number; ambiguous: boolean; all: string[] } {
    let index = -1;
    const all: string[] = [];
    entries.forEach((e, i) => {
      if (e.includes(needle)) {
        if (index === -1) index = i;
        all.push(e);
      }
    });
    return { index, ambiguous: new Set(all).size > 1, all };
  }

  recall(query: string, limit = 10): Array<{ target: MemoryTarget; entry: string }> {
    const q = query.trim().toLowerCase();
    const out: Array<{ target: MemoryTarget; entry: string }> = [];
    if (!q) return out;
    for (const target of ['memory', 'user'] as MemoryTarget[]) {
      for (const entry of this.readEntries(target)) {
        if (entry.toLowerCase().includes(q)) out.push({ target, entry });
      }
    }
    return out.slice(0, limit);
  }

  list(target: MemoryTarget): string[] {
    return this.readEntries(target);
  }

  count(target: MemoryTarget): number {
    return this.readEntries(target).length;
  }

  /** Render both files as a compact, injectable block, bounded by `maxChars`. */
  digest(maxChars = 1200): string {
    const sections: string[] = [];
    let used = 0;
    for (const [target, label] of [['memory', 'MEMORY.md'], ['user', 'USER.md']] as Array<[MemoryTarget, string]>) {
      const entries = this.readEntries(target);
      if (!entries.length) continue;
      const lines: string[] = [`### ${label}`];
      let secLen = label.length + 4;
      for (const e of entries) {
        const line = `- ${e}`;
        if (used + secLen + line.length + 1 > maxChars) break;
        lines.push(line);
        secLen += line.length + 1;
      }
      if (lines.length === 1) continue; // no room for any entry under this header
      sections.push(...lines);
      used += secLen;
    }
    if (!sections.length) return '';
    return `## Memory (curated)\n${sections.join('\n')}`;
  }

  close(): void {
    // File-backed: no persistent handle to release. Kept for interface parity.
  }
}
