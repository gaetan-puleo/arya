import { spawnSync } from 'node:child_process';

export type DisplayServer = 'x11' | 'wayland' | 'none';

export interface PcEnvironment {
  server: DisplayServer;
  /** Which input backend is available for keyboard/mouse. */
  input: 'xdotool' | 'wtype' | 'ydotool' | 'none';
  /** Which screenshot tool is available. */
  screenshot: 'grim' | 'scrot' | 'maim' | 'import' | 'none';
  /** Whether window management (wmctrl) is available. */
  windows: boolean;
  has: (bin: string) => boolean;
}

const which = (bin: string): boolean => {
  const r = spawnSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' });
  return r.status === 0;
};

/**
 * Detect the desktop environment: display server + which control binaries exist.
 * The agent uses this to pick the right backend and to report clearly what is
 * missing rather than failing opaquely.
 */
export const detectPcEnvironment = (env: NodeJS.ProcessEnv = process.env): PcEnvironment => {
  const wayland = !!env.WAYLAND_DISPLAY;
  const x11 = !!env.DISPLAY;
  const server: DisplayServer = wayland ? 'wayland' : x11 ? 'x11' : 'none';

  let input: PcEnvironment['input'] = 'none';
  if (which('xdotool')) input = 'xdotool';
  else if (which('wtype')) input = 'wtype';
  else if (which('ydotool')) input = 'ydotool';

  let screenshot: PcEnvironment['screenshot'] = 'none';
  for (const b of ['grim', 'scrot', 'maim', 'import'] as const) {
    if (which(b)) {
      screenshot = b;
      break;
    }
  }

  return {
    server,
    input,
    screenshot,
    windows: which('wmctrl'),
    has: which,
  };
};
