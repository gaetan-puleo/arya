import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import type { Message } from 'mu-core';
import { messagesToWire } from './wire';

describe('messagesToWire', () => {
  it('flattens assistant text + tool_call into a single wire row with toolCalls', () => {
    const messages: Message[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'running it' },
          { type: 'tool_call', id: 'c1', name: 'bash', input: { command: 'ls' } },
        ],
      },
    ];
    const wire = messagesToWire(messages);
    expect(wire).toHaveLength(1);
    expect(wire[0].role).toBe('assistant');
    expect(wire[0].content).toBe('running it');
    expect(wire[0].toolCalls).toEqual([{ id: 'c1', function: { name: 'bash', arguments: '{"command":"ls"}' } }]);
  });

  it('maps tool_result messages to tool rows that recover the tool name', () => {
    const messages: Message[] = [
      { role: 'assistant', content: [{ type: 'tool_call', id: 'c1', name: 'bash', input: {} }] },
      { role: 'user', content: [{ type: 'tool_result', id: 'c1', content: [{ type: 'text', text: 'file.txt' }] }] },
    ];
    const wire = messagesToWire(messages);
    const toolRow = wire.find((m) => m.role === 'tool');
    expect(toolRow).toBeDefined();
    expect(toolRow?.toolCallId).toBe('c1');
    expect(toolRow?.toolResult).toEqual({ name: 'bash', content: 'file.txt' });
  });

  it('marks system rows as llm-only and lets user text through', () => {
    const messages: Message[] = [
      { role: 'system', content: [{ type: 'text', text: 'be nice' }] },
      { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    ];
    const wire = messagesToWire(messages);
    expect(wire[0].role).toBe('system');
    expect(wire[0].meta?.visibility).toBe('llm');
    expect(wire[1]).toMatchObject({ role: 'user', content: 'hello' });
  });
});
