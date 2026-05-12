/**
 * App-level store — one owner for the WebSocket connection and every
 * piece of cross-cutting state that used to be duplicated across
 * screens (sockets, sub-agent event cache, agents/commands registry,
 * sessions list).
 *
 * Design notes
 * - Single WebSocket. Previously three separate `useReconnectingSocket`
 *   instances (chat screen, sub-agent detail, settings) opened their
 *   own. Now everyone subscribes to one.
 * - Live `reconnect()` action exposed so the settings screen can
 *   re-dial after saving without an app restart.
 * - Sub-agent events tee'd into a per-runId map inside the store
 *   (replaces the module-global `globalSubAgentEvents`). Per-run
 *   subscriptions let the detail screen replay history + receive new
 *   events without opening a second socket.
 * - Per-session message-stream subscriptions used by the chat screen
 *   (`stream`/`done`/`error`/`approval_*`/`sessions:history`/
 *   `sub_agent_event`). The chat orchestrator subscribes via
 *   {@link subscribeToSessionMessages} and decides how each event
 *   updates its own transcript state.
 */

import * as Haptics from "expo-haptics";
import { create } from "zustand";
import type {
	AgentInfo,
	CommandInfo,
	SessionSummary,
	SubAgentEvent,
	WsInboundMessage,
} from "@/lib/ws";
import { createReconnectingSocket } from "@/lib/ws-client";
import { readWsConfig } from "@/lib/wsConfig";
import type { SubAgentRunInfo } from "@/components/SubAgentCard";

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

	// ── Sub-agent runs (cards rendered in chat) ──
	subAgentRuns: Map<string, SubAgentRunInfo>;
	// Per-run event log; consumed by the detail screen.
	subAgentEvents: Map<string, SubAgentEvent[]>;

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
	setActiveAgent: (agentId: string) => void;
	createSession: (sessionId: string) => void;
	deleteSession: (sessionId: string) => void;
	renameSession: (sessionId: string, title: string) => void;
	requestSessionHistory: (sessionId: string) => void;
	sendChat: (sessionId: string, text: string) => void;
	sendCommand: (sessionId: string, text: string) => void;
	respondApproval: (
		requestId: string,
		token: string,
		action: "approve" | "deny",
	) => void;
	/** Reset the sub-agent run cards (chat-level switch / clear). */
	clearSubAgentRuns: () => void;
	/**
	 * Subscribe to inbound per-session events. Returns an unsubscribe.
	 * The chat orchestrator owns its own `messages` / `approvals` state
	 * — the store doesn't try to own those because their lifecycle
	 * (insertion ordering relative to the streaming row, etc.) is
	 * tightly coupled to the chat UI.
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
	subAgentEvents: new Map(),
	_disposeSocket: null,
	_sessionMessageListeners: new Set(),

	connect: async () => {
		// Tear down any previous socket before opening a new one.
		get()._disposeSocket?.();

		const cfg = await readWsConfig();
		if (!cfg) {
			set({ socket: null, connected: false });
			return;
		}

		console.log(
			`[ws] connecting to ${cfg.url}${cfg.token ? " (with token)" : ""}`,
		);

		let current: WebSocket | null = null;
		let cancelled = false;

		createReconnectingSocket(cfg.url, cfg.token, (s) => {
			if (cancelled) {
				s.close();
				return;
			}
			current = s;
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
				cancelled = true;
				current?.close();
				set({ socket: null, connected: false });
			},
		});
	},

	reconnect: async () => {
		await get().connect();
	},

	setActiveAgent: (agentId) => {
		const { socket, activeAgentId } = get();
		if (!isOpen(socket)) return;
		if (agentId === activeAgentId) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		send(socket, { type: "set_active_agent", agentId });
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

	respondApproval: (requestId, token, action) => {
		const { socket } = get();
		if (!isOpen(socket)) return;
		send(socket, {
			type: "approval_response",
			requestId,
			token,
			action: action === "approve" ? "approved" : "denied",
			channelId: "websocket",
		});
	},

	clearSubAgentRuns: () => {
		set({ subAgentRuns: new Map() });
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
// to the per-session listeners). Replaces the old "if (...) return"
// chain across multiple hooks.
function handleInbound(
	msg: WsInboundMessage,
	set: (partial: Partial<AppState>) => void,
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
		case "sub_agent_event": {
			const evt = msg.event;
			if (!evt) return;
			const runId = evt.runId;

			// Append to the per-run event log.
			const events = new Map(get().subAgentEvents);
			const stored = events.get(runId) ?? [];
			events.set(runId, [...stored, evt]);

			// Update the run summary used by the chat-level card.
			const runs = new Map(get().subAgentRuns);
			const cardId = `sub-agent-${runId}`;
			if (evt.kind === "invocation_start") {
				runs.set(cardId, {
					runId,
					agentId: evt.agentId,
					status: "running",
					toolCount: 0,
					startTs: evt.ts,
				});
			} else if (evt.kind === "tool_call_start") {
				const run = runs.get(cardId);
				if (run) {
					runs.set(cardId, { ...run, toolCount: run.toolCount + 1 });
				}
			} else if (evt.kind === "invocation_end") {
				const run = runs.get(cardId);
				if (run) {
					const st = (evt.data.status as string) ?? "";
					runs.set(cardId, {
						...run,
						status: st === "success" ? "success" : "error",
						endTs: evt.ts,
					});
				}
			}

			set({ subAgentRuns: runs, subAgentEvents: events });

			// Fan out to per-session listeners (the chat orchestrator
			// uses this to insert a card row).
			for (const fn of get()._sessionMessageListeners) fn(msg);
			return;
		}
		case "stream":
		case "done":
		case "approval_request":
		case "approval_response":
		case "sessions:history":
		case "error": {
			// Per-session payloads — forward to subscribed screens.
			for (const fn of get()._sessionMessageListeners) fn(msg);
			return;
		}
		default: {
			// Exhaustiveness check — flags any new WsInboundMessage variant
			// that we forgot to handle.
			const _exhaustive: never = msg;
			void _exhaustive;
		}
	}
}


