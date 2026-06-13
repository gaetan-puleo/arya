/**
 * Single zustand store, organised into four conceptual slices:
 *
 *   - connection — socket + connected flag
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
	ConnectionState,
	SessionSummary,
	SubAgentRunSnapshot,
} from "@/types/domain";

export interface StoreState {
	// connection
	socket: WebSocket | null;
	connected: boolean;
	connectionState: ConnectionState;

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
	setConnection: (socket: WebSocket | null, connected: boolean) => void;

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
	clearStreamingPlaceholder: (sid: string) => void;

	upsertSubAgentRun: (snap: SubAgentRunSnapshot) => void;
	resetSubAgentRuns: () => void;

	upsertApproval: (snap: ApprovalSnapshot) => void;
	resetApprovals: () => void;
	/**
	 * Drop every approval whose `channelId` matches `sessionId`. Called when
	 * a session is deleted or swapped so stale prompts don't leak into the
	 * new context. Approvals with `channelId: null` (raised outside any
	 * session) are unaffected.
	 */
	clearApprovalsForSession: (sessionId: string) => void;
}

export type Store = StoreState & StoreActions;

export const useStore = create<Store>((set) => ({
	// ── connection ─────────────────────────────────────────────────
	socket: null,
	connected: false,
	connectionState: "disconnected",
	setConnection: (socket, connected) =>
		set({
			socket,
			connected,
			connectionState: !socket
				? "disconnected"
				: connected
					? "connected"
					: "connecting",
		}),

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
	resetApprovals: () => set({ approvals: new Map() }),
	clearApprovalsForSession: (sessionId) =>
		set((s) => {
			let removed = 0;
			const next = new Map(s.approvals);
			for (const [id, snap] of s.approvals) {
				if (snap.channelId === sessionId) {
					next.delete(id);
					removed++;
				}
			}
			return removed > 0 ? { approvals: next } : {};
		}),
}));
