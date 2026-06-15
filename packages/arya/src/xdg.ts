import { homedir } from 'node:os';
import { join } from 'node:path';
import type { XdgDirs } from 'mu-harness';

const fromEnv = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value && value.trim() ? value : fallback;
};

export function resolveXdg(): XdgDirs {
  const home = homedir();
  return {
    configHome: fromEnv('XDG_CONFIG_HOME', join(home, '.config')),
    dataHome: fromEnv('XDG_DATA_HOME', join(home, '.local', 'share')),
    stateHome: fromEnv('XDG_STATE_HOME', join(home, '.local', 'state')),
  };
}

/** The XDG-derived arya paths consumed OUTSIDE the harness: the plugin install
 *  dir and the config file. Everything else (sessions, catalog, agent dirs, data/
 *  state homes) is owned and computed by the mu harness from `resolveXdg()`. */
export interface AryaDirs {
  pluginsDir: string;
  configFile: string;
}

export function aryaDirs(hostName = 'arya'): AryaDirs {
  const configDir = join(resolveXdg().configHome, hostName);
  return {
    pluginsDir: join(configDir, 'plugins'),
    configFile: join(configDir, 'config.json'),
  };
}
