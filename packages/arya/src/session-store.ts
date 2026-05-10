import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Persistent session store for arya.
 *
 * - One JSON file per session under `$XDG_DATA_HOME/arya/sessions`
 *   (defaults to `~/.local/share/arya/sessions`).
 * - File schema is the {@link PersistedSession} shape; bump `version` if
 *   it ever changes incompatibly so we can migrate.
 *
 * NOTE: This store persists the *companion-visible* transcript
 * (user/assistant turns and resolved tool invocations rendered in the
 * chat). Sub-agent traces remain activity events and are not stored
 * here.
 */

export interface PersistedMessage {
  /** Stable id for this message — Date.now().toString() is fine. */
  id: string;
  role: 'user' | 'assistant' | 'tool';
  text: string;
  /** Epoch ms. */
  ts: number;
  /** Agent that produced an assistant message (for color/labels). */
  agentId?: string;
  /** Tool invocation name (only when role === 'tool'). */
  toolName?: string;
  /** Pretty-printed JSON (or raw string) of the tool call arguments. */
  toolArgs?: string;
  /** Tool execution result text. */
  toolResult?: string;
  /** True when the tool returned an error. */
  toolError?: boolean;
}

export interface PersistedSession {
  version: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: PersistedMessage[];
}

export interface SessionSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Resolve the XDG data home directory for arya's sessions. */
function xdgArySessionsDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(base, 'arya', 'sessions');
}

function nowMs(): number {
  return Date.now();
}

/**
 * Sessions are identified by an opaque user-provided id. We sanitize for
 * filesystem safety so callers can pass things like `task:foo:123`.
 */
function fileSafeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export interface SessionStore {
  list(): SessionSummary[];
  get(id: string): PersistedSession | null;
  create(opts?: { id?: string; title?: string }): PersistedSession;
  delete(id: string): boolean;
  rename(id: string, title: string): PersistedSession | null;
  appendMessage(id: string, msg: PersistedMessage): PersistedSession;
  /** Subscribe to mutations; called with the sessionId that changed. */
  subscribe(listener: (id: string, kind: SessionChangeKind) => void): () => void;
}

export type SessionChangeKind = 'created' | 'updated' | 'deleted' | 'renamed';

export interface CreateSessionStoreOptions {
  /** Override the default storage dir (mostly for tests). */
  dir?: string;
}

const TITLE_MAX_CHARS = 60;

/** Derive a session title from its first user message. */
export function deriveTitleFromText(text: string): string {
  const trimmed = text.trim().replace(/\s+/g, ' ');
  if (!trimmed) return 'Untitled session';
  return trimmed.length > TITLE_MAX_CHARS
    ? `${trimmed.slice(0, TITLE_MAX_CHARS - 1)}…`
    : trimmed;
}

export function createSessionStore(opts: CreateSessionStoreOptions = {}): SessionStore {
  const dir = opts.dir ?? xdgArySessionsDir();
  mkdirSync(dir, { recursive: true });

  const listeners = new Set<(id: string, kind: SessionChangeKind) => void>();
  function emit(id: string, kind: SessionChangeKind) {
    for (const l of listeners) {
      try {
        l(id, kind);
      } catch (err) {
        console.error('[session-store] listener threw:', err);
      }
    }
  }

  function pathFor(id: string): string {
    return join(dir, `${fileSafeId(id)}.json`);
  }

  function readFile(id: string): PersistedSession | null {
    const p = pathFor(id);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, 'utf8')) as PersistedSession;
      // Defensive: ignore files that don't match v1 — they'll be skipped
      // from list() and treated as missing on get().
      if (!raw || raw.version !== 1) return null;
      return raw;
    } catch (err) {
      console.warn(`[session-store] failed to read ${p}:`, err);
      return null;
    }
  }

  function writeFile(session: PersistedSession): void {
    const p = pathFor(session.id);
    const tmp = `${p}.tmp`;
    // Write to tmp + rename for atomicity; avoids half-written files on
    // crash or concurrent writes (rare here, but cheap insurance).
    writeFileSync(tmp, JSON.stringify(session, null, 2), 'utf8');
    // Bun/node both support fs.renameSync; using writeFile + unlink is
    // simpler and works cross-platform without needing a separate import.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { renameSync } = require('node:fs');
      renameSync(tmp, p);
    } catch {
      // Fallback: copy contents over (still better than nothing).
      writeFileSync(p, JSON.stringify(session, null, 2), 'utf8');
      try {
        unlinkSync(tmp);
      } catch {
        // ignore
      }
    }
  }

  function summary(s: PersistedSession): SessionSummary {
    return {
      id: s.id,
      title: s.title,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messageCount: s.messages.length,
    };
  }

  return {
    list(): SessionSummary[] {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return [];
      }
      const out: SessionSummary[] = [];
      for (const name of entries) {
        if (!name.endsWith('.json')) continue;
        const id = name.slice(0, -'.json'.length);
        // We don't know the original (unsanitized) id from the filename
        // alone — rely on the `id` field stored inside the file.
        const s = readFile(id);
        if (s) out.push(summary(s));
      }
      // Most-recent first; nice default for the drawer list.
      out.sort((a, b) => b.updatedAt - a.updatedAt);
      return out;
    },

    get(id: string): PersistedSession | null {
      return readFile(id);
    },

    create(o = {}): PersistedSession {
      const id = o.id ?? `sess_${nowMs()}_${Math.random().toString(36).slice(2, 8)}`;
      // If the caller passes an id that already exists, return the
      // existing one rather than clobbering it. The companion treats
      // create as idempotent (e.g. server restart with persisted id).
      const existing = readFile(id);
      if (existing) return existing;

      const ts = nowMs();
      const session: PersistedSession = {
        version: 1,
        id,
        title: o.title ?? 'New session',
        createdAt: ts,
        updatedAt: ts,
        messages: [],
      };
      writeFile(session);
      emit(id, 'created');
      return session;
    },

    delete(id: string): boolean {
      const p = pathFor(id);
      if (!existsSync(p)) return false;
      try {
        unlinkSync(p);
        emit(id, 'deleted');
        return true;
      } catch (err) {
        console.warn(`[session-store] failed to delete ${p}:`, err);
        return false;
      }
    },

    rename(id: string, title: string): PersistedSession | null {
      const s = readFile(id);
      if (!s) return null;
      const next: PersistedSession = {
        ...s,
        title: title.trim() || s.title,
        updatedAt: nowMs(),
      };
      writeFile(next);
      emit(id, 'renamed');
      return next;
    },

    appendMessage(id: string, msg: PersistedMessage): PersistedSession {
      // Auto-create on first message to avoid a separate explicit-create
      // round-trip from the companion when a brand-new session starts.
      let s = readFile(id);
      if (!s) {
        const ts = nowMs();
        s = {
          version: 1,
          id,
          title: 'New session',
          createdAt: ts,
          updatedAt: ts,
          messages: [],
        };
      }
      // Auto-title from the first user message; only updates the default
      // 'New session' label so manual renames are preserved.
      const isFirstUserMsg =
        msg.role === 'user' && s.messages.every((m) => m.role !== 'user');
      const title =
        isFirstUserMsg && (s.title === 'New session' || !s.title)
          ? deriveTitleFromText(msg.text)
          : s.title;

      const next: PersistedSession = {
        ...s,
        title,
        updatedAt: nowMs(),
        messages: [...s.messages, msg],
      };
      writeFile(next);
      emit(id, s.messages.length === 0 ? 'created' : 'updated');
      return next;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
