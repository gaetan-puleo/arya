import type { ServiceDescriptor } from './types';

const LINE_BREAKS = /[\r\n]/;

const assertNoBreaks = (value: string, label: string): void => {
  if (LINE_BREAKS.test(value)) throw new Error(`${label} cannot contain CR or LF.`);
};

const quoteIfNeeded = (s: string): string => {
  if (!/[\s"\\]/.test(s)) return s;
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
};

/** Escape a value for ExecStart/WorkingDirectory. systemd expands `$VAR` in these
 * (shell-like), so a literal `$` must be written `$$`. */
const escapeExecArg = (value: string): string => {
  assertNoBreaks(value, 'systemd unit value');
  return quoteIfNeeded(value.replace(/\$/g, () => '$$'));
};

/** Escape a value for `Environment=KEY=VALUE`. systemd does NOT expand `$` in
 * Environment=, so `$$` would stay literal and corrupt the value — quote only. */
const escapeEnvValue = (value: string): string => {
  assertNoBreaks(value, 'systemd env value');
  return quoteIfNeeded(value);
};

const envLines = (env: ServiceDescriptor['environment']): string[] => {
  if (!env) return [];
  return Object.entries(env)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([k, v]) => {
      assertNoBreaks(k, 'systemd env name');
      return `Environment=${escapeEnvValue(`${k}=${(v as string).trim()}`)}`;
    });
};

/**
 * Render a systemd user unit. Mirrors the hardening from established hosts:
 * `After/Wants=network-online.target` (don't race the network), `Restart=always`
 * with `RestartSec=5`, and optional `KillMode=process` for hosts that spawn
 * container monitors. `WantedBy=default.target` installs it for the user session.
 */
export function buildSystemdUnit(d: ServiceDescriptor): string {
  if (d.exec.length === 0) throw new Error('ServiceDescriptor.exec must not be empty');
  const description = (d.description?.trim() || d.name).replace(/[\r\n]/g, ' ');
  const lines = [
    '[Unit]',
    `Description=${description}`,
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${d.exec.map(escapeExecArg).join(' ')}`,
    'Restart=always',
    'RestartSec=5',
    ...(d.killModeProcess ? ['KillMode=process'] : []),
    ...(d.workingDirectory ? [`WorkingDirectory=${escapeExecArg(d.workingDirectory)}`] : []),
    ...envLines(d.environment),
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ];
  return lines.join('\n');
}
