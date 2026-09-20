import { expect, test } from 'vitest';
import { analyzeTurn, recordToolCall, SkillLearningMonitor, type TurnTrace } from './learning';

const trace = (): TurnTrace => ({ toolCalls: [], skillsUsed: [], filesWritten: [] });

test('analyzeTurn: complex task with no skill → capture suggestion', () => {
  const t = trace();
  for (let i = 0; i < 4; i++) recordToolCall(t, 'bash', { command: 'x' });
  const s = analyzeTurn(t);
  expect(s?.kind).toBe('capture');
  expect(s && 'steps' in s && s.steps).toBe(4);
});

test('analyzeTurn: below threshold → no suggestion', () => {
  const t = trace();
  recordToolCall(t, 'bash', { command: 'ls' });
  recordToolCall(t, 'read', { path: 'a.ts' });
  expect(analyzeTurn(t)).toBeNull();
});

test('analyzeTurn: skill already created this turn → no capture', () => {
  const t = trace();
  for (let i = 0; i < 5; i++) recordToolCall(t, 'bash', { command: 'x' });
  recordToolCall(t, 'write', { path: 'skills/my-flow/SKILL.md' });
  expect(analyzeTurn(t)).toBeNull();
});

test('analyzeTurn: skill used + many steps → improve suggestion', () => {
  const t = trace();
  recordToolCall(t, 'skill', { name: 'release-notes' });
  for (let i = 0; i < 5; i++) recordToolCall(t, 'bash', { command: 'x' });
  const s = analyzeTurn(t);
  expect(s?.kind).toBe('improve');
  expect(s && 'skill' in s && s.skill).toBe('release-notes');
});

test('recordToolCall: extracts skill name and written paths', () => {
  const t = trace();
  recordToolCall(t, 'skill', { name: 'foo' });
  recordToolCall(t, 'edit', { path: 'skills/foo/SKILL.md' });
  recordToolCall(t, 'write', { path: 'src/index.ts' });
  expect(t.skillsUsed).toEqual(['foo']);
  expect(t.filesWritten).toEqual(['skills/foo/SKILL.md', 'src/index.ts']);
});

test('SkillLearningMonitor: fires on turn_end, resets on turn_start', () => {
  const fired: string[] = [];
  const m = new SkillLearningMonitor((s) => fired.push(s.kind));
  m.observe({ type: 'turn_start', input: {} });
  m.observe({ type: 'tool_call', name: 'bash', input: { command: 'a' } });
  m.observe({ type: 'tool_call', name: 'bash', input: { command: 'b' } });
  expect(fired.length).toBe(0); // not yet
  m.observe({ type: 'turn_end' });
  expect(fired.length).toBe(0); // only 2 steps, below threshold
  m.observe({ type: 'turn_start', input: {} });
  for (let i = 0; i < 4; i++) m.observe({ type: 'tool_call', name: 'bash', input: { command: 'x' } });
  m.observe({ type: 'turn_end' });
  expect(fired).toEqual(['capture']);
});

test('SkillLearningMonitor: counts tool calls from assistant message events (non-streaming provider)', () => {
  const fired: string[] = [];
  const m = new SkillLearningMonitor((s) => fired.push(s.kind));
  m.observe({ type: 'turn_start', input: {} });
  m.observe({
    type: 'message',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_call', id: 'a', name: 'bash', input: { command: 'ls' } },
        { type: 'tool_call', id: 'b', name: 'read', input: { path: 'x' } },
        { type: 'tool_call', id: 'c', name: 'list', input: {} },
        { type: 'tool_call', id: 'd', name: 'bash', input: { command: 'pwd' } },
      ],
    },
  });
  m.observe({ type: 'turn_end' });
  expect(fired).toEqual(['capture']);
});

test('SkillLearningMonitor: dedups a tool call seen as both stream event and message', () => {
  const fired: Array<{ kind: string; steps: number }> = [];
  const m = new SkillLearningMonitor((s) => fired.push({ kind: s.kind, steps: s.steps }));
  m.observe({ type: 'turn_start', input: {} });
  // Same call arrives as a bare event AND in the final message.
  m.observe({ type: 'tool_call', id: 'a', name: 'bash', input: { command: 'ls' } });
  m.observe({ type: 'tool_call', id: 'b', name: 'read', input: { path: 'x' } });
  m.observe({
    type: 'message',
    message: {
      role: 'assistant',
      content: [
        { type: 'tool_call', id: 'a', name: 'bash', input: { command: 'ls' } },
        { type: 'tool_call', id: 'b', name: 'read', input: { path: 'x' } },
        { type: 'tool_call', id: 'c', name: 'list', input: {} },
        { type: 'tool_call', id: 'd', name: 'bash', input: { command: 'pwd' } },
      ],
    },
  });
  m.observe({ type: 'turn_end' });
  // 4 unique calls (a,b deduped), not 6.
  expect(fired.length).toBe(1);
  expect(fired[0].steps).toBe(4);
});

test('analyzeTurn: custom threshold respected', () => {
  const t = trace();
  recordToolCall(t, 'bash', { command: 'a' });
  recordToolCall(t, 'bash', { command: 'b' });
  expect(analyzeTurn(t, { complexThreshold: 2 })?.kind).toBe('capture');
  expect(analyzeTurn(t, { complexThreshold: 5 })).toBeNull();
});
