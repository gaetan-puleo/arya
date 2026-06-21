// `arya service <action>` — install/manage arya as a user service on the host.
//
// All platform-specific logic (systemd on linux, launchd on darwin) lives in the
// generic service-lifecycle in mu-harness; this module only describes how to
// relaunch arya in `serve` mode and prints `[arya]`-prefixed feedback.

import { basename } from 'node:path';

import { createServiceController, type ServiceDescriptor } from 'mu-harness';

/** Describe the arya `serve` host as an installable user service. */
export function aryaServiceDescriptor(cwd: string): ServiceDescriptor {
  // Standalone pkg binary: process.execPath IS the arya binary. Dev/node: execPath is node, argv[1] is the entry script.
  const standalone = Boolean((process as unknown as { pkg?: unknown }).pkg) || basename(process.execPath).startsWith('arya');
  const exec = standalone
    ? [process.execPath, 'serve']
    : (process.argv[1] ? [process.execPath, process.argv[1], 'serve'] : [process.execPath, 'serve']);

  return {
    name: 'arya',
    description: 'Arya autonomous host',
    launchdLabel: 'ai.arya',
    exec,
    workingDirectory: cwd,
  };
}

/** Run an `arya service` action, returning a process exit code (0 ok, 1 error). */
export async function runServiceCommand(action: string, cwd: string): Promise<number> {
  const descriptor = aryaServiceDescriptor(cwd);

  let controller;
  try {
    controller = createServiceController(descriptor, { linger: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arya] Service management is not supported on this platform: ${msg}`);
    console.error('[arya] Run `arya serve` under your own process supervisor instead.');
    return 1;
  }

  try {
    switch (action) {
      case 'install': {
        await controller.install();
        console.log('[arya] Service installed — arya will start automatically on boot/login.');
        const logsHint = controller.kind === 'launchd'
          ? `check the service log at ${descriptor.stdoutPath ?? '~/Library/Logs (the launchd StandardOutPath)'}`
          : 'view logs with `journalctl --user -u arya -f`';
        console.log(`[arya] To follow logs: ${logsHint}.`);
        return 0;
      }
      case 'start':
        await controller.start();
        console.log('[arya] started');
        return 0;
      case 'stop':
        await controller.stop();
        console.log('[arya] stopped');
        return 0;
      case 'restart':
        await controller.restart();
        console.log('[arya] restarted');
        return 0;
      case 'status': {
        const s = await controller.status();
        console.log(`[arya] service status (${controller.kind}):`);
        console.log(`[arya]   installed: ${s.installed}`);
        console.log(`[arya]   enabled:   ${s.enabled}`);
        console.log(`[arya]   state:     ${s.state}`);
        console.log(`[arya]   path:      ${s.path ?? '(none)'}`);
        return 0;
      }
      case 'uninstall':
        await controller.uninstall();
        console.log('[arya] Service removed.');
        return 0;
      default:
        console.error(`[arya] unknown service action "${action}". Use: install|start|stop|restart|status|uninstall`);
        return 1;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[arya] service ${action} failed: ${msg}`);
    return 1;
  }
}
