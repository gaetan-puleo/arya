/**
 * arya-commands — owns Arya's slash-command surface.
 *
 * Contributes:
 *  - `/help`  — list available commands, primary agents, and subagents.
 *
 * Primary-agent switching is NOT exposed as `/<agent>` slash commands;
 * the companion's agent indicator + the `set_active_agent` WS message
 * already cover that surface. Subagents are *dispatched* via `@name`
 * tagging (handled upstream in `mu-agents` through `transformUserInput`),
 * not by slash commands.
 *
 * The `/help` output is **rebuilt** on every `manager.onChange` so that
 * hot-reloaded agent definitions are reflected next time the user runs
 * the command.
 *
 * Must activate AFTER `mu-agents` so `ctx.getPlugin('mu-agents')` resolves.
 */

import type { Plugin, SlashCommand } from 'mu-core';

interface MuAgentsHandle extends Plugin {
  manager?: {
    getPrimary(): Array<{ name: string; description?: string }>;
    getSubagents(): Array<{ name: string; description?: string }>;
    onChange(listener: (a: unknown) => void): () => void;
  };
}

/**
 * Build the `/help` output. Lists commands first, then agents grouped
 * by type. The companion renders assistant content as markdown, so
 * bold/list formatting renders nicely.
 */
function formatHelp(
  commands: SlashCommand[],
  primary: Array<{ name: string; description?: string }>,
  subagents: Array<{ name: string; description?: string }>,
): string {
  const lines: string[] = ['**Commands**'];
  for (const c of commands) {
    lines.push(`- \`/${c.name}\` — ${c.description}`);
  }
  if (primary.length > 0) {
    lines.push('', '**Primary agents**');
    for (const a of primary) {
      lines.push(`- \`${a.name}\` — ${a.description ?? ''}`);
    }
  }
  if (subagents.length > 0) {
    lines.push('', '**Subagents (tag with `@name`)**');
    for (const a of subagents) {
      lines.push(`- \`@${a.name}\` — ${a.description ?? ''}`);
    }
  }
  return lines.join('\n');
}

export function createAryaCommandsPlugin(): Plugin {
  // Stable reference — mutated in place on every rebuild so that
  // `registry.getCommands()` returns the current set without us having
  // to re-register the plugin.
  const commands: SlashCommand[] = [];
  let unsubscribe: (() => void) | null = null;

  function rebuild(mu: MuAgentsHandle | undefined): void {
    commands.length = 0;
    const primary = mu?.manager?.getPrimary?.() ?? [];
    const subagents = mu?.manager?.getSubagents?.() ?? [];

    commands.push({
      name: 'help',
      description: 'List available commands and agents',
      async execute() {
        return formatHelp(commands, primary, subagents);
      },
    });
  }

  return {
    name: 'arya-commands',
    version: '0.1.0',
    commands,
    activate(ctx) {
      const mu = ctx.getPlugin?.<MuAgentsHandle>('mu-agents');
      rebuild(mu);
      unsubscribe = mu?.manager?.onChange?.(() => rebuild(mu)) ?? null;
    },
    deactivate() {
      unsubscribe?.();
      unsubscribe = null;
    },
  };
}


