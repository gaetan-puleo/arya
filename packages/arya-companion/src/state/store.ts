/**
 * Single zustand store, organised into four conceptual slices:
 *
 *   - connection — connected flag
 *   - registry   — commands, agents, activeAgentId
 *   - sessions   — list, current, transcripts, streaming placeholders
 *   - snapshots  — sub-agent runs + approvals
 *
 * Actions are minimal state mutations. All orchestration (WS dispatch,
 * persistence, optimistic updates) lives in services/aryaClient.ts.
 */

import { create } from "zustand";
import type {
	AgentInfo,
	ApprovalSnapshot,
	ChatMessageItem,
	CommandInfo,
	SessionSummary,
	SubAgentRunSnapshot,
} from "@/types/domain";

export interface StoreState {
	// connection
	connected: boolean;

	// registry
	commands: CommandInfo[];
	agents: AgentInfo[];
	activeAgentId: string | null;
	/** Modalities the server's model accepts. Gates the attach/paste affordances. */
	capabilities: { vision: boolean; audio: boolean };
	/** Name of the model currently cold-loading on the host, or null when idle. */
	loadingModel: string | null;

	// sessions
	sessions: SessionSummary[];
	currentSessionId: string | null;
	transcripts: Map<string, ChatMessageItem[]>;
	streamingPlaceholders: Map<string, string>;

	// snapshots
	subAgentRuns: Map<string, SubAgentRunSnapshot>;
	approvals: Map<string, ApprovalSnapshot>;
}

export interface StoreActions {
	setConnection: (connected: boolean) => void;

	setCommands: (commands: CommandInfo[]) => void;
	setAgents: (
		agents: AgentInfo[],
		activeAgentId: string | null | undefined,
	) => void;
	setActiveAgentId: (id: string | null) => void;
	setCapabilities: (caps: { vision: boolean; audio: boolean }) => void;
	setLoadingModel: (model: string | null) => void;

	setSessions: (sessions: SessionSummary[]) => void;
	setCurrentSessionId: (id: string | null) => void;
	replaceTranscript: (sid: string, rows: ChatMessageItem[]) => void;
	appendTranscriptRow: (sid: string, row: ChatMessageItem) => void;
	clearTranscript: (sid: string) => void;
	dropTranscript: (sid: string) => void;
	setStreamingPlaceholder: (sid: string, text: string) => void;
	appendStreamingPlaceholder: (sid: string, delta: string) => void;
	clearStreamingPlaceholder: (sid: string) => void;

	upsertSubAgentRun: (snap: SubAgentRunSnapshot) => void;
	resetSubAgentRuns: () => void;

	upsertApproval: (snap: ApprovalSnapshot) => void;
}

export type Store = StoreState & StoreActions;

export const useStore = create<Store>((set) => ({
	// ── connection ─────────────────────────────────────────────────
	connected: false,
	setConnection: (connected) => set({ connected }),

	// ── registry ───────────────────────────────────────────────────
	commands: [],
	agents: [],
	activeAgentId: null,
	capabilities: { vision: false, audio: false },
	loadingModel: null,
	setCommands: (commands) => set({ commands }),
	setCapabilities: (capabilities) => set({ capabilities }),
	setLoadingModel: (loadingModel) => set({ loadingModel }),
	setAgents: (agents, activeAgentId) =>
		set((s) => ({
			agents,
			activeAgentId:
				activeAgentId === undefined ? s.activeAgentId : activeAgentId,
		})),
	setActiveAgentId: (activeAgentId) => set({ activeAgentId }),

	// ── sessions ───────────────────────────────────────────────────
	sessions: [],
	currentSessionId: null,
	transcripts: new Map(),
	streamingPlaceholders: new Map(),
	setSessions: (sessions) => set({ sessions }),
	setCurrentSessionId: (currentSessionId) => set({ currentSessionId }),
	replaceTranscript: (sid, rows) =>
		set((s) => {
			const next = new Map(s.transcripts);
			next.set(sid, rows);
			return { transcripts: next };
		}),
	appendTranscriptRow: (sid, row) =>
		set((s) => {
			const next = new Map(s.transcripts);
			const prev = next.get(sid) ?? [];
			next.set(sid, [...prev, row]);
			return { transcripts: next };
		}),
	clearTranscript: (sid) =>
		set((s) => {
			const next = new Map(s.transcripts);
			next.set(sid, []);
			return { transcripts: next };
		}),
	dropTranscript: (sid) =>
		set((s) => {
			const next = new Map(s.transcripts);
			next.delete(sid);
			return { transcripts: next };
		}),
	setStreamingPlaceholder: (sid, text) =>
		set((s) => {
			const next = new Map(s.streamingPlaceholders);
			next.set(sid, text);
			return { streamingPlaceholders: next };
		}),
	// `stream` frames carry incremental DELTAS, so accumulate them into the live
	// placeholder (replacing would leave only the last token visible).
	appendStreamingPlaceholder: (sid, delta) =>
		set((s) => {
			const next = new Map(s.streamingPlaceholders);
			next.set(sid, (s.streamingPlaceholders.get(sid) ?? "") + delta);
			return { streamingPlaceholders: next };
		}),
	clearStreamingPlaceholder: (sid) =>
		set((s) => {
			if (!s.streamingPlaceholders.has(sid)) return {};
			const next = new Map(s.streamingPlaceholders);
			next.delete(sid);
			return { streamingPlaceholders: next };
		}),

	// ── snapshots ──────────────────────────────────────────────────
	subAgentRuns: new Map(),
	approvals: new Map(),
	upsertSubAgentRun: (snap) =>
		set((s) => {
			const next = new Map(s.subAgentRuns);
			next.set(snap.runId, snap);
			return { subAgentRuns: next };
		}),
	resetSubAgentRuns: () => set({ subAgentRuns: new Map() }),
	upsertApproval: (snap) =>
		set((s) => {
			const next = new Map(s.approvals);
			next.set(snap.approvalId, snap);
			return { approvals: next };
		}),
}));
