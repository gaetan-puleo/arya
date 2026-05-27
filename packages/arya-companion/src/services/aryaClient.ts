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
import {
	createReconnectingSocket,
	type ReconnectingSocket,
} from "@/services/wsTransport";
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

// Approval row id prefix — must match ChatMessageList.APPROVAL_PREFIX.
const APPROVAL_ROW_PREFIX = "approval-";
// Sub-agent row id prefix — must match ChatMessageList.SUBAGENT_PREFIX.
const SUBAGENT_ROW_PREFIX = "sub-agent-";

// ─── Transport state ──────────────────────────────────────────────────

/**
 * Single source of truth for the live transport handle. `transportRef`
 * lets handlers always read the *current* socket instead of closing
 * over the socket they were created with (which may be stale after a
 * fast reconnect).
 */
const transportRef: { current: ReconnectingSocket | null } = {
	current: null,
};

// Concurrency guard. `start()` is async and awaits AsyncStorage; without
// this guard two parallel calls (e.g. Save tapped twice, foreground
// race) both reach the WebSocket-construction line and orphan the
// first socket. `startPromise` collapses concurrent calls to a single
// in-flight start; `starting` short-circuits the trivial "still in
// progress" case.
let starting = false;
let startPromise: Promise<void> | null = null;

// Tracks approval ids whose tokens have been consumed (either resolved
// or already known to the UI). Duplicate `approval_request` payloads
// for an id already in this set are dropped — server retries can't
// reset a resolved approval back to pending.
const seenApprovalIds = new Set<string>();

// Optimistic active-agent change pending server confirmation. If the
// server sends a different `active_agent` than we optimistically set,
// we revert; an `error` after a `set_active_agent` send also reverts.
let pendingActiveAgent: { previous: string | null; sessionId: string | null } | null =
	null;

// ─── Lifecycle ────────────────────────────────────────────────────────

/**
 * Start (or restart) the WS transport using the stored config.
 * Idempotent — concurrent calls collapse to the same in-flight promise,
 * and a re-entry after completion disposes the previous transport
 * before spawning a new one.
 */
export function start(): Promise<void> {
	if (starting && startPromise) return startPromise;
	starting = true;
	startPromise = doStart().finally(() => {
		starting = false;
		startPromise = null;
	});
	return startPromise;
}

async function doStart(): Promise<void> {
	// Dispose the previous transport synchronously; do this before any
	// await so concurrent callers can't observe a stale handle.
	transportRef.current?.dispose();
	transportRef.current = null;

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
		// Attach ALL listeners BEFORE the socket transitions — `onSocket`
		// fires synchronously after `new WebSocket(...)` so any `open`
		// event dispatched during construction (on certain RN polyfills)
		// still sees its handler.
		socket.addEventListener("open", () => {
			// Read the live transport from the ref so we never write a
			// stale socket back into the store after a fast reconnect.
			const live = transportRef.current?.getSocket() ?? socket;
			console.log(`[ws] connected to ${cfg.url}`);
			useStore.getState().setConnection(live, true);
			// Server pushes the registries on connect; re-request defensively
			// in case we reconnected silently after a transient drop.
			sendRaw(live, { type: "commands" });
			sendRaw(live, { type: "agents" });
			sendRaw(live, { type: "sessions:list" });
			// Pull the current session's history if we have one.
			const sid = useStore.getState().currentSessionId;
			if (sid) sendRaw(live, { type: "sessions:get", sessionId: sid });
		});

		socket.addEventListener("close", (e: CloseEvent) => {
			console.warn(
				`[ws] closed (code=${e.code}, reason="${e.reason || ""}")` +
					" — will retry with exponential backoff",
			);
			// Only flip `connected` to false if THIS socket is still the
			// live one. After a fast reconnect, the new socket's `open`
			// may have already written `connected: true`; we must not
			// overwrite that from an older socket's tail event.
			const live = transportRef.current?.getSocket() ?? null;
			if (live === socket || live === null) {
				useStore.getState().setConnection(live, false);
			}
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

		// Initial "socket exists, not yet open" state. Subsequent `open`
		// will flip `connected` to true. Use the ref-resolved socket if
		// available to avoid writing a stale reference.
		useStore.getState().setConnection(socket, false);
	});

	transportRef.current = handle;
}

/** Stops the WS transport. */
export function stop(): void {
	transportRef.current?.dispose();
	transportRef.current = null;
	useStore.getState().setConnection(null, false);
}

// ─── Outbound (typed senders) ─────────────────────────────────────────

function activeSocket(): WebSocket | null {
	const s = transportRef.current?.getSocket() ?? null;
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
	const previous = activeAgentId;
	if (send({ type: "set_active_agent", agentId, sessionId: sessionId ?? undefined })) {
		setActiveAgentId(agentId); // optimistic — server echoes `active_agent`
		// Record the previous value so we can roll back on rejection.
		pendingActiveAgent = { previous, sessionId };
	} else {
		console.warn(
			`[ws] set_active_agent dropped (not connected): ${agentId}`,
		);
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

// ─── Optimistic id generation ─────────────────────────────────────────

/**
 * Monotonic counter combined with `Math.random()` for client-side
 * optimistic ids. `Date.now()` alone can collide when two sends land
 * in the same millisecond (rapid taps); FlashList warns about
 * duplicate keys and behaviour around the second row degrades.
 */
let optimisticCounter = 0;

function nextOptimisticId(kind: "msg" | "cmd"): string {
	optimisticCounter += 1;
	const rand = Math.random().toString(36).slice(2, 8);
	return `local-${kind}-${Date.now()}-${optimisticCounter}-${rand}`;
}

/**
 * Send a chat message. Optimistically appends a user row + opens the
 * streaming placeholder (empty string = "loading"). If the socket is
 * not connected the send returns false — we roll back the optimistic
 * row + placeholder so the user sees a clear failure rather than a
 * never-ending typing indicator.
 */
export function sendChat(sessionId: string, text: string): void {
	const store = useStore.getState();
	const optimisticRow = {
		id: nextOptimisticId("msg"),
		role: "user" as const,
		text,
	};
	store.appendTranscriptRow(sessionId, optimisticRow);
	store.setStreamingPlaceholder(sessionId, "");
	const ok = send({ type: "chat", sessionId, text });
	if (!ok) {
		// Rollback: drop the optimistic row + placeholder so the UI
		// doesn't lie about a message that never went out.
		store.clearStreamingPlaceholder(sessionId);
		removeTranscriptRow(sessionId, optimisticRow.id);
		console.warn(
			`[ws] chat dropped (not connected): sessionId=${sessionId}`,
		);
	}
}

/**
 * Send a slash command. The companion shows an echo locally; the
 * server's command handler emits its own UI-visible system messages
 * (e.g. `/agents` output) which arrive through the `message` event.
 */
export function sendCommand(sessionId: string, text: string): void {
	const store = useStore.getState();
	const optimisticRow = {
		id: nextOptimisticId("cmd"),
		role: "user" as const,
		text,
	};
	store.appendTranscriptRow(sessionId, optimisticRow);
	const ok = send({ type: "command", sessionId, text });
	if (!ok) {
		removeTranscriptRow(sessionId, optimisticRow.id);
		console.warn(
			`[ws] command dropped (not connected): sessionId=${sessionId}`,
		);
	}
}

/**
 * Helper — drop a single optimistic row from a session transcript.
 * Used on rollback when the underlying send fails.
 */
function removeTranscriptRow(sessionId: string, rowId: string): void {
	const store = useStore.getState();
	const rows = store.transcripts.get(sessionId);
	if (!rows) return;
	const next = rows.filter((r) => r.id !== rowId);
	if (next.length !== rows.length) {
		store.replaceTranscript(sessionId, next);
	}
}

export function respondApproval(
	approvalId: string,
	action: "approve" | "deny",
): void {
	const store = useStore.getState();
	const snap = store.approvals.get(approvalId);
	// Single-use token: refuse if already resolved (defends against
	// re-tap on a duplicate approval row).
	if (!snap || snap.status !== "pending") {
		console.warn(
			`[ws] respondApproval ignored — ${approvalId} is not pending`,
		);
		return;
	}
	const ok = send({
		type: "approval_response",
		requestId: approvalId,
		action,
	});
	if (!ok) {
		// Fail-fast with a clear log; the snapshot stays `pending` so the
		// UI still offers the buttons. Surfacing a richer error in the
		// store would require a new slice — keep the change minimal here.
		console.error(
			`[ws] approval_response dropped (not connected): ${approvalId}`,
		);
		return;
	}
	store.upsertApproval(resolveApproval(snap, action));
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

		case "active_agent": {
			// Server confirmed (or independently flipped) the active
			// agent. If we had an optimistic change pending and the
			// server's new value disagrees, clear our pending record —
			// the server is the source of truth.
			pendingActiveAgent = null;
			store.setActiveAgentId(msg.agentId);
			return;
		}

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
			const event = msg.event;
			const prev = store.subAgentRuns.get(event.runId);
			const next = reduceSubAgentEvent(prev, event);
			store.upsertSubAgentRun(next);

			// Mirror the run as a transcript row so ChatMessageList can
			// render it inline (recognises the `sub-agent-` prefix and
			// renders a SubAgentCard). Only do this once per runId —
			// subsequent events update the snapshot Map, which the card
			// reads by id.
			if (!prev) {
				const sid = event.parentSessionId;
				if (sid) {
					store.appendTranscriptRow(sid, {
						id: `${SUBAGENT_ROW_PREFIX}${event.runId}`,
						role: "assistant",
						text: "",
						authorAgentId: event.agentName,
					});
				}
			}
			return;
		}

		case "approval_request": {
			// Single-use binding: drop duplicates so a server retry
			// can't reset a resolved approval back to pending.
			if (seenApprovalIds.has(msg.requestId)) return;
			seenApprovalIds.add(msg.requestId);

			store.upsertApproval(snapshotFromApprovalRequest(msg));
			// Append a transcript row so ChatMessageList renders an
			// ApprovalCard inline (recognises the `approval-` prefix).
			const sid = msg.sessionId;
			if (sid) {
				store.appendTranscriptRow(sid, {
					id: `${APPROVAL_ROW_PREFIX}${msg.requestId}`,
					role: "assistant",
					text: "",
					authorAgentId: msg.agentName,
				});
			}
			return;
		}

		case "scheduler_event":
			// Server's next `sessions:listed` keeps the drawer fresh.
			return;

		case "error": {
			const sid = msg.sessionId;
			if (sid) store.clearStreamingPlaceholder(sid);
			// Roll back any pending optimistic active-agent change — a
			// server `error` that arrives after `set_active_agent` is
			// our best signal that the change was rejected. (The server
			// doesn't expose a dedicated rejection type today.)
			if (pendingActiveAgent) {
				store.setActiveAgentId(pendingActiveAgent.previous);
				pendingActiveAgent = null;
			}
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
