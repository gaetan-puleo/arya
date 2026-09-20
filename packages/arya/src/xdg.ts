import { join } from 'node:path';
import { resolveXdg } from 'mu-coding';

// XDG resolution is owned by mu-coding (`resolveXdg`); re-exported here so
// existing arya call sites keep working without a second implementation.
export { resolveXdg };

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
