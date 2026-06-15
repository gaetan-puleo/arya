import type { Agent } from 'mu-harness';

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
    list: 'allow',
    webfetch: 'allow',
    write: 'ask',
    edit: 'ask',
    bash: 'ask',
    subagent: 'allow',
    skill: 'allow',
  },
};

export const BUILTIN_AGENTS: Agent[] = [ARYA_AGENT];
