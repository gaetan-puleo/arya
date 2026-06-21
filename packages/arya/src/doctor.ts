// `arya doctor` — a health check that composes the generic doctor primitives
// from mu-harness (runChecks/formatReport + the ok/warn/fail/info helpers and
// the tcp/command/service probes) with arya-specific knowledge: where the
// config lives, which fields are mandatory, and the reachability of the model
// endpoint and a running `arya serve`. Each check degrades gracefully — a probe
// that cannot run reports info/warn rather than throwing — so the command always
// produces a report and a single exit code.

import { resolve } from 'node:path';
import {
  type Check,
  createServiceController,
  fail,
  formatReport,
  info,
  nodeServiceEnv,
  ok,
  readLingerEnabled,
  runChecks,
  tcpProbe,
  warn,
} from 'mu-harness';

import { aryaServiceDescriptor } from './service';
import { aryaDirs } from './xdg';
import { type Config, firstReadable, isValidPort, missingMandatory, readConfig } from './init';

const str = (value: unknown): string | undefined =>
  (typeof value === 'string' && value ? value : undefined);

export async function runDoctor(cwd: string): Promise<number> {
  // Locate the active config once and share it across the dependent checks.
  const path = firstReadable([aryaDirs('arya').configFile, resolve(cwd, 'config.json')]);
  const cfg: Config | undefined = path ? readConfig(path) : undefined;

  const checks: Check[] = [
    // 1. Config presence.
    () => (path ? info('config', path) : fail('config missing', 'run: arya setup')),

    // 2. Config completeness — only meaningful once a config exists.
    () => {
      if (!cfg) return info('config completeness', 'no config to check');
      const missing = missingMandatory(cfg);
      return missing.length
        ? fail('config incomplete', `missing: ${missing.join(', ')}`)
        : ok('config complete');
    },

    // 3. Model endpoint reachability.
    async () => {
      const baseUrl = str(cfg?.baseUrl);
      if (!baseUrl) return info('model endpoint', 'baseUrl not set');
      let url: URL;
      try {
        url = new URL(baseUrl);
      } catch {
        return fail('baseUrl invalid', baseUrl);
      }
      const port = Number(url.port) || (url.protocol === 'https:' ? 443 : 80);
      const reachable = await tcpProbe(url.hostname, port);
      return reachable
        ? ok('model endpoint reachable', baseUrl)
        : warn('model endpoint unreachable', baseUrl);
    },

    // 4. WS server — informational: `arya serve` may legitimately be stopped.
    async () => {
      if (!isValidPort(cfg?.wsPort)) return info('arya serve', 'wsPort not set');
      const host = str(cfg?.wsHost) ?? '127.0.0.1';
      const port = cfg!.wsPort as number;
      const running = await tcpProbe(host, port);
      return running
        ? info('arya serve running', `${host}:${port}`)
        : info('arya serve not running', 'start: arya serve');
    },

    // 5. systemd linger — Linux only; controls whether the user service keeps
    // running after logout.
    async () => {
      if (process.platform !== 'linux') return info('systemd linger', 'not applicable');
      try {
        const env = nodeServiceEnv();
        const linger = await readLingerEnabled(env.user, env.exec);
        if (linger === true) return ok('systemd linger enabled');
        if (linger === false) {
          return warn('systemd linger disabled', 'service stops at logout — sudo loginctl enable-linger $USER');
        }
        return info('systemd linger', 'unknown');
      } catch {
        return info('systemd linger', 'unknown');
      }
    },

    // 6. Service install state — best effort; not all platforms are supported.
    async () => {
      try {
        const status = await createServiceController(aryaServiceDescriptor(cwd)).status();
        return info('service', `${status.installed ? 'installed' : 'not installed'} (${status.state})`);
      } catch {
        return info('service', 'not supported on this platform');
      }
    },
  ];

  const report = await runChecks(checks);
  console.log(formatReport(report));
  return report.ok ? 0 : 1;
}
