import { describe, expect, it } from 'bun:test';
import { PluginRegistry } from 'mu-core';
import type { ChatMessage } from 'mu-core';
import { enrichAuthor } from './enrichAuthor.js';

function bareRegistry(): PluginRegistry {
  return new PluginRegistry({ cwd: '/', config: {} });
}

describe('enrichAuthor', () => {
  it('returns the message unchanged when meta.agent is missing', () => {
    const reg = bareRegistry();
    const msg: ChatMessage = { role: 'user', content: 'hi' };
    const enriched = enrichAuthor(msg, reg);
    expect(enriched).toBe(msg); // same reference
    expect('author' in enriched).toBe(false);
  });

  it('stamps a bare-id author when mu-agents is absent', () => {
    const reg = bareRegistry();
    const msg: ChatMessage = {
      role: 'user',
      content: 'hi',
      meta: { agent: 'ghost' },
    };
    const enriched = enrichAuthor(msg, reg);
    expect(enriched.author).toEqual({ id: 'ghost' });
  });

  it('stamps a bare-id author when the agent name is unknown', () => {
    // With an empty registry (no mu-agents plugin) listAgents returns []
    // and the lookup falls back to bare id.
    const reg = bareRegistry();
    const msg: ChatMessage = {
      role: 'assistant',
      content: 'x',
      meta: { agent: 'review' },
    };
    const enriched = enrichAuthor(msg, reg);
    expect(enriched.author).toEqual({ id: 'review' });
  });
});
