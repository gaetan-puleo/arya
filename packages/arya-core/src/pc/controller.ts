import { execFile, spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { detectPcEnvironment, type PcEnvironment } from './detect';

const run = (bin: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> =>
  new Promise((resolve, reject) => {
    execFile(bin, args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`pc: '${bin}' not installed`));
        return;
      }
      resolve({ stdout: Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout ?? ''), stderr: stderr ?? '' });
    });
  });

/**
 * PC control over the desktop: keyboard, mouse, windows, app launch, screenshot.
 * Backend chosen from the detected display server (X11 → xdotool/wmctrl,
 * Wayland → wtype/ydotool/grim). Degrades with a clear message when a binary is
 * missing rather than silently doing nothing.
 */
export class PcController {
  readonly env: PcEnvironment;

  constructor(env?: PcEnvironment) {
    this.env = env ?? detectPcEnvironment();
  }

  private needInput(): 'xdotool' | 'wtype' | 'ydotool' {
    if (this.env.input === 'none') {
      throw new Error('pc: no keyboard/mouse backend (install xdotool for X11, or wtype/ydotool for Wayland)');
    }
    return this.env.input;
  }

  async key(combo: string): Promise<string> {
    const b = this.needInput();
    if (b === 'xdotool') await run('xdotool', ['key', combo]);
    else if (b === 'wtype') await run('wtype', ['-k', combo]);
    else await run('ydotool', ['key', combo]);
    return `pressed ${combo} via ${b}`;
  }

  async type(text: string): Promise<string> {
    const b = this.needInput();
    if (b === 'xdotool') await run('xdotool', ['type', '--delay', '12', text]);
    else if (b === 'wtype') await run('wtype', [text]);
    else await run('ydotool', ['type', '--delay', '12', text]);
    return `typed via ${b}`;
  }

  async mouseMove(x: number, y: number): Promise<string> {
    if (this.env.input === 'xdotool') {
      await run('xdotool', ['mousemove', String(x), String(y)]);
      return `moved to ${x},${y}`;
    }
    if (this.env.input === 'ydotool') {
      await run('ydotool', ['mousemove', '--absolute', String(x), String(y)]);
      return `moved to ${x},${y} (ydotool)`;
    }
    throw new Error('pc: mouse move needs xdotool (X11) or ydotool (Wayland); wtype is keyboard-only');
  }

  async click(button = 1): Promise<string> {
    if (this.env.input === 'xdotool') {
      await run('xdotool', ['click', String(button)]);
      return `clicked button ${button}`;
    }
    if (this.env.input === 'ydotool') {
      await run('ydotool', ['click', String(button)]);
      return `clicked button ${button} (ydotool)`;
    }
    throw new Error('pc: mouse click needs xdotool (X11) or ydotool (Wayland)');
  }

  async scroll(direction: 'up' | 'down', amount = 3): Promise<string> {
    if (this.env.input !== 'xdotool') {
      throw new Error('pc: scroll needs xdotool (X11)');
    }
    const btn = direction === 'up' ? '4' : '5';
    for (let i = 0; i < amount; i++) await run('xdotool', ['click', btn]);
    return `scrolled ${direction}`;
  }

  async windowList(): Promise<string> {
    if (!this.env.windows) throw new Error('pc: window listing needs wmctrl (X11)');
    const { stdout } = await run('wmctrl', ['-l']);
    return stdout.toString('utf8').trim() || 'no windows';
  }

  async windowFocus(title: string): Promise<string> {
    if (!this.env.windows) throw new Error('pc: window focus needs wmctrl (X11)');
    await run('wmctrl', ['-a', title]);
    return `focused window matching "${title}"`;
  }

  async launch(command: string): Promise<string> {
    const child = spawn('sh', ['-c', command], { detached: true, stdio: 'ignore' });
    child.unref();
    return `launched: ${command} (pid ${child.pid})`;
  }

  async screenshot(): Promise<{ mime: string; data: Uint8Array }> {
    const tool = this.env.screenshot;
    if (tool === 'none') throw new Error('pc: no screenshot tool (install grim/scrot/maim/imagemagick)');
    if (tool === 'grim') {
      const { stdout } = await run('grim', ['-']);
      return { mime: 'image/png', data: new Uint8Array(stdout) };
    }
    if (tool === 'maim') {
      const { stdout } = await run('maim', ['-']);
      return { mime: 'image/png', data: new Uint8Array(stdout) };
    }
    if (tool === 'import') {
      const { stdout } = await run('import', ['-window', 'root', 'png:-']);
      return { mime: 'image/png', data: new Uint8Array(stdout) };
    }
    // scrot writes to a file; capture to a temp path then read.
    const file = join(tmpdir(), `arya-shot-${randomBytes(6).toString('hex')}.png`);
    await run('scrot', [file]);
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(file);
    return { mime: 'image/png', data: new Uint8Array(buf) };
  }
}
