import { createRequire } from 'node:module';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// `node:sqlite` is newer than vite 5's builtin list, so load it via createRequire
// to keep both the tsup bundle and the vitest transform happy.
const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');

const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export interface AdminSession {
  userId: number;
  username: string;
}

/**
 * SQLite-backed admin authentication: users (scrypt-hashed passwords) and
 * server-side sessions. Uses the built-in `node:sqlite` so it bundles into the
 * single-file binary with no native build step.
 */
export class AdminAuth {
  private db: import('node:sqlite').DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
    `);
  }

  hasUsers(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
    return row.n > 0;
  }

  /** Create the user if it doesn't exist. Returns true if a new user was created. */
  ensureUser(username: string, password: string): boolean {
    const u = (username ?? '').trim();
    if (!u) throw new Error('auth: username is required');
    if (!password) throw new Error('auth: password is required');
    const existing = this.db.prepare('SELECT id FROM users WHERE username = ?').get(u);
    if (existing) return false;
    this.db
      .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
      .run(u, hashPassword(password), new Date().toISOString());
    return true;
  }

  /**
   * Insert the user, or update its password hash if it already exists and the
   * password differs. Use when the password comes from config and must be
   * authoritative — otherwise a seeded `admin/admin` would survive a later
   * config change forever. Returns 'created' | 'updated' | 'unchanged'.
   */
  upsertUser(username: string, password: string): 'created' | 'updated' | 'unchanged' {
    const u = (username ?? '').trim();
    if (!u) throw new Error('auth: username is required');
    if (!password) throw new Error('auth: password is required');
    const row = this.db
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get(u) as { id: number; password_hash: string } | undefined;
    if (!row) {
      this.db
        .prepare('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)')
        .run(u, hashPassword(password), new Date().toISOString());
      return 'created';
    }
    if (verifyPassword(password, row.password_hash)) return 'unchanged';
    this.db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .run(hashPassword(password), row.id);
    return 'updated';
  }

  /** Validate credentials; on success create and return a session token. */
  login(username: string, password: string): string | null {
    const row = this.db
      .prepare('SELECT id, password_hash FROM users WHERE username = ?')
      .get((username ?? '').trim()) as { id: number; password_hash: string } | undefined;
    if (!row || !verifyPassword(password ?? '', row.password_hash)) return null;
    const token = randomBytes(32).toString('hex');
    const now = Date.now();
    this.db
      .prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(token, row.id, new Date(now).toISOString(), new Date(now + SESSION_TTL_MS).toISOString());
    return token;
  }

  validateSession(token: string | undefined): AdminSession | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        'SELECT s.user_id AS userId, u.username AS username, s.expires_at AS expiresAt ' +
          'FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?',
      )
      .get(token) as { userId: number; username: string; expiresAt: string } | undefined;
    if (!row) return null;
    if (Date.parse(row.expiresAt) < Date.now()) {
      this.logout(token);
      return null;
    }
    return { userId: row.userId, username: row.username };
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      /* already closed */
    }
  }
}
