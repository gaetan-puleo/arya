import type { Message, Tool } from 'mu-core';
import {
  type Agent,
  type AgentSession,
  allowList,
  createAgentSession,
  type Harness,
  type Plugin,
  runSubAgent,
  type SubAgentRegistry,
  toolNames,
} from 'mu-harness';
import { messagesToWire, type WireMessage } from './wire';

export interface SessionSummaryWire {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface PersistedSessionWire {
  version?: 1;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: WireMessage[];
}

export interface AryaRuntime {
  agents(): Agent[];
  session(id: string): Promise<AgentSession>;
  create(id: string, title?: string): Promise<void>;
  list(): Promise<SessionSummaryWire[]>;
  history(id: string): Promise<PersistedSessionWire | null>;
  delete(id: string): Promise<void>;
  rename(id: string, title: string): void;
  readonly subAgents: SubAgentRegistry;
  runAgentTask(agentName: string, prompt: string): Promise<string>;
  close(): void;
}

export interface AryaRuntimeOptions {
  harness: Harness;
  tools: Tool[];
  plugins?: Plugin[];
  primaryName?: string;
}

export function createAryaRuntime({ harness, tools, plugins, primaryName }: AryaRuntimeOptions): AryaRuntime {
  const { sessions, agents, models } = harness;
  const cache = new Map<string, AgentSession>();
  const newId = () => crypto.randomUUID();

  const liveSession = async (id: string): Promise<AgentSession> => {
    const cached = cache.get(id);
    if (cached) return cached;
    const stored = await sessions.read(id);
    const session = stored ? await sessions.open(id) : sessions.create({ id });
    cache.set(id, session);
    return session;
  };

  const messagesOf = async (id: string): Promise<Message[] | undefined> =>
    cache.get(id) ? [...cache.get(id)!.messages] : (await sessions.read(id))?.messages;

  return {
    agents: () => agents.list(),
    session: liveSession,
    create: async (id, title) => {
      cache.set(id, sessions.create({ id }));
      if (title) sessions.rename(id, title);
    },
    list: async () => {
      const records = await sessions.list();
      const out: SessionSummaryWire[] = [];
      for (const record of records) {
        const messages = (await messagesOf(record.id)) ?? [];
        out.push({
          id: record.id,
          title: record.title ?? '',
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
          messageCount: messages.filter((m) => m.role !== 'system').length,
        });
      }
      return out;
    },
    history: async (id) => {
      const record = await sessions.get(id);
      const messages = await messagesOf(id);
      if (!record && !messages) return null;
      return {
        version: 1,
        id,
        title: record?.title ?? '',
        createdAt: record?.createdAt ?? Date.now(),
        updatedAt: record?.createdAt ?? Date.now(),
        messages: messagesToWire(messages ?? [], record?.createdAt ?? 0),
      };
    },
    delete: async (id) => {
      cache.get(id)?.abort();
      cache.delete(id);
      await sessions.delete(id);
    },
    rename: (id, title) => sessions.rename(id, title),
    subAgents: harness.subAgents,
    runAgentTask: async (agentName, prompt) => {
      const def = agents.get(agentName) ?? (primaryName ? agents.get(primaryName) : agents.list()[0]);
      if (!def) throw new Error(`runAgentTask: unknown agent "${agentName}" and no primary agent`);
      const spawn = (agent: Agent): AgentSession =>
        createAgentSession({
          ...models.resolve(agent.model),
          tools,
          plugins,
          system: agent.prompt,
          hooks: allowList(toolNames(agent)),
          id: newId(),
        });
      const result = await runSubAgent(def, prompt, { spawn });
      return result.text;
    },
    close: () => harness.close(),
  };
}
