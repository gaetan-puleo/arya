/**
 * Arya WebSocket client — orchestrator.
 *
 * Owns the WS lifecycle (start/stop, attaching socket handlers,
 * wiring the inbound parser to `dispatch`). Outbound senders that
 * need a typed payload + optimistic local effect (`sendChat`,
 * `sendCommand`, `setActiveAgent`) live here too — they hold the
 * "intent → store + wire" coupling and feel out of place anywhere
 * else.
 *
 * The heavy lifting is delegated:
 *   - outbound.ts   — transport handle, `send` / `sendRaw`, raw senders
 *   - wireDispatch  — the big inbound switch
 *   - optimistic.ts — id generation, row insertion/rollback
 *   - approvals.ts  — approval-snapshot lifecycle, token replay
 *   - activeAgent.ts — optimistic active-agent state + rollback
 *
 *   transport (services/wsTransport.ts)
 *      │  raw socket events
 *      ▼
 *   aryaClient (this file)
 *      │  dispatch(msg) → store.<action>()
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
import { dispatch } from "@/services/wireDispatch";
import {
	send,
	sendRaw,
	setTransportHandle,
	transportRef,
	requestSessionHistory,
} from "@/services/outbound";
import { nextOptimisticId, removeTranscriptRow } from "@/services/optimistic";
import { markActiveAgentPending } from "@/services/activeAgent";
import { isWsInboundMessage } from "@/types/wire";
import type { Attachment } from "@/types/domain";

// Re-exports — keep the surface used by hooks/components unchanged.
export { send } from "@/services/outbound";
export { respondApproval } from "@/services/approvals";
export {
	requestCommands,
	requestAgents,
	requestSessions,
	requestSessionHistory,
} from "@/services/outbound";

const SESSION_ID_KEY = "arya-companion-current-session";

/**
 * Extract the non-standard `message` field React Native adds to WS error events.
 * Standard `Event` has no message; the cast is local to this helper.
 */
function wsErrorMessage(err: Event): string | undefined {
	const e = err as Event & { message?: unknown };
	return typeof e.message === "string" ? e.message : undefined;
}

// ─── Lifecycle ────────────────────────────────────────────────────────

// Concurrency guard. `start()` is async and awaits AsyncStorage; without
// this guard two parallel calls (e.g. Save tapped twice, foreground
// race) both reach the WebSocket-construction line and orphan the
// first socket. `startPromise` collapses concurrent calls to a single
// in-flight promise; `starting` short-circuits the trivial "still in
// progress" case.
let starting = false;
let startPromise: Promise<void> | null = null;

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
	setTransportHandle(null);

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
			// React Native's WebSocket `error` event carries a non-standard
			// `message` field that `lib.dom.Event` doesn't model. Narrow once
			// in a named helper instead of an inline `as` cast at every use site.
			const m = wsErrorMessage(err);
			console.error(
				`[ws] socket error on ${cfg.url}${m ? `: ${m}` : ""} — check that the agent is running and the URL is reachable`,
			);
		});

		socket.addEventListener("message", (e: MessageEvent) => {
			let parsed: unknown;
			try {
				parsed = JSON.parse(e.data);
			} catch {
				return;
			}
			if (!isWsInboundMessage(parsed)) return;
			dispatch(parsed);
		});

		// Initial "socket exists, not yet open" state. Subsequent `open`
		// will flip `connected` to true. Use the ref-resolved socket if
		// available to avoid writing a stale reference.
		useStore.getState().setConnection(socket, false);
	});

	setTransportHandle(handle);
}

/** Stops the WS transport. */
export function stop(): void {
	transportRef.current?.dispose();
	setTransportHandle(null);
	useStore.getState().setConnection(null, false);
}

// ─── Outbound senders that pair an optimistic local effect ────────────

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
		markActiveAgentPending(previous, sessionId);
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

/**
 * Send a chat message. Optimistically appends a user row + opens the
 * streaming placeholder (empty string = "loading"). If the socket is
 * not connected the send returns false — we roll back the optimistic
 * row + placeholder so the user sees a clear failure rather than a
 * never-ending typing indicator.
 */
export function sendChat(
	sessionId: string,
	text: string,
	attachments?: Attachment[],
): void {
	const store = useStore.getState();
	const optimisticRow = {
		id: nextOptimisticId("msg"),
		role: "user" as const,
		text,
		...(attachments && attachments.length > 0 ? { attachments } : {}),
	};
	store.appendTranscriptRow(sessionId, optimisticRow);
	store.setStreamingPlaceholder(sessionId, "");
	const ok = send({
		type: "chat",
		sessionId,
		text,
		...(attachments && attachments.length > 0 ? { attachments } : {}),
	});
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
