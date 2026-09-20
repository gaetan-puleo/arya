import { CdpConnection } from './cdp';
import { SNAPSHOT_SCRIPT, type PageSnapshot } from './snapshot';

export interface BrowserControllerOptions {
  /** CDP HTTP endpoint of a Chrome launched with --remote-debugging-port. e.g. http://127.0.0.1:9222 */
  cdpUrl: string;
  timeout?: number;
}

interface Target {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

const KEY_MAP: Record<string, { key: string; code: string; vk: number }> = {
  Enter: { key: 'Enter', code: 'Enter', vk: 13 },
  Tab: { key: 'Tab', code: 'Tab', vk: 9 },
  Escape: { key: 'Escape', code: 'Escape', vk: 27 },
  Backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  Space: { key: ' ', code: 'Space', vk: 32 },
  ArrowUp: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  ArrowDown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  ArrowLeft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
};

/**
 * Drives an existing Chrome over the raw DevTools Protocol (HTTP + WebSocket).
 * The user launches Chrome with `--remote-debugging-port=9222`; this attaches to
 * the user's real, logged-in browser. No bundled browser, no heavy deps.
 */
export class BrowserController {
  private page: CdpConnection | undefined;
  private browser: CdpConnection | undefined;
  private currentTargetId: string | undefined;
  private readonly base: string;

  constructor(private readonly opts: BrowserControllerOptions) {
    this.base = opts.cdpUrl.replace(/\/$/, '');
  }

  get connected(): boolean {
    return this.page?.open ?? false;
  }

  private async listTargets(): Promise<Target[]> {
    const res = await fetch(`${this.base}/json/list`);
    if (!res.ok) throw new Error(`browser: /json/list ${res.status} (is Chrome running with --remote-debugging-port?)`);
    return (await res.json()) as Target[];
  }

  private async browserConn(): Promise<CdpConnection> {
    if (this.browser?.open) return this.browser;
    const res = await fetch(`${this.base}/json/version`);
    if (!res.ok) throw new Error(`browser: /json/version ${res.status}`);
    const info = (await res.json()) as { webSocketDebuggerUrl: string };
    this.browser = new CdpConnection(info.webSocketDebuggerUrl);
    await this.browser.connect();
    return this.browser;
  }

  private async attach(target: Target): Promise<void> {
    if (!target.webSocketDebuggerUrl) throw new Error('browser: target has no webSocketDebuggerUrl');
    this.page?.close();
    this.page = new CdpConnection(target.webSocketDebuggerUrl);
    await this.page.connect();
    this.currentTargetId = target.id;
    await this.page.send('Page.enable').catch(() => {});
    await this.page.send('Runtime.enable').catch(() => {});
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const targets = (await this.listTargets()).filter((t) => t.type === 'page');
    if (targets.length === 0) throw new Error('browser: no page target open in Chrome');
    await this.attach(targets[0]);
  }

  private async requirePage(): Promise<CdpConnection> {
    await this.connect();
    if (!this.page) throw new Error('browser: no active page');
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    const p = await this.requirePage();
    await p.send('Page.navigate', { url });
    await this.waitForReady();
  }

  private async waitForReady(timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const r = (await (await this.requirePage()).send('Runtime.evaluate', {
          expression: 'document.readyState',
          returnByValue: true,
        })) as { result?: { value?: string } };
        if (r.result?.value === 'complete' || r.result?.value === 'interactive') return;
      } catch {
        /* page may be navigating */
      }
      await new Promise((r) => setTimeout(r, 150));
    }
  }

  async evaluate<T = unknown>(expression: string): Promise<T> {
    const p = await this.requirePage();
    const r = (await p.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as { result?: { value?: T } };
    return r.result?.value as T;
  }

  async snapshot(): Promise<PageSnapshot> {
    const p = await this.requirePage();
    const r = (await p.send('Runtime.evaluate', {
      expression: `(${SNAPSHOT_SCRIPT})()`,
      returnByValue: true,
    })) as { result?: { value?: PageSnapshot } };
    if (!r.result?.value) throw new Error('browser: snapshot returned no value');
    return r.result.value;
  }

  private async elementCenter(ref: number): Promise<{ x: number; y: number }> {
    const p = await this.requirePage();
    const expr = `(() => { const el = document.querySelector('[data-arya-ref="${ref}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`;
    const r = (await p.send('Runtime.evaluate', { expression: expr, returnByValue: true })) as {
      result?: { value?: { x: number; y: number } | null };
    };
    if (!r.result?.value) throw new Error(`browser: element ref ${ref} not found (re-snapshot?)`);
    return r.result.value;
  }

  async click(ref: number): Promise<void> {
    const p = await this.requirePage();
    const { x, y } = await this.elementCenter(ref);
    await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await this.waitForReady(4000);
  }

  async fill(ref: number, value: string): Promise<void> {
    const p = await this.requirePage();
    const focus = `(() => { const el = document.querySelector('[data-arya-ref="${ref}"]'); if (!el) return false; el.focus(); if ('value' in el) el.value = ''; return true; })()`;
    const r = (await p.send('Runtime.evaluate', { expression: focus, returnByValue: true })) as {
      result?: { value?: boolean };
    };
    if (!r.result?.value) throw new Error(`browser: input ref ${ref} not found`);
    await p.send('Input.insertText', { text: value });
  }

  async press(key: string): Promise<void> {
    const p = await this.requirePage();
    const m = KEY_MAP[key];
    if (m) {
      await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk });
      await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: m.key, code: m.code, windowsVirtualKeyCode: m.vk });
    } else {
      await p.send('Input.insertText', { text: key });
    }
  }

  async scroll(direction: 'up' | 'down', amount: number): Promise<void> {
    const p = await this.requirePage();
    const deltaY = direction === 'down' ? amount : -amount;
    await p.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 100, y: 100, deltaX: 0, deltaY });
  }

  async screenshot(): Promise<Uint8Array> {
    const p = await this.requirePage();
    const r = (await p.send('Page.captureScreenshot', { format: 'png' })) as { data?: string };
    if (!r.data) throw new Error('browser: screenshot returned no data');
    return new Uint8Array(Buffer.from(r.data, 'base64'));
  }

  async back(): Promise<void> {
    const p = await this.requirePage();
    await p.send('Runtime.evaluate', { expression: 'history.back()' });
    await this.waitForReady(4000);
  }

  async tabs(): Promise<{ index: number; url: string; title: string; active: boolean }[]> {
    const targets = (await this.listTargets()).filter((t) => t.type === 'page');
    return targets.map((t, i) => ({
      index: i,
      url: t.url,
      title: t.title,
      active: t.id === this.currentTargetId,
    }));
  }

  async newTab(url?: string): Promise<void> {
    const b = await this.browserConn();
    const r = (await b.send('Target.createTarget', { url: url ?? 'about:blank' })) as { targetId?: string };
    if (!r.targetId) throw new Error('browser: could not create tab');
    const targets = await this.listTargets();
    const t = targets.find((x) => x.id === r.targetId);
    if (t) await this.attach(t);
    await this.waitForReady();
  }

  async selectTab(index: number): Promise<void> {
    const targets = (await this.listTargets()).filter((t) => t.type === 'page');
    if (!targets[index]) throw new Error(`browser: no tab at index ${index}`);
    await this.attach(targets[index]);
  }

  async close(): Promise<void> {
    this.page?.close();
    this.browser?.close();
    this.page = undefined;
    this.browser = undefined;
    this.currentTargetId = undefined;
  }
}
