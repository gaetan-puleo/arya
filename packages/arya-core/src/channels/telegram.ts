// Telegram channel adapter — long-polls the Bot API and bridges each chat to a
// persisted arya session (`tg-<chatId>`). No webhook, so it works behind NAT /
// Tailscale with no public endpoint. Incoming text is sent into the session; the
// streamed reply is collected and posted back on turn_end, chunked to Telegram's
// 4096-char limit. Uses the global fetch (Node 18+) — no extra dependency.

import type { ChannelAdapter, ChannelAdapterContext, ChannelAdapterHandle } from './adapter';
import { errMsg } from 'mu-core';

export interface TelegramAdapterOptions {
  botToken: string;
  /** If set, only these chat ids are served; others are ignored. */
  allowedChatIds?: number[];
  /** Bot API base. Default https://api.telegram.org */
  apiBase?: string;
  /** Long-poll timeout seconds. Default 30. */
  pollTimeout?: number;
  log?: (msg: string) => void;
}

const TG_MAX_LEN = 4096;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Split text into <=maxLen chunks, preferring newline boundaries. */
export function chunkText(text: string, maxLen = TG_MAX_LEN): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut <= 0) cut = maxLen;
    chunks.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n/, '');
  }
  if (rest) chunks.push(rest);
  return chunks;
}

export function createTelegramAdapter(opts: TelegramAdapterOptions): ChannelAdapter {
  const api = (opts.apiBase ?? 'https://api.telegram.org').replace(/\/$/, '');
  // A Telegram bot is reachable by anyone who discovers it. Without an explicit
  // allowlist, every chat would drive arya (and could resolve approvals) — so a
  // non-empty allowlist is mandatory. Refuse to construct rather than run open.
  if (!opts.allowedChatIds || opts.allowedChatIds.length === 0) {
    throw new Error(
      'telegram: refusing to start without a non-empty allowedChatIds allowlist (an open bot lets anyone drive the agent). Set telegram.allowedChatIds / TELEGRAM_ALLOWED_CHAT_IDS.',
    );
  }
  const allowed = new Set(opts.allowedChatIds);
  const log = opts.log ?? (() => {});
  let stopped = false;
  let offset = 0;

  async function apiCall(method: string, params: Record<string, unknown>): Promise<any> {
    const res = await fetch(`${api}/bot${opts.botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    return res.json();
  }

  async function sendText(chatId: number, text: string): Promise<void> {
    for (const chunk of chunkText(text)) {
      try {
        await apiCall('sendMessage', { chat_id: chatId, text: chunk, disable_web_page_preview: true });
      } catch (err) {
        log(`telegram sendMessage failed: ${errMsg(err)}`);
      }
    }
  }

  return {
    name: 'telegram',
    async start(_ctx: ChannelAdapterContext): Promise<ChannelAdapterHandle> {
      const { manager } = _ctx;

      const loop = async (): Promise<void> => {
        while (!stopped) {
          let data: any;
          try {
            data = await apiCall('getUpdates', {
              offset,
              timeout: opts.pollTimeout ?? 30,
              allowed_updates: ['message'],
            });
          } catch (err) {
            log(`telegram getUpdates error: ${errMsg(err)}`);
            await sleep(3000);
            continue;
          }
          if (!data?.ok) {
            log(`telegram getUpdates not ok: ${JSON.stringify(data?.description ?? data)}`);
            await sleep(2000);
            continue;
          }
          const updates = data.result ?? [];
          for (const upd of updates) {
            offset = Math.max(offset, upd.update_id + 1);
            const msg = upd.message;
            const chatId: number | undefined = msg?.chat?.id;
            const text: string | undefined = msg?.text;
            if (!chatId || !text) continue;
            if (!allowed.has(chatId)) continue;

            const sessionId = `tg-${chatId}`;
            const channel = manager.get(sessionId) ?? manager.open({ id: sessionId, title: msg.chat.title ?? msg.chat.first_name ?? `Telegram ${chatId}` });

            let reply = '';
            const unsub = channel.subscribe((ev) => {
              if (ev.type === 'text') reply += ev.text;
              else if (ev.type === 'turn_end') {
                unsub();
                const out = reply.trim();
                if (out) void sendText(chatId, out);
              }
            });
            try {
              await channel.send(text);
            } catch (err) {
              unsub();
              log(`telegram channel.send failed: ${errMsg(err)}`);
            }
          }
          // Long-poll normally blocks server-side for `pollTimeout`; when the API
          // returns instantly (empty, or a short timeout in tests) throttle so we
          // never hot-spin against the Bot API.
          if (updates.length === 0) await sleep(50);
        }
      };
      void loop();
      return { stop: async () => { stopped = true; } };
    },
  };
}
