/**
 * Arya WebSocket client.
 *
 * Owns the WS lifecycle, the inbound JSON → store dispatch, and the
 * typed outbound senders. The store knows nothing about the WS; the
 * components know nothing about the wire. Hooks call into this module
 * for everything.
 *
 *   transport (services/wsTransport.ts)
 *      │  raw socket events
 *      ▼
 *   aryaClient
 *      │  store.<action>()
 *      ▼
 *   useStore (state/store.ts)
 *      │  zustand subscription
 *      ▼
 *   hooks → components
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

import { useStore } from "@/state/store";
import { readWsConfig } from "@/services/wsConfig";
import { createReconnectingSocket } from "@/services/wsTransport";
import { wireSessionToRows } from "@/services/projectMessage";
import {
	reduceSubAgentEvent,
	resolveApproval,
	snapshotFromApprovalRequest,
} from "@/services/snapshotReducers";
import type {
	WsInboundMessage,
	WsOutboundMessage,
} from "@/types/wire";

const SESSION_ID_KEY = "arya-companion-current-session";

let disposeTransport: (() => void) | null = null;

// ─── Lifecycle ────────────────────────────────────────────────────────

/**
 * Start (or restart) the WS transport using the stored config.
 * Idempotent — disposes the previous transport first.
 */
export async function start(): Promise<void> {
	disposeTransport?.();
	disposeTransport = null;

	const savedSid = await AsyncStorage.getItem(SESSION_ID_KEY);
	if (savedSid) useStore.getState().setCurrentSessionId(savedSid);

	const cfg = await readWsConfig();
	if (!cfg) {
		useStore.getState().setConnection(null, false);
		return;
	}

	console.log(
		`[ws] connecting to ${cfg.url}${cfg.token ? " (with token)" : ""}`,
	);

	const handle = createReconnectingSocket(cfg.url, cfg.token, (socket) => {
		useStore.getState().setConnection(socket, false);

		socket.addEventListener("open", () => {
			console.log(`[ws] connected to ${cfg.url}`);
			useStore.getState().setConnection(socket, true);
			// Server pushes the registries on connect; re-request defensively
			// in case we reconnected silently after a transient drop.
			sendRaw(socket, { type: "commands" });
			sendRaw(socket, { type: "agents" });
			sendRaw(socket, { type: "sessions:list" });
			// Pull the current session's history if we have one.
			const sid = useStore.getState().currentSessionId;
			if (sid) sendRaw(socket, { type: "sessions:get", sessionId: sid });
		});

		socket.addEventListener("close", (e: CloseEvent) => {
			console.warn(
				`[ws] closed (code=${e.code}, reason="${e.reason || ""}") — will retry in 3s`,
			);
			useStore.getState().setConnection(socket, false);
		});

		socket.addEventListener("error", (err: Event) => {
			const m = (err as Event & { message?: string }).message;
			console.error(
				`[ws] socket error on ${cfg.url}${m ? `: ${m}` : ""} — check that the agent is running and the URL is reachable`,
			);
		});

		socket.addEventListener("message", (e: MessageEvent) => {
			let msg: WsInboundMessage;
			try {
				msg = JSON.parse(e.data) as WsInboundMessage;
			} catch {
				return;
			}
			dispatch(msg);
		});
	});

	disposeTransport = () => {
		handle.dispose();
		useStore.getState().setConnection(null, false);
	};
}

/** Stops the WS transport. */
export function stop(): void {
	disposeTransport?.();
	disposeTransport = null;
}

// ─── Outbound (typed senders) ─────────────────────────────────────────

function activeSocket(): WebSocket | null {
	const s = useStore.getState().socket;
	return s?.readyState === WebSocket.OPEN ? s : null;
}

function sendRaw(socket: WebSocket, payload: WsOutboundMessage): void {
	socket.send(JSON.stringify(payload));
}

function send(payload: WsOutboundMessage): boolean {
	const s = activeSocket();
	if (!s) return false;
	sendRaw(s, payload);
	return true;
}

export function requestCommands(): void {
	send({ type: "commands" });
}

export function requestAgents(): void {
	send({ type: "agents" });
}

export function requestSessions(): void {
	send({ type: "sessions:list" });
}

export function requestSessionHistory(sessionId: string): void {
	send({ type: "sessions:get", sessionId });
}

export function setActiveAgent(
	agentId: string,
	sessionId: string | null,
): void {
	const { activeAgentId, setActiveAgentId } = useStore.getState();
	if (agentId === activeAgentId) return;
	if (send({ type: "set_active_agent", agentId, sessionId: sessionId ?? undefined })) {
		setActiveAgentId(agentId); // optimistic — server echoes `active_agent`
	}
}

export function createSession(sessionId: string, title?: string): void {
	send({ type: "sessions:create", sessionId, title });
}

export function deleteSession(sessionId: string): void {
	send({ type: "sessions:delete", sessionId });
}

export function renameSession(sessionId: string, title: string): void {
	send({ type: "sessions:rename", sessionId, title });
}

export function selectSession(sessionId: string | null): void {
	useStore.getState().setCurrentSessionId(sessionId);
	if (sessionId) {
		AsyncStorage.setItem(SESSION_ID_KEY, sessionId).catch(() => {});
		requestSessionHistory(sessionId);
	} else {
		AsyncStorage.removeItem(SESSION_ID_KEY).catch(() => {});
	}
}

/**
 * Send a chat message. Optimistically appends a user row + opens the
 * streaming placeholder (empty string = "loading"). The server will
 * fill it via `stream` events and finalise via `message` + `turn_end`.
 */
export function sendChat(sessionId: string, text: string): void {
	const store = useStore.getState();
	const optimisticRow = {
		id: `local-${Date.now()}`,
		role: "user" as const,
		text,
	};
	store.appendTranscriptRow(sessionId, optimisticRow);
	store.setStreamingPlaceholder(sessionId, "");
	send({ type: "chat", sessionId, text });
}

/**
 * Send a slash command. The companion shows an echo locally; the
 * server's command handler emits its own UI-visible system messages
 * (e.g. `/agents` output) which arrive through the `message` event.
 */
export function sendCommand(sessionId: string, text: string): void {
	const store = useStore.getState();
	const optimisticRow = {
		id: `local-cmd-${Date.now()}`,
		role: "user" as const,
		text,
	};
	store.appendTranscriptRow(sessionId, optimisticRow);
	send({ type: "command", sessionId, text });
}

export function respondApproval(
	approvalId: string,
	action: "approve" | "deny",
): void {
	const ok = send({
		type: "approval_response",
		requestId: approvalId,
		action,
	});
	if (!ok) return;
	const store = useStore.getState();
	const snap = store.approvals.get(approvalId);
	if (snap && snap.status === "pending") {
		store.upsertApproval(resolveApproval(snap, action));
	}
}

// ─── Inbound dispatch ─────────────────────────────────────────────────

function dispatch(msg: WsInboundMessage): void {
	const store = useStore.getState();

	switch (msg.type) {
		case "commands":
			store.setCommands(msg.commands);
			return;

		case "agents":
			store.setAgents(
				msg.agents.map((a) => ({
					id: a.name,
					description: a.description,
					color: a.color,
					type: "primary",
				})),
				msg.activeAgentId,
			);
			return;

		case "active_agent":
			store.setActiveAgentId(msg.agentId);
			return;

		case "sessions:listed":
			store.setSessions(msg.sessions);
			return;

		case "sessions:changed":
			requestSessions();
			return;

		case "sessions:history": {
			const sid = msg.sessionId;
			const wire = msg.session;
			const rows = wire
				? wireSessionToRows(wire.messages, store.activeAgentId)
				: [];
			store.replaceTranscript(sid, rows);
			return;
		}

		case "stream": {
			const sid = msg.sessionId;
			if (!sid) return;
			store.setStreamingPlaceholder(sid, msg.text);
			return;
		}

		case "reasoning":
			// Not surfaced in the UI today; logged for visibility.
			return;

		case "turn_start":
			return;

		case "turn_end": {
			const sid = msg.sessionId;
			if (!sid) return;
			store.clearStreamingPlaceholder(sid);
			return;
		}

		case "message": {
			const sid = msg.sessionId;
			if (!sid) return;
			const rows = wireSessionToRows([msg.message], store.activeAgentId);
			for (const row of rows) store.appendTranscriptRow(sid, row);
			// Assistant message landed → drop the streaming placeholder.
			if (rows.length > 0) store.clearStreamingPlaceholder(sid);
			return;
		}

		case "sub_agent_event": {
			const prev = store.subAgentRuns.get(msg.event.runId);
			store.upsertSubAgentRun(reduceSubAgentEvent(prev, msg.event));
			return;
		}

		case "approval_request":
			store.upsertApproval(snapshotFromApprovalRequest(msg));
			return;

		case "scheduler_event":
			// Server's next `sessions:listed` keeps the drawer fresh.
			return;

		case "error": {
			const sid = msg.sessionId;
			if (sid) store.clearStreamingPlaceholder(sid);
			console.error(
				`[ws] server error${sid ? ` (${sid})` : ""}: ${msg.message ?? "(no message)"}`,
			);
			return;
		}

		default: {
			const _exhaustive: never = msg;
			void _exhaustive;
		}
	}
}
