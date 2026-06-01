import { expect } from '@std/expect';
import { describe, it } from '@std/testing/bdd';
import { approvalRequestToWire, parseInbound } from './protocol';

describe('parseInbound', () => {
  it('rejects values that are not objects', () => {
    expect(parseInbound(null)).toEqual({ error: 'not an object' });
    expect(parseInbound(42)).toEqual({ error: 'not an object' });
    expect(parseInbound('hi')).toEqual({ error: 'not an object' });
  });

  it('rejects unknown types', () => {
    expect('error' in parseInbound({ type: 'frobnicate' })).toBe(true);
  });

  it('parses a chat with the required text', () => {
    expect(parseInbound({ type: 'chat', text: 'hi', sessionId: 's1' })).toEqual({
      type: 'chat',
      text: 'hi',
      sessionId: 's1',
    });
  });

  it('rejects a chat without text', () => {
    expect('error' in parseInbound({ type: 'chat' })).toBe(true);
  });

  it('normalizes an empty sessionId to undefined for a chat', () => {
    const r = parseInbound({ type: 'chat', text: 'hi', sessionId: '' });
    expect(r).toEqual({ type: 'chat', text: 'hi', sessionId: undefined });
  });

  it('accepts an approval_response with requestId', () => {
    expect(parseInbound({ type: 'approval_response', requestId: 'r1', action: 'approve' })).toEqual({
      type: 'approval_response',
      requestId: 'r1',
      action: 'approve',
    });
  });

  it('accepts an approval_response with the legacy token field', () => {
    expect(parseInbound({ type: 'approval_response', token: 't1', action: 'deny' })).toEqual({
      type: 'approval_response',
      requestId: 't1',
      action: 'deny',
    });
  });

  it('converts an unknown approval action to deny (safe default)', () => {
    expect(parseInbound({ type: 'approval_response', requestId: 'r1', action: 'evil' })).toEqual({
      type: 'approval_response',
      requestId: 'r1',
      action: 'deny',
    });
  });

  it('rejects an approval_response without an identifier', () => {
    expect('error' in parseInbound({ type: 'approval_response', action: 'approve' })).toBe(true);
  });

  it('parses sessions:create with a client-supplied id', () => {
    const r = parseInbound({ type: 'sessions:create', sessionId: 'sess_1', title: 'x' });
    expect(r).toEqual({ type: 'sessions:create', sessionId: 'sess_1', title: 'x' });
  });

  it('accepts each session RPC variant with the required fields', () => {
    expect(parseInbound({ type: 'sessions:list' })).toEqual({ type: 'sessions:list' });
    expect(parseInbound({ type: 'sessions:delete', sessionId: 's' })).toEqual({
      type: 'sessions:delete',
      sessionId: 's',
    });
    expect(parseInbound({ type: 'sessions:rename', sessionId: 's', title: 't' })).toEqual({
      type: 'sessions:rename',
      sessionId: 's',
      title: 't',
    });
    expect(parseInbound({ type: 'sessions:get', sessionId: 's' })).toEqual({ type: 'sessions:get', sessionId: 's' });
  });

  it('rejects session RPCs without a sessionId', () => {
    expect('error' in parseInbound({ type: 'sessions:delete' })).toBe(true);
    expect('error' in parseInbound({ type: 'sessions:rename', title: 't' })).toBe(true);
    expect('error' in parseInbound({ type: 'sessions:get' })).toBe(true);
  });
});

describe('approvalRequestToWire', () => {
  it('builds an approval frame with the pinned sessionId', () => {
    const wire = approvalRequestToWire({ id: 'r1', toolName: 'bash', args: '{"command":"ls"}' }, 's-pinned');
    expect(wire.type).toBe('approval_request');
    expect(wire.requestId).toBe('r1');
    expect(wire.sessionId).toBe('s-pinned');
    expect(wire.toolName).toBe('bash');
    expect(wire.args).toBe('{"command":"ls"}');
    expect(wire.matchedRule).toBeUndefined();
  });

  it('accepts a null pinned sessionId', () => {
    const wire = approvalRequestToWire({ id: 'r1', toolName: 'bash', args: '{}' }, null);
    expect(wire.sessionId).toBeNull();
  });
});
