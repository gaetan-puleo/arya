/**
 * Scoped logger for arya.
 *
 * Replaces ad-hoc `console.log('[scope] …')` calls scattered across the
 * codebase with a single primitive that:
 *
 *   - prefixes each line with `[scope]` (and `[scope:sub]` for children),
 *   - filters by `ARYA_LOG_LEVEL` (debug | info | warn | error),
 *   - keeps the same plain-text stdout/stderr shape so existing log
 *     consumers (`bun run dev`, CI grepping, etc.) keep working.
 *
 * Intentionally minimal — no structured JSON, no transports, no async.
 * If we ever need that, swap the implementation behind this interface
 * without touching call sites.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  /** Derive a logger with an extended scope: `[scope:sub]`. */
  child(subScope: string): Logger;
}

/** Read the configured minimum level from env. Defaults to `info`. */
function envLevel(): LogLevel {
  const raw = process.env.ARYA_LOG_LEVEL?.toLowerCase();
  if (raw === 'debug' || raw === 'info' || raw === 'warn' || raw === 'error') {
    return raw;
  }
  return 'info';
}

const minLevel = envLevel();
const minRank = LEVELS[minLevel];

function emit(level: LogLevel, scope: string, args: unknown[]): void {
  if (LEVELS[level] < minRank) return;
  const prefix = `[${scope}]`;
  // `console.error` for warn+error so they land on stderr; everything
  // else on stdout. Matches what most operators expect when piping.
  const sink = level === 'warn' || level === 'error' ? console.error : console.log;
  sink(prefix, ...args);
}

export function createLogger(scope: string): Logger {
  return {
    debug: (...args) => emit('debug', scope, args),
    info: (...args) => emit('info', scope, args),
    warn: (...args) => emit('warn', scope, args),
    error: (...args) => emit('error', scope, args),
    child: (subScope) => createLogger(`${scope}:${subScope}`),
  };
}
