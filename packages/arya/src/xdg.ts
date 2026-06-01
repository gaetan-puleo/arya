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

export interface AryaDirs {
  configDir: string;
  dataDir: string;
  stateDir: string;
  agentsDir: string;
  pluginsDir: string;
  sessionsDir: string;
  catalogFile: string;
  configFile: string;
}

export function aryaDirs(hostName = 'arya'): AryaDirs {
  const xdg = resolveXdg();
  const configDir = join(xdg.configHome, hostName);
  const dataDir = join(xdg.dataHome, hostName);
  const stateDir = join(xdg.stateHome, hostName);
  return {
    configDir,
    dataDir,
    stateDir,
    agentsDir: join(configDir, 'agents'),
    pluginsDir: join(configDir, 'plugins'),
    sessionsDir: join(dataDir, 'sessions'),
    catalogFile: join(dataDir, 'sessions.db'),
    configFile: join(configDir, 'config.json'),
  };
}
