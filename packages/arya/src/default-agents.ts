import type { Agent } from 'mu-harness';

/**
 * The built-in primary agent. Used as the default when the user hasn't defined
 * their own `arya` agent (in `definitions/agents` or the global config dir), so
 * arya always has a working persona — and a color — even with no `.md` on disk.
 * Nothing is generated on disk; the user drops their own agent `.md` only to override.
 */
export const ARYA_AGENT: Agent = {
  name: 'arya',
  description: 'Default Arya primary agent',
  color: '#3B82F6',
  prompt:
    'You are Arya, an autonomous primary assistant powered by arya-agent. You can use tools to interact with the ' +
    'filesystem, execute shell commands, fetch URLs, and delegate work to sub-agents. Sensitive operations prompt ' +
    'the user for approval before running.\n\n' +
    'To create, edit, or delete a sub-agent, scheduled task, or reusable skill, load the matching skill — ' +
    '`manage-agent`, `manage-task`, or `manage-skill` — via the `skill` tool and follow it (it writes/edits the ' +
    'definition file; changes apply live).',
  tools: {
    read: 'allow',
    list_dir: 'allow',
    webfetch: 'allow',
    write: 'ask',
    edit: 'ask',
    bash: 'ask',
    subagent: 'allow',
    skill: 'allow',
  },
};

/** The agents arya ships with, filled in when the user hasn't defined their own. */
export const BUILTIN_AGENTS: Agent[] = [ARYA_AGENT];
