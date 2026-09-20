import { afterEach, expect, test, vi } from 'vitest';
import { chunkText, createTelegramAdapter } from './telegram';

test('chunkText: short text is one chunk', () => {
  expect(chunkText('hello')).toEqual(['hello']);
});

test('chunkText: splits long text at newline boundaries', () => {
  const text = 'a'.repeat(2000) + '\n' + 'b'.repeat(2000);
  const chunks = chunkText(text, 2500);
  expect(chunks.length).toBe(2);
  expect(chunks[0]).toBe('a'.repeat(2000));
  expect(chunks[1]).toBe('b'.repeat(2000));
});

test('chunkText: hard-splits when no newline fits', () => {
  const text = 'x'.repeat(5000);
  const chunks = chunkText(text, 2000);
  expect(chunks.every((c) => c.length <= 2000)).toBe(true);
  expect(chunks.join('')).toBe(text);
});

const origFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = origFetch; });

test('telegram adapter: bridges an incoming message to a session and posts the reply', async () => {
  const sent: Array<{ chat_id: number; text: string }> = [];
  let updatesCall = 0;

  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.includes('getUpdates')) {
      updatesCall += 1;
      if (updatesCall === 1) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            result: [{ update_id: 10, message: { text: 'bonjour', chat: { id: 42, first_name: 'Gael' } } }],
          }),
        } as unknown as Response;
      }
      return { ok: true, json: async () => ({ ok: true, result: [] }) } as unknown as Response;
    }
    if (u.includes('sendMessage')) {
      sent.push({ chat_id: body.chat_id, text: body.text });
      return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
    }
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  }) as unknown as typeof fetch;

  // Fake channel that streams a reply on send.
  const listeners = new Set<(ev: { type: string; text?: string }) => void>();
  const fakeChannel = {
    id: 'tg-42',
    title: 'Gael',
    started: true,
    messages: [],
    send: async () => {
      for (const l of [...listeners]) l({ type: 'text', text: 'salut ' });
      for (const l of [...listeners]) l({ type: 'text', text: 'toi!' });
      for (const l of [...listeners]) l({ type: 'turn_end' });
    },
    abort: () => {},
    subscribe: (l: (ev: { type: string; text?: string }) => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  const opened: string[] = [];
  const fakeManager = {
    open: (opts?: { id?: string; title?: string }) => {
      opened.push(opts?.id ?? '');
      return fakeChannel as never;
    },
    get: () => undefined,
    list: () => [],
    close: () => {},
    subscribe: () => () => {},
  };
  const ctx = { harness: {}, manager: fakeManager as never, approvals: {} } as never;

  const adapter = createTelegramAdapter({ botToken: 'T', allowedChatIds: [42], pollTimeout: 0 });
  const handle = await adapter.start(ctx);

  // Wait for the poll loop to process the message and post the reply.
  await new Promise((r) => setTimeout(r, 150));
  await handle.stop();

  expect(opened).toContain('tg-42');
  expect(sent.length).toBe(1);
  expect(sent[0].chat_id).toBe(42);
  expect(sent[0].text).toBe('salut toi!');
});

test('telegram adapter: ignores chats outside the allowlist', async () => {
  let updatesCall = 0;
  const sent: number[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (u.includes('getUpdates')) {
      updatesCall += 1;
      if (updatesCall === 1) {
        return { ok: true, json: async () => ({ ok: true, result: [{ update_id: 1, message: { text: 'hi', chat: { id: 99 } } }] }) } as unknown as Response;
      }
      return { ok: true, json: async () => ({ ok: true, result: [] }) } as unknown as Response;
    }
    if (u.includes('sendMessage')) { sent.push(body.chat_id); }
    return { ok: true, json: async () => ({ ok: true }) } as unknown as Response;
  }) as unknown as typeof fetch;

  const fakeChannel = {
    id: 'x', title: 'x', started: true, messages: [],
    send: async () => {}, abort: () => {}, subscribe: () => () => {},
  };
  const fakeManager = {
    open: () => fakeChannel as never, get: () => undefined, list: () => [], close: () => {}, subscribe: () => () => {},
  };
  const adapter = createTelegramAdapter({ botToken: 'T', allowedChatIds: [42], pollTimeout: 0 });
  const handle = await adapter.start({ harness: {}, manager: fakeManager as never, approvals: {} } as never);
  await new Promise((r) => setTimeout(r, 120));
  await handle.stop();
  expect(sent).toEqual([]); // chat 99 not in allowlist
});

test('telegram adapter: refuses to construct without a non-empty allowlist', () => {
  expect(() => createTelegramAdapter({ botToken: 'T' })).toThrow(/allowlist/);
  expect(() => createTelegramAdapter({ botToken: 'T', allowedChatIds: [] })).toThrow(/allowlist/);
});
