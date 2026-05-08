/**
 * Shell tool for arya-agent — runs commands via bash in the project cwd.
 */

import { spawn } from 'node:child_process';
import type { PluginTool } from 'mu-core';

export function createShellTool(getCwd: () => string): PluginTool {
  return {
    definition: {
      type: 'function',
      function: {
        name: 'shell.execute',
        description:
          'Execute a shell command via bash in the project working directory. Returns stdout and stderr combined.',
        parameters: {
          type: 'object',
          properties: {
            cmd: { type: 'string', description: 'The shell command to execute.' },
          },
          required: ['cmd'],
          additionalProperties: false,
        },
      },
    },
    display: {
      verb: 'running',
      kind: 'shell',
      fields: { command: 'cmd' },
    },
    permission: {
      matchKey: (args) => (args.cmd as string) ?? undefined,
    },
    execute(args, signal) {
      const command = args.cmd as string;
      const cwd = getCwd();

      return new Promise<{ content: string; error?: boolean }>((resolve) => {
        const proc = spawn('bash', ['-c', command], {
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: true,
          cwd,
        });

        let stdout = '';
        let stderr = '';

        proc.stdout.on('data', (data: Buffer) => {
          try {
            stdout += data.toString('utf-8');
          } catch {
            // skip binary data
          }
        });

        proc.stderr.on('data', (data: Buffer) => {
          try {
            stderr += data.toString('utf-8');
          } catch {
            // skip binary data
          }
        });

        const onAbort = () => {
          const pid = proc.pid;
          if (pid) {
            try {
              process.kill(-pid, 'SIGTERM');
            } catch {
              proc.kill('SIGTERM');
            }
            setTimeout(() => {
              if (!proc.killed) {
                try {
                  process.kill(-pid, 'SIGKILL');
                } catch {
                  proc.kill('SIGKILL');
                }
              }
            }, 500);
          }
        };

        if (signal) {
          if (signal.aborted) {
            onAbort();
            resolve({ content: 'Aborted', error: true });
            return;
          }
          signal.addEventListener('abort', onAbort, { once: true });
        }

        proc.on('close', (code) => {
          signal?.removeEventListener('abort', onAbort);
          const output = [stdout, stderr]
            .map((s) => s.trim())
            .filter(Boolean)
            .join('\n');

          if (signal?.aborted) {
            resolve({ content: 'Aborted', error: true });
            return;
          }

          if (code !== 0 && !output) {
            resolve({ content: `Error: Process exited with code ${code}`, error: true });
            return;
          }

          resolve({ content: output || '(no output)', error: code !== 0 });
        });

        proc.on('error', (err) => {
          signal?.removeEventListener('abort', onAbort);
          resolve({ content: `Error: ${err.message}`, error: true });
        });
      });
    },
  };
}
