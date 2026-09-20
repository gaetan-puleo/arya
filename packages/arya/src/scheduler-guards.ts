// Cron guards — the cheap checks that run BEFORE any agent machinery, so a tick
// that shouldn't wake the model (or pile up on a running task) costs nothing.
// Ported from Hermes' cron gates: overlap, monitor (hash-suppressed change
// detection), wake gate (stdout `{"wakeAgent": false}`), and preflight.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** sha256 of the exact output bytes — no normalization, scripts must emit stable output. */
export function hashOutput(output: string): string {
  return createHash('sha256').update(output, 'utf-8').digest('hex');
}

/** Wake gate: false ONLY when the last non-empty stdout line is JSON
 * `{"wakeAgent": false}` (run stays silent — no agent, no delivery). Any other
 * output (non-JSON, flag absent, or wakeAgent true) wakes normally. */
export function parseWakeGate(output: string): boolean {
  const lines = (output || '').split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return true;
  try {
    const gate = JSON.parse(lines[lines.length - 1]);
    if (gate && typeof gate === 'object' && !Array.isArray(gate)) {
      return (gate as Record<string, unknown>).wakeAgent !== false;
    }
  } catch {
    /* not JSON → wake */
  }
  return true;
}

export interface MonitorState {
  lastOutputHash?: string;
  lastChangedAt?: number;
  lastOutput?: string;
}

export type SchedulerState = Record<string, MonitorState>;

/** Persisted monitor state, one JSON file keyed by task id. Atomic writes;
 * lives outside the watched YAML so it never triggers a definition reload. */
export class MonitorStateStore {
  private state: SchedulerState;

  constructor(private readonly path: string) {
    this.state = this.load();
  }

  private load(): SchedulerState {
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8'));
      return parsed && typeof parsed === 'object' ? (parsed as SchedulerState) : {};
    } catch {
      return {};
    }
  }

  get(id: string): MonitorState {
    return this.state[id] ?? {};
  }

  set(id: string, next: MonitorState): void {
    this.state[id] = next;
    this.persist();
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp.${process.pid}.${Date.now()}`;
    writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf-8');
    renameSync(tmp, this.path);
  }
}
