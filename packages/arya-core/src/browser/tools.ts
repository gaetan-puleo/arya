import { type ContentPart, text } from 'mu-core';
import type { Tool } from 'mu-core';
import type { BrowserController } from './controller';
import { formatSnapshot } from './snapshot';

const asObj = (input: unknown): Record<string, unknown> =>
  (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * Browser-control tools over CDP. Read-only tools (snapshot/tabs/screenshot) are
 * safe; mutating tools (navigate/click/type/press/scroll) are gated by the
 * caller's permission profile.
 */
export const createBrowserTools = (browser: BrowserController): Tool[] => [
  {
    name: 'browser_navigate',
    description: 'Open a URL in the controlled Chrome. Returns the resulting page snapshot.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    run: async (input) => {
      await browser.navigate(str(asObj(input).url));
      const snap = await browser.snapshot();
      return [text(formatSnapshot(snap))];
    },
  },
  {
    name: 'browser_snapshot',
    description:
      'Read the current page as a structured list of interactive elements with refs. Use refs to click/type. No screenshot needed.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const snap = await browser.snapshot();
      return [text(formatSnapshot(snap))];
    },
  },
  {
    name: 'browser_click',
    description: 'Click an element by its ref (from browser_snapshot).',
    parameters: { type: 'object', properties: { ref: { type: 'number' } }, required: ['ref'] },
    run: async (input) => {
      await browser.click(num(asObj(input).ref));
      const snap = await browser.snapshot();
      return [text(`clicked. ${formatSnapshot(snap)}`)];
    },
  },
  {
    name: 'browser_type',
    description: 'Type text into an input/textarea by ref (replaces its content).',
    parameters: {
      type: 'object',
      properties: { ref: { type: 'number' }, text: { type: 'string' } },
      required: ['ref', 'text'],
    },
    run: async (input) => {
      const o = asObj(input);
      await browser.fill(num(o.ref), str(o.text));
      return [text(`typed into ref ${o.ref}.`)];
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key in the page (e.g. Enter, Tab, Escape).',
    parameters: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
    run: async (input) => {
      await browser.press(str(asObj(input).key));
      const snap = await browser.snapshot();
      return [text(`pressed. ${formatSnapshot(snap)}`)];
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page up or down.',
    parameters: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'] },
        amount: { type: 'number' },
      },
      required: ['direction'],
    },
    run: async (input) => {
      const o = asObj(input);
      const dir = o.direction === 'up' ? 'up' : 'down';
      await browser.scroll(dir, num(o.amount) || 600);
      const snap = await browser.snapshot();
      return [text(`scrolled ${dir}. ${formatSnapshot(snap)}`)];
    },
  },
  {
    name: 'browser_screenshot',
    description:
      'Capture the current viewport as a PNG. Returned as an image part — only useful if a vision model is wired; otherwise prefer browser_snapshot.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const png = await browser.screenshot();
      return [{ type: 'image', mime: 'image/png', data: png }];
    },
  },
  {
    name: 'browser_back',
    description: 'Navigate back in history.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      await browser.back();
      const snap = await browser.snapshot();
      return [text(formatSnapshot(snap))];
    },
  },
  {
    name: 'browser_tabs',
    description: 'List open tabs with index, url, title.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const tabs = await browser.tabs();
      return [text(tabs.map((t) => `[${t.index}] ${t.active ? '* ' : '  '}${t.title} — ${t.url}`).join('\n') || 'no tabs')];
    },
  },
  {
    name: 'browser_new_tab',
    description: 'Open a new tab, optionally at a URL.',
    parameters: { type: 'object', properties: { url: { type: 'string' } } },
    run: async (input) => {
      await browser.newTab(str(asObj(input).url) || undefined);
      const snap = await browser.snapshot();
      return [text(formatSnapshot(snap))];
    },
  },
  {
    name: 'browser_select_tab',
    description: 'Switch the active tab by index (from browser_tabs).',
    parameters: { type: 'object', properties: { index: { type: 'number' } }, required: ['index'] },
    run: async (input) => {
      await browser.selectTab(num(asObj(input).index));
      const snap = await browser.snapshot();
      return [text(formatSnapshot(snap))];
    },
  },
];
