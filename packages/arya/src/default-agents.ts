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
    'When a reusable persona would help, author one with `create_agent`; capture a reusable workflow with ' +
    '`create_skill`; to run work on a schedule, persist it with `create_task`.',
  tools: {
    read: 'allow',
    list_dir: 'allow',
    webfetch: 'allow',
    write: 'ask',
    edit: 'ask',
    bash: 'ask',
    subagent: 'allow',
    create_agent: 'ask',
    create_task: 'allow',
    create_skill: 'allow',
  },
};

/** The agents arya ships with, filled in when the user hasn't defined their own. */
export const BUILTIN_AGENTS: Agent[] = [ARYA_AGENT];
