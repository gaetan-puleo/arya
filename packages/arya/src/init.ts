// Stdin-free, LLM-free setup engine for arya's config.json.
//
// `arya serve` uses this to collect provider config when none exists (or a
// mandatory field — baseUrl, model, wsPort — is missing). The questions are NOT
// asked on the terminal: a transport drives the engine (the in-channel setup
// server in setup-server.ts feeds answers over the WebSocket chat stream).
// The engine only asks provider/host/port (→ baseUrl) and model; the transport
// (wsPort/wsHost/authToken) must already exist for a client to connect, so those
// are defaulted in finalizeConfig rather than asked. Existing fields are merged,
// never replaced.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type Config = Record<string, unknown>;

// Default provider port by kind — only used to prefill the prompt.
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

// --- transport-agnostic question/answer state machine ---

export interface SetupQuestion {
  field: 'provider' | 'host' | 'port' | 'model';
  prompt: string;
  default?: string;
}

export interface SetupState {
  config: Config;
  pending: SetupQuestion[];
  draft: { provider?: string; host?: string };
}

export type SetupStep =
  | { kind: 'ask'; question: SetupQuestion }
  | { kind: 'reask'; question: SetupQuestion; error: string }
  | { kind: 'done'; config: Config };

/** Build setup state from a (possibly partial) config — queue only what is missing. */
export function createSetupState(starting: Config): SetupState {
  const config: Config = { ...starting };
  const missing = missingMandatory(config);
  const pending: SetupQuestion[] = [];
  if (missing.includes('baseUrl')) {
    pending.push({
      field: 'provider',
      prompt: 'Which provider? (llama-swap / ollama / openai / other)',
      default: 'llama-swap',
    });
    pending.push({ field: 'host', prompt: 'Provider host or full URL', default: 'localhost' });
    pending.push({ field: 'port', prompt: 'Provider port' });
  }
  if (missing.includes('model')) {
    pending.push({ field: 'model', prompt: 'Model id (as your provider names it)', default: 'qwen2.5-coder:7b' });
  }
  // wsPort/wsHost/authToken are NOT asked in-channel (a client needs them to connect);
  // finalizeConfig fills them.
  return { config, pending, draft: {} };
}

/** The next question to show, with the port default resolved from the chosen provider. */
export function currentQuestion(s: SetupState): SetupQuestion | undefined {
  const q = s.pending[0];
  if (!q) return undefined;
  if (q.field === 'port') return { ...q, default: PROVIDER_PORTS[s.draft.provider ?? ''] ?? '8080' };
  return q;
}

/** Apply one answer and advance. Empty answers fall back to the question default. */
export function applyAnswer(s: SetupState, answerRaw: string): SetupStep {
  const q = currentQuestion(s);
  if (!q) return { kind: 'done', config: finalizeConfig(s) };
  const answer = (answerRaw ?? '').trim() || (q.default ?? '');

  switch (q.field) {
    case 'provider':
      s.draft.provider = answer || 'llama-swap';
      s.pending.shift();
      break;
    case 'host': {
      const host = answer || 'localhost';
      s.pending.shift();
      // A full URL is taken as-is (trailing slashes trimmed); skip the port question.
      if (/^https?:\/\//i.test(host)) {
        s.config.baseUrl = host.replace(/\/+$/, '');
        if (s.pending[0]?.field === 'port') s.pending.shift();
      } else {
        s.draft.host = host;
      }
      break;
    }
    case 'port': {
      const n = Number(answer);
      if (!isValidPort(n)) {
        return { kind: 'reask', question: q, error: 'Port must be an integer in [1, 65535].' };
      }
      s.config.baseUrl = `http://${s.draft.host ?? 'localhost'}:${n}/v1`;
      s.pending.shift();
      break;
    }
    case 'model':
      s.config.model = answer || 'qwen2.5-coder:7b';
      s.pending.shift();
      break;
  }

  const next = currentQuestion(s);
  return next ? { kind: 'ask', question: next } : { kind: 'done', config: finalizeConfig(s) };
}

/** Fill the transport fields not asked in-channel. A non-loopback host needs a
 *  token (validateConfig refuses an empty one), so generate one when absent. */
export function finalizeConfig(s: SetupState): Config {
  const c = s.config;
  if (!isValidPort(c.wsPort)) c.wsPort = 3001;
  if (typeof c.wsHost !== 'string' || !c.wsHost) c.wsHost = '0.0.0.0';
  if (!isLoopbackHost(String(c.wsHost)) && (typeof c.authToken !== 'string' || !c.authToken)) {
    c.authToken = crypto.randomUUID();
  }
  return c;
}

export function writeConfig(path: string, config: Config): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
}
