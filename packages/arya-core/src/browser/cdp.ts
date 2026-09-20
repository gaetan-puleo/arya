import { WebSocket } from 'ws';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
}

const DEFAULT_SEND_TIMEOUT_MS = 30_000;

/**
 * Minimal Chrome DevTools Protocol client over a single WebSocket. Sends
 * `{id, method, params}` and resolves the matching `{id, result}`. No bundled
 * browser, no dynamic requires — bundles cleanly into a single-file binary.
 *
 * Every `send` is bounded by a timeout, and all in-flight requests are rejected
 * when the socket closes — so a page target that detaches mid-call can never
 * wedge the caller's turn on a promise that will never settle.
 */
export class CdpConnection {
  private ws: WebSocket | undefined;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(private readonly url: string) {}

  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  connect(timeoutMs = 10_000): Promise<void> {
    if (this.open) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(this.url, { maxPayload: 64 * 1024 * 1024 });
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`cdp: connect timeout to ${this.url}`));
      }, timeoutMs);
      ws.on('open', () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve();
      });
      ws.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      ws.on('close', () => {
        this.rejectAll(new Error('cdp: connection closed'));
        if (this.ws === ws) this.ws = undefined;
      });
      ws.on('message', (raw) => {
        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (typeof msg.id === 'number') {
          const p = this.pending.get(msg.id);
          if (p) {
            this.pending.delete(msg.id);
            if (msg.error) p.reject(new Error(msg.error.message ?? 'cdp error'));
            else p.resolve(msg.result);
          }
        }
      });
    });
  }

  async send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeoutMs = DEFAULT_SEND_TIMEOUT_MS,
  ): Promise<T> {
    if (!this.ws || !this.open) await this.connect();
    const id = this.nextId++;
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`cdp: send '${method}' timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v as T);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws!.send(JSON.stringify({ id, method, params }));
    });
  }

  close(): void {
    this.rejectAll(new Error('cdp: connection closed'));
    this.ws?.close();
    this.ws = undefined;
  }
}
