import { describe, expect, it } from 'vitest';
import { detectPcEnvironment } from './detect';

describe('detectPcEnvironment', () => {
  it('reports wayland when WAYLAND_DISPLAY is set', () => {
    const env = detectPcEnvironment({ WAYLAND_DISPLAY: 'wayland-0' });
    expect(env.server).toBe('wayland');
  });

  it('reports x11 when only DISPLAY is set', () => {
    const env = detectPcEnvironment({ DISPLAY: ':0' });
    expect(env.server).toBe('x11');
  });

  it('reports none when no display vars are set', () => {
    const env = detectPcEnvironment({});
    expect(env.server).toBe('none');
  });

  it('returns valid backend enums', () => {
    const env = detectPcEnvironment({ DISPLAY: ':0' });
    expect(['xdotool', 'wtype', 'ydotool', 'none']).toContain(env.input);
    expect(['grim', 'scrot', 'maim', 'import', 'none']).toContain(env.screenshot);
    expect(typeof env.windows).toBe('boolean');
  });
});
