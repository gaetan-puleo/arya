import { type ContentPart, text } from 'mu-core';
import type { Tool } from 'mu-core';
import type { PcController } from './controller';

const asObj = (input: unknown): Record<string, unknown> =>
  (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v) || 0);

/**
 * PC-control tools. These act on the whole desktop and are gated by the caller's
 * permission profile (ask by default). Read-only: pc_window_list, pc_screenshot,
 * pc_env. Mutating: pc_key, pc_type, pc_mouse_move, pc_click, pc_scroll,
 * pc_window_focus, pc_launch.
 */
export const createPcTools = (pc: PcController): Tool[] => [
  {
    name: 'pc_env',
    description: 'Report the detected desktop: display server, input backend, screenshot tool, window manager.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const e = pc.env;
      return [
        text(
          `server=${e.server} input=${e.input} screenshot=${e.screenshot} windows=${e.windows ? 'wmctrl' : 'none'}`,
        ),
      ];
    },
  },
  {
    name: 'pc_key',
    description: 'Press a key or chord (e.g. "ctrl+s", "Return", "alt+Tab").',
    parameters: { type: 'object', properties: { combo: { type: 'string' } }, required: ['combo'] },
    run: async (input) => [text(await pc.key(str(asObj(input).combo)))],
  },
  {
    name: 'pc_type',
    description: 'Type a string of text at the current focus.',
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async (input) => [text(await pc.type(str(asObj(input).text)))],
  },
  {
    name: 'pc_mouse_move',
    description: 'Move the mouse pointer to absolute x,y.',
    parameters: {
      type: 'object',
      properties: { x: { type: 'number' }, y: { type: 'number' } },
      required: ['x', 'y'],
    },
    run: async (input) => {
      const o = asObj(input);
      return [text(await pc.mouseMove(num(o.x), num(o.y)))];
    },
  },
  {
    name: 'pc_click',
    description: 'Click a mouse button (1=left, 2=middle, 3=right) at the current pointer.',
    parameters: { type: 'object', properties: { button: { type: 'number' } } },
    run: async (input) => [text(await pc.click(num(asObj(input).button) || 1))],
  },
  {
    name: 'pc_scroll',
    description: 'Scroll the desktop up or down.',
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
      return [text(await pc.scroll(o.direction === 'up' ? 'up' : 'down', num(o.amount) || 3))];
    },
  },
  {
    name: 'pc_window_list',
    description: 'List open windows (wmctrl -l).',
    parameters: { type: 'object', properties: {} },
    run: async () => [text(await pc.windowList())],
  },
  {
    name: 'pc_window_focus',
    description: 'Focus/raise a window by title.',
    parameters: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] },
    run: async (input) => [text(await pc.windowFocus(str(asObj(input).title)))],
  },
  {
    name: 'pc_launch',
    description: 'Launch an application / shell command detached on the desktop.',
    parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
    run: async (input) => [text(await pc.launch(str(asObj(input).command)))],
  },
  {
    name: 'pc_screenshot',
    description:
      'Capture the whole screen as PNG. Returned as an image part — useful only with a vision model wired; otherwise use pc_window_list / browser_snapshot.',
    parameters: { type: 'object', properties: {} },
    run: async (): Promise<ContentPart[]> => {
      const shot = await pc.screenshot();
      return [{ type: 'image', mime: shot.mime, data: shot.data }];
    },
  },
];
