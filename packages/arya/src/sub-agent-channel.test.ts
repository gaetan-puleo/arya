import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import type { Message } from 'mu-core';
import type { AgentSession, AgentSessionEvent } from 'mu-harness';
import { observeSubAgent } from './sub-agent-channel';
import type { SubAgentEventWire, WsOutbound } from './protocol';

function scriptedSession(messages: Message[]): { session: AgentSession; emit: (e: AgentSessionEvent) => void } {
  const listeners = new Set<(e: AgentSessionEvent) => void>();
  const session: AgentSession = {
    id: 'sub-1',
    tools: [],
    get messages() {
      return messages;
    },
    send: async () => {},
    abort: () => {},
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { session, emit: (e) => listeners.forEach((l) => l(e)) };
}

describe('observeSubAgent', () => {
  it('translates a full sub-agent run into sub_agent_event frames', () => {
    const messages: Message[] = [];
    const { session, emit } = scriptedSession(messages);
    const frames: SubAgentEventWire[] = [];
    observeSubAgent(session, { runId: 'r1', agentName: 'reviewer', parentSessionId: 'sess_p' }, (f: WsOutbound) => {
      if (f.type === 'sub_agent_event') frames.push(f.event);
    });

    emit({ type: 'turn_start', input: { role: 'user', content: [{ type: 'text', text: 'review this' }] } });
    emit({ type: 'text', text: 'looking' });
    emit({ type: 'tool_call', id: 'c1', name: 'read', input: { path: 'a.ts' } });
    emit({
      type: 'message',
      message: { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'read', input: {} }] },
    });
    emit({
      type: 'message',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', id: 'c1', content: [{ type: 'text', text: 'file body' }] }],
      },
    });
    messages.push({ role: 'assistant', content: [{ type: 'text', text: 'looks good' }] });
    emit({ type: 'turn_end' });

    const types = frames.map((f) => f.type);
    expect(types).toEqual(['started', 'content', 'tool_call', 'tool_result', 'completed']);

    const started = frames[0];
    expect(started.type === 'started' && started.detail?.task).toBe('review this');
    expect(frames.every((f) => f.runId === 'r1' && f.parentSessionId === 'sess_p' && f.agentName === 'reviewer')).toBe(
      true,
    );

    const toolCall = frames[2];
    expect(toolCall.type === 'tool_call' && toolCall.detail?.name).toBe('read');
    expect(toolCall.type === 'tool_call' && toolCall.detail?.arguments).toBe('{"path":"a.ts"}');

    const toolResult = frames[3];
    expect(toolResult.type === 'tool_result' && toolResult.detail?.name).toBe('read');
    expect(toolResult.type === 'tool_result' && toolResult.detail?.content).toBe('file body');
    expect(toolResult.type === 'tool_result' && toolResult.detail?.error).toBe(false);

    const completed = frames[4];
    expect(completed.type === 'completed' && completed.detail?.content).toBe('looks good');
  });

  it('emits an error frame and stops on a session error', () => {
    const { session, emit } = scriptedSession([]);
    const frames: SubAgentEventWire[] = [];
    observeSubAgent(session, { runId: 'r2', agentName: 'x', parentSessionId: 'p' }, (f) => {
      if (f.type === 'sub_agent_event') frames.push(f.event);
    });
    emit({ type: 'turn_start', input: { role: 'user', content: [{ type: 'text', text: 'go' }] } });
    emit({ type: 'error', error: new Error('boom') });
    emit({ type: 'text', text: 'should be ignored after unsubscribe' });

    expect(frames.map((f) => f.type)).toEqual(['started', 'error']);
    const err = frames[1];
    expect(err.type === 'error' && err.detail).toBe('boom');
  });
});
