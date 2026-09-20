// Autonomous skills — turn-level detection that surfaces skill capture/improve
// suggestions so the agent (or a human) can persist a reusable procedure.
//
// The detection is pure and side-effect-free: feed it a turn trace, get a
// suggestion. The monitor turns a live AgentSessionEvent stream into a trace and
// fires a callback on turn_end. Wiring decides what to do with the suggestion
// (emit on the wire, show in the dashboard, or nudge the agent) — the module
// never writes files or triggers turns itself.

export interface TurnTrace {
  toolCalls: { name: string; input: unknown }[];
  skillsUsed: string[];
  filesWritten: string[];
}

export type SkillSuggestion =
  | { kind: 'capture'; reason: string; steps: number }
  | { kind: 'improve'; skill: string; reason: string; steps: number };

export interface AnalyzeOptions {
  /** Tool-call count at which a turn is considered a reusable multi-step task. */
  complexThreshold?: number;
}

const SKILL_FILE_RE = /(^|\/)skills\/[^/]+\/SKILL\.md$/;

const emptyTrace = (): TurnTrace => ({ toolCalls: [], skillsUsed: [], filesWritten: [] });

/** Extract the skill name / written path from a tool_call input, defensively. */
function strField(input: unknown, key: string): string | undefined {
  if (input && typeof input === 'object' && key in input) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return undefined;
}

/** Record one tool_call into a trace. */
export function recordToolCall(trace: TurnTrace, name: string, input: unknown): void {
  trace.toolCalls.push({ name, input });
  if (name === 'skill') {
    const skill = strField(input, 'name');
    if (skill) trace.skillsUsed.push(skill);
  }
  if (name === 'write' || name === 'edit') {
    const path = strField(input, 'path');
    if (path) trace.filesWritten.push(path);
  }
}

/** Classify a completed turn. Returns a suggestion when the turn looks like a
 * reusable procedure worth capturing, or a used skill worth refining. */
export function analyzeTurn(trace: TurnTrace, opts: AnalyzeOptions = {}): SkillSuggestion | null {
  const threshold = opts.complexThreshold ?? 4;
  const steps = trace.toolCalls.length;
  const createdSkill = trace.filesWritten.some((p) => SKILL_FILE_RE.test(p));

  if (trace.skillsUsed.length === 0 && steps >= threshold && !createdSkill) {
    return {
      kind: 'capture',
      steps,
      reason: `Completed a ${steps}-step task with no skill. If this is reusable, capture it with the manage-skill skill.`,
    };
  }
  if (trace.skillsUsed.length > 0 && steps >= threshold) {
    const skill = trace.skillsUsed[trace.skillsUsed.length - 1];
    return {
      kind: 'improve',
      skill,
      steps,
      reason: `Used skill "${skill}" but the task still took ${steps} steps — consider refining its instructions.`,
    };
  }
  return null;
}

/** Turns a live AgentSessionEvent stream into per-turn suggestions. */
export class SkillLearningMonitor {
  private trace: TurnTrace = emptyTrace();
  private seen = new Set<string>();
  constructor(
    private readonly onSuggestion: (s: SkillSuggestion) => void,
    private readonly opts: AnalyzeOptions = {},
  ) {}

  /** Record a tool_call by id, deduping across stream events and final messages. */
  private record(id: string | undefined, name: string, input: unknown): void {
    if (id) {
      if (this.seen.has(id)) return;
      this.seen.add(id);
    }
    recordToolCall(this.trace, name, input);
  }

  /** Feed one session event. On turn_end, evaluate and fire the callback. */
  observe(event: {
    type: string;
    name?: string;
    input?: unknown;
    message?: { role?: string; content?: unknown };
  }): void {
    if (event.type === 'turn_start') {
      this.trace = emptyTrace();
      this.seen = new Set();
      return;
    }
    if (event.type === 'tool_call' && typeof event.name === 'string') {
      this.record((event as { id?: string }).id, event.name, event.input);
      return;
    }
    // Some providers surface tool calls only in the assembled assistant message,
    // not as bare stream events — count those too (deduped by id).
    if (event.type === 'message' && event.message?.role === 'assistant') {
      const parts = event.message.content;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const p = part as { type?: string; id?: string; name?: string; input?: unknown };
          if (p.type === 'tool_call' && typeof p.name === 'string') {
            this.record(p.id, p.name, p.input);
          }
        }
      }
      return;
    }
    if (event.type === 'turn_end') {
      const suggestion = analyzeTurn(this.trace, this.opts);
      if (suggestion) this.onSuggestion(suggestion);
    }
  }
}
