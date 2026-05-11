/**
 * XDG-aware directory resolvers used at boot.
 *
 * Centralised so the precedence ($XDG_CONFIG_HOME → ~/.config etc.) is
 * applied identically everywhere. No business logic — just path math.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
}

function xdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
}

/** `~/.config/arya/.env` */
export function aryaEnvPath(): string {
  return join(xdgConfigHome(), 'arya', '.env');
}

/** `~/.config/arya/agents` */
export function aryaAgentsDir(): string {
  return join(xdgConfigHome(), 'arya', 'agents');
}

/** `~/.config/arya/plugins` — source dir for user-defined plugin TS files. */
export function aryaPluginsDir(): string {
  return join(xdgConfigHome(), 'arya', 'plugins');
}

/** `~/.local/share/arya/plugins` — install dir for plugin dependencies. */
export function aryaPluginDepsDir(): string {
  return join(xdgDataHome(), 'arya', 'plugins');
}

/** `~/.local/share/arya/sessions` — JSONL-backed session store dir. */
export function aryaSessionsDir(): string {
  return join(xdgDataHome(), 'arya', 'sessions');
}
