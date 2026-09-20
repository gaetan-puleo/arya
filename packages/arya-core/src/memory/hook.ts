// Memory injection hook — a prepareRequest hook that appends the curated memory
// digest and a standing persistence nudge to the system prompt, so the agent
// sees what it already knows on every turn without spending a tool call.
//
// Passed to createHarness as `hooks`. It merges with the harness's own hooks
// (env block, allow-list); the digest is bounded so it never blows the context.

import type { AgentSessionHooks } from 'mu-coding';
import type { MemoryStore } from './store';

export interface MemoryHookOptions {
  /** Max characters of memory digest injected per turn. */
  maxChars?: number;
  /** Include the standing "save durable facts" nudge. Default true. */
  nudge?: boolean;
}

const NUDGE =
  'Memory: durable facts go to MEMORY.md via `memory_save` (target "memory"); user preferences and profile go with target "user". Edit in place with `memory_replace` / `memory_forget` (match a unique snippet). Check `memory_recall` before asking the user.';

export function createMemoryHook(store: MemoryStore, opts: MemoryHookOptions = {}): AgentSessionHooks {
  const includeNudge = opts.nudge !== false;
  return {
    prepareRequest: ({ system }) => {
      const digest = store.digest(opts.maxChars ?? 1200);
      const parts = [system, includeNudge ? NUDGE : '', digest].filter((s) => s && s.trim());
      return { system: parts.join('\n\n') };
    },
  };
}
