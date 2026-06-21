// Shared config helpers for arya's config.json.
//
// Used by the entrypoints (index.ts) to locate config and detect a missing
// mandatory field, and by the terminal setup wizard (setup-wizard.ts) to read,
// validate, and write config. No stdin/transport concerns live here.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Config = Record<string, unknown>;

// Default provider port by kind — only used to prefill the wizard's prompt.
export const PROVIDER_PORTS: Record<string, string> = {
  'llama-swap': '8080',
  'ollama': '11434',
  'openai': '8080',
};

export function readConfig(path: string): Config {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? parsed as Config : {};
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    console.error(`[init] could not parse ${path}: ${(e as Error).message} — starting fresh.`);
    return {};
  }
}

export const isValidPort = (v: unknown): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 65535;

export function missingMandatory(c: Config): string[] {
  const missing: string[] = [];
  if (typeof c.baseUrl !== 'string' || !c.baseUrl) missing.push('baseUrl');
  if (typeof c.model !== 'string' || !c.model) missing.push('model');
  if (!isValidPort(c.wsPort)) missing.push('wsPort');
  return missing;
}

/** First path that exists and is readable, else undefined. */
export function firstReadable(paths: string[]): string | undefined {
  for (const p of paths) {
    try {
      readFileSync(p, 'utf-8');
      return p;
    } catch {
      // keep looking
    }
  }
  return undefined;
}

export const isLoopbackHost = (h: string): boolean => h === '127.0.0.1' || h === 'localhost' || h === '::1';

export function writeConfig(path: string, config: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
