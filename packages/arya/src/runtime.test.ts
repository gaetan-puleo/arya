import { expect } from '@std/expect';
import { afterEach, beforeEach, describe, it } from '@std/testing/bdd';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Message, Provider, StreamEvent } from 'mu-core';
import { type Agent, createHarness, type XdgDirs } from 'mu-harness';
import { createAryaRuntime } from './runtime';
import { observeSubAgent } from './sub-agent-channel';
import type { SubAgentEventWire, WsOutbound } from './protocol';

const textOf = (messages: Message[]): string =>
  messages.flatMap((m) => m.content).map((p) => (p.type === 'text' ? p.text : '')).join(' ');

const provider: Provider = {
  // deno-lint-ignore require-await
  async *stream(req): AsyncIterable<StreamEvent> {
    const system = req.messages.find((m) => m.role === 'system');
    if (system && textOf([system]).includes('HELPER')) {
      yield { type: 'text', text: 'sub answer' };
      return;
    }
    const sawToolResult = req.messages.some((m) => m.content.some((p) => p.type === 'tool_result'));
    if (!sawToolResult) {
      yield {
        type: 'tool_call',
        id: 'tc1',
        name: 'subagent',
        input: { tasks: [{ agent: 'helper', task: 'help me' }] },
      };
      return;
    }
    yield { type: 'text', text: 'final answer' };
  },
};

const agents: Agent[] = [
  { name: 'arya', description: 'primary', prompt: 'PRIMARY' },
  { name: 'helper', description: 'helper', prompt: 'HELPER prompt', tools: [] },
];

describe('runtime sub-agent runs (via createHarness)', () => {
  let dir: string;
  let xdg: XdgDirs;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'arya-rt-'));
    xdg = { configHome: join(dir, 'config'), dataHome: join(dir, 'data'), stateHome: join(dir, 'state') };
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('records, persists and replays a sub-agent run', async () => {
    const harness = await createHarness({
      hostName: 'arya',
      xdg,
      cwd: dir,
      providers: { local: provider },
      model: 'local/m',
      tools: [],
      agents,
      system: 'PRIMARY',
      title: false,
    });
    const runtime = createAryaRuntime({ harness, tools: [], primaryName: 'arya' });

    const live: SubAgentEventWire[] = [];
    runtime.subAgents.subscribe((run) =>
      observeSubAgent(
        run.session,
        { runId: run.runId, agentName: run.agent, parentSessionId: run.parentId ?? '' },
        (f: WsOutbound) => {
          if (f.type === 'sub_agent_event') live.push(f.event);
        },
      )
    );

    const session = await runtime.session('parent1');
    await session.send('delegate');

    const runs = runtime.subAgents.list();
    expect(runs.length).toBe(1);
    expect(runs[0].agent).toBe('helper');
    expect(runs[0].parentId).toBe('parent1');
    const runId = runs[0].runId;

    expect(live.some((e) => e.type === 'started')).toBe(true);
    expect(live.some((e) => e.type === 'completed')).toBe(true);

    const history = await runtime.history(runId);
    expect(history).not.toBeNull();
    expect(history!.messages.some((m) => m.role === 'assistant' && m.content.includes('sub answer'))).toBe(true);

    runtime.close();
  });
});
