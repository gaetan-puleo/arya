import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Cron } from 'croner';
import { parse } from 'yaml';
import type { SessionManager } from 'mu-core';

export interface ScheduledTask {
  id: string;
  agent: string;
  cron: string;
  channel: string;
  prompt: string;
}

interface SchedulerJobs {
  stop: () => void;
}

/**
 * Scheduler — loads cron/heartbeat tasks from YAML definitions and
 * dispatches them to sessions via Session.submit().
 */
export function createScheduler(
  sessions: SessionManager,
  tasksDir?: string,
): { stop: () => void } {
  const jobs: SchedulerJobs[] = [];

  if (!tasksDir || !existsSync(tasksDir)) {
    console.log('[scheduler] No tasks directory configured');
    return { stop: () => {} };
  }

  // Load tasks from YAML files
  const files = readdirSync(tasksDir).filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'));
  if (files.length === 0) {
    console.log('[scheduler] No task files found in', tasksDir);
    return { stop: () => {} };
  }

  for (const file of files) {
    const filePath = join(tasksDir, file);
    const raw = readFileSync(filePath, 'utf8');
    const parsed = parse(raw);
    const tasks: ScheduledTask[] = Array.isArray(parsed) ? parsed : [parsed as ScheduledTask];

    for (const task of tasks) {
      if (!task.id || !task.cron || !task.prompt) {
        console.warn(`[scheduler] Skipping invalid task in ${file}: missing id/cron/prompt`);
        continue;
      }

      console.log(`[scheduler] Registered task "${task.id}" — cron: ${task.cron}, agent: ${task.agent}`);

      const job = new Cron(task.cron, async () => {
        try {
          const sessionId = `task:${task.id}:${Date.now()}`;
          const session = sessions.getOrCreate(sessionId, {
            systemPrompt: `You are a task agent for arya-agent. Task: ${task.id}`,
          });

          const inbound = {
            kind: 'text' as const,
            channelId: 'scheduler',
            sessionId,
            text: task.prompt,
          };

          await session.submit(inbound, {
            sendText: async (text) => {
              console.log(`[scheduler:${task.id}] ${text.slice(0, 200)}`);
            },
          });
        } catch (err) {
          console.error(`[scheduler:${task.id}] Error:`, err);
        }
      }, {
        timezone: 'UTC',
        catch: false, // Let errors bubble up to the catch above
      });

      jobs.push({ stop: () => job.stop() });
    }
  }

  console.log(`[scheduler] Started ${jobs.length} job(s)`);

  return {
    stop: () => {
      for (const job of jobs) job.stop();
      console.log('[scheduler] Stopped all jobs');
    },
  };
}
