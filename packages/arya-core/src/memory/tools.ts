// Memory tools — the agent-facing surface of the markdown MemoryStore. Registered
// into the harness tool set so the agent persists durable facts across sessions.
//
// The store is two human-editable files (MEMORY.md / USER.md); edits are
// substring-addressed (a unique snippet), not by numeric id, so a human editing
// the files by hand never breaks what the agent sees.

import type { Tool } from 'mu-core';
import type { MemoryStore, MemoryTarget } from './store';

const text = (s: string) => [{ type: 'text' as const, text: s }];
const asTarget = (v: unknown): MemoryTarget => (v === 'user' ? 'user' : 'memory');
const targetOf = (input: unknown): MemoryTarget => asTarget((input as { target?: unknown } | undefined)?.target);

export function createMemoryTools(store: MemoryStore): Tool[] {
  const save: Tool = {
    name: 'memory_save',
    description:
      'Append a durable fact to long-term memory. target="memory" (default) for the agent\'s own notes (conventions, decisions, facts); target="user" for the user profile (preferences, context about the person). The store is bounded — if it is full, consolidate with memory_replace or memory_forget first.',
    parameters: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'The fact or note to remember.' },
        target: { type: 'string', enum: ['memory', 'user'], description: 'Which store: "memory" (default) or "user" profile.' },
      },
      required: ['content'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { content, target } = (input ?? {}) as { content?: string; target?: string };
      if (!content || !content.trim()) return text('Error: memory_save requires non-empty `content`.');
      const t = asTarget(target);
      const r = store.add(t, content);
      return text(r.ok ? `Saved to ${t}. ${r.message}${r.usage ? ` (${r.usage})` : ''}` : `Not saved: ${r.message}`);
    },
  };

  const recall: Tool = {
    name: 'memory_recall',
    description: 'Search long-term memory (both MEMORY.md and USER.md) for entries matching a query.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search terms.' },
        limit: { type: 'number', description: 'Max results (default 10).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { query, limit } = (input ?? {}) as { query?: string; limit?: number };
      if (!query) return text('Error: memory_recall requires `query`.');
      const hits = store.recall(query, typeof limit === 'number' ? limit : 10);
      if (!hits.length) return text(`No memories match "${query}".`);
      return text(hits.map((h) => `[${h.target}] ${h.entry}`).join('\n'));
    },
  };

  const list: Tool = {
    name: 'memory_list',
    description: 'List the entries in a memory file (default: MEMORY.md; pass target="user" for the profile).',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['memory', 'user'], description: 'Which store: "memory" (default) or "user" profile.' },
      },
      additionalProperties: false,
    },
    run: async (input) => {
      const t = targetOf(input);
      const items = store.list(t);
      if (!items.length) return text(`${t} memory is empty.`);
      return text(items.map((e, i) => `${i + 1}. ${e}`).join('\n'));
    },
  };

  const forget: Tool = {
    name: 'memory_forget',
    description: 'Remove the memory entry containing a unique snippet of text (old_text). Must match exactly one entry.',
    parameters: {
      type: 'object',
      properties: {
        old_text: { type: 'string', description: 'A snippet that uniquely identifies the entry to remove.' },
        target: { type: 'string', enum: ['memory', 'user'], description: 'Which store: "memory" (default) or "user" profile.' },
      },
      required: ['old_text'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { old_text } = (input ?? {}) as { old_text?: string };
      if (!old_text || !old_text.trim()) return text('Error: memory_forget requires `old_text`.');
      const r = store.remove(targetOf(input), old_text);
      return text(r.ok ? r.message : `Not removed: ${r.message}`);
    },
  };

  const replace: Tool = {
    name: 'memory_replace',
    description: 'Replace the memory entry containing old_text with new_content. Use to merge or update a fact in place.',
    parameters: {
      type: 'object',
      properties: {
        old_text: { type: 'string', description: 'A snippet that uniquely identifies the entry to replace.' },
        new_content: { type: 'string', description: 'The replacement content.' },
        target: { type: 'string', enum: ['memory', 'user'], description: 'Which store: "memory" (default) or "user" profile.' },
      },
      required: ['old_text', 'new_content'],
      additionalProperties: false,
    },
    run: async (input) => {
      const { old_text, new_content } = (input ?? {}) as { old_text?: string; new_content?: string };
      if (!old_text || !old_text.trim()) return text('Error: memory_replace requires `old_text`.');
      if (!new_content || !new_content.trim()) return text('Error: memory_replace requires `new_content`.');
      const r = store.replace(targetOf(input), old_text, new_content);
      return text(r.ok ? `${r.message}${r.usage ? ` (${r.usage})` : ''}` : `Not replaced: ${r.message}`);
    },
  };

  return [save, recall, list, forget, replace];
}
