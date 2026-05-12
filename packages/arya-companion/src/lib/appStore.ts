/**
 * App-level store — single WebSocket owner + render-ready state cache.
 *
 * Post-Batch-3, the companion is a pure renderer:
 *   - `subAgentRuns` and `approvals` are server-pushed snapshots
 *     mirrored verbatim into Maps. No client-side reducers.
 *   - `_sessionMessageListeners` lets the chat screen subscribe to
 *     per-session inbound events for transcript / placeholder UI.
 *
 * `connect()` is idempotent — closing the previous socket and any
 * in-flight reconnect timers before opening a new one.
 */

import * as Haptics from "expo-haptics";
import { create } from "zustand";
import type {
	AgentInfo,
	ApprovalSnapshot,
	CommandInfo,
	SessionSummary,
	SubAgentRunSnapshot,
	WsInboundMessage,
} from "@/lib/ws";
import { createReconnectingSocket } from "@/lib/ws-client";
import { readWsConfig } from "@/lib/wsConfig";

type SessionMessageListener = (msg: WsInboundMessage) => void;

interface AppState {
	// ── Connection ──
	socket: WebSocket | null;
	connected: boolean;

	// ── Server-pushed registries ──
	commands: CommandInfo[];
	agents: AgentInfo[];
	activeAgentId: string | null;

	// ── Sessions ──
	sessions: SessionSummary[];

	// ── Sub-agent runs (server snapshots, keyed by runId) ──
	subAgentRuns: Map<string, SubAgentRunSnapshot>;

	// ── Approvals (server snapshots, keyed by approvalId) ──
	approvals: Map<string, ApprovalSnapshot>;

	// ── Internal ──
	_disposeSocket: (() => void) | null;
	_sessionMessageListeners: Set<SessionMessageListener>;
}

interface AppActions {
	/**
	 * Open (or replace) the WebSocket using the saved config. Safe to
	 * call multiple times — closes the previous socket first.
	 */
	connect: () => Promise<void>;
	/**
	 * Convenience used by the settings screen after saving new
	 * credentials.
	 */
	reconnect: () => Promise<void>;
	setActiveAgent: (agentId: string, sessionId?: string | null) => void;
	createSession: (sessionId: string) => void;
	deleteSession: (sessionId: string) => void;
	renameSession: (sessionId: string, title: string) => void;
	requestSessionHistory: (sessionId: string) => void;
	sendChat: (sessionId: string, text: string) => void;
	sendCommand: (sessionId: string, text: string) => void;
	respondApproval: (
		approvalId: string,
		token: string,
		action: "approve" | "deny",
	) => void;
	/**
	 * Subscribe to inbound per-session events. Returns an unsubscribe.
	 * The chat orchestrator uses this for streaming placeholder updates
	 * and transcript inserts (synthetic_message / sessions:history).
	 */
	subscribeToSessionMessages: (fn: SessionMessageListener) => () => void;
}

export type AppStore = AppState & AppActions;

function isOpen(s: WebSocket | null): s is WebSocket {
	return s?.readyState === WebSocket.OPEN;
}

function send(socket: WebSocket | null, payload: object): void {
	if (!isOpen(socket)) return;
	socket.send(JSON.stringify(payload));
}

export const useAppStore = create<AppStore>((set, get) => ({
	socket: null,
	connected: false,
	commands: [],
	agents: [],
	activeAgentId: null,
	sessions: [],
	subAgentRuns: new Map(),
	approvals: new Map(),
	_disposeSocket: null,
	_sessionMessageListeners: new Set(),

	connect: async () => {
		// Tear down any previous socket + reconnect timers.
		get()._disposeSocket?.();

		const cfg = await readWsConfig();
		if (!cfg) {
			set({ socket: null, connected: false });
			return;
		}

		console.log(
			`[ws] connecting to ${cfg.url}${cfg.token ? " (with token)" : ""}`,
		);

		const handle = createReconnectingSocket(cfg.url, cfg.token, (s) => {
			set({ socket: s, connected: false });

			s.addEventListener("open", () => {
				console.log(`[ws] connected to ${cfg.url}`);
				set({ connected: true });
				send(s, { type: "commands" });
				send(s, { type: "agents" });
			});

			s.addEventListener("close", (e: CloseEvent) => {
				console.warn(
					`[ws] closed (code=${e.code}, reason="${e.reason || ""}") — will retry in 3s`,
				);
				set({ connected: false });
			});

			s.addEventListener("error", (err: Event) => {
				const m = (err as Event & { message?: string }).message;
				console.error(
					`[ws] socket error on ${cfg.url}${m ? `: ${m}` : ""} — check that the agent is running and the URL is reachable`,
				);
			});

			s.addEventListener("message", (e: MessageEvent) => {
				let msg: WsInboundMessage;
				try {
					msg = JSON.parse(e.data) as WsInboundMessage;
				} catch {
					return;
				}
				handleInbound(msg, set, get);
			});
		});

		set({
			_disposeSocket: () => {
				handle.dispose();
				set({ socket: null, connected: false });
			},
		});
	},

	reconnect: async () => {
		await get().connect();
	},

	setActiveAgent: (agentId, sessionId) => {
		const { socket, activeAgentId } = get();
		if (!isOpen(socket)) return;
		if (agentId === activeAgentId) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		send(socket, { type: "set_active_agent", agentId, sessionId: sessionId ?? undefined });
		// Optimistic — server will echo back via `active_agent`.
		set({ activeAgentId: agentId });
	},

	createSession: (sessionId) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, { type: "sessions:create", sessionId });
	},

	deleteSession: (sessionId) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, { type: "sessions:delete", sessionId });
	},

	renameSession: (sessionId, title) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, { type: "sessions:rename", sessionId, title });
	},

	requestSessionHistory: (sessionId) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, { type: "sessions:get", sessionId });
	},

	sendChat: (sessionId, text) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, { type: "chat", text, sessionId });
	},

	sendCommand: (sessionId, text) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, { type: "command", text, sessionId });
	},

	respondApproval: (approvalId, token, action) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, {
			type: "approval_response",
			approvalId,
			token,
			action,
		});
	},

	subscribeToSessionMessages: (fn) => {
		const listeners = get()._sessionMessageListeners;
		listeners.add(fn);
		return () => {
			listeners.delete(fn);
		};
	},
}));

// ── Typed dispatch table ──────────────────────────────────────────────
// Exhaustive `switch` over `WsInboundMessage["type"]`. Compile-time
// enforcement that every variant is handled (or explicitly forwarded
// to the per-session listeners).
function handleInbound(
	msg: WsInboundMessage,
	set: (
		partial:
			| Partial<AppState>
			| ((s: AppState) => Partial<AppState>),
	) => void,
	get: () => AppStore,
): void {
	switch (msg.type) {
		case "commands": {
			set({ commands: msg.commands ?? [] });
			return;
		}
		case "agents": {
			const update: Partial<AppState> = { agents: msg.agents ?? [] };
			if (
				typeof msg.activeAgentId === "string" ||
				msg.activeAgentId === null
			) {
				update.activeAgentId = msg.activeAgentId;
			}
			set(update);
			return;
		}
		case "active_agent": {
			set({ activeAgentId: msg.agentId });
			return;
		}
		case "sessions:listed": {
			set({ sessions: Array.isArray(msg.sessions) ? msg.sessions : [] });
			return;
		}
		case "sub_agent_run": {
			// Functional updater: avoids the read-then-write race when two
			// snapshots arrive in the same microtask.
			set((s) => ({
				subAgentRuns: new Map(s.subAgentRuns).set(msg.run.runId, msg.run),
			}));
			// Notify per-session listeners so the chat screen can insert a
			// card row on first sighting.
			for (const fn of get()._sessionMessageListeners) fn(msg);
			return;
		}
		case "sub_agent_runs:listed": {
			set({
				subAgentRuns: new Map(msg.runs.map((r) => [r.runId, r])),
			});
			return;
		}
		case "approval_state": {
			set((s) => ({
				approvals: new Map(s.approvals).set(
					msg.snapshot.approvalId,
					msg.snapshot,
				),
			}));
			for (const fn of get()._sessionMessageListeners) fn(msg);
			return;
		}
		case "approvals:listed": {
			set({
				approvals: new Map(
					msg.approvals.map((a) => [a.approvalId, a]),
				),
			});
			return;
		}
		case "stream":
		case "done":
		case "sessions:history":
		case "synthetic_message":
		case "error": {
			// Per-session payloads — forward to subscribed screens.
			for (const fn of get()._sessionMessageListeners) fn(msg);
			return;
		}
		case "scheduler_event": {
			// No per-message rendering; the server's next `sessions:listed`
			// covers it.
			return;
		}
		default: {
			const _exhaustive: never = msg;
			void _exhaustive;
		}
	}
}
