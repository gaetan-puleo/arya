/**
 * Outbound transport — owns the live `ReconnectingSocket` handle and
 * exposes the typed `send` helpers used everywhere else in the
 * companion. Pure plumbing: knows about JSON-encoding and the OPEN
 * readyState; knows nothing about wire-message semantics.
 *
 * The handle is updated by `aryaClient.start()` / `stop()`. All other
 * modules read it through `activeSocket()` / `send()` so they always
 * observe the *current* socket, never one closed over at module init.
 */

import type { ReconnectingSocket } from "@/services/wsTransport";
import type { WsOutboundMessage } from "@/types/wire";

/**
 * Single source of truth for the live transport handle. The ref lets
 * handlers always read the *current* socket instead of closing over
 * the socket they were created with (which may be stale after a fast
 * reconnect).
 */
export const transportRef: { current: ReconnectingSocket | null } = {
	current: null,
};

export function setTransportHandle(handle: ReconnectingSocket | null): void {
	transportRef.current = handle;
}

export function activeSocket(): WebSocket | null {
	const s = transportRef.current?.getSocket() ?? null;
	return s?.readyState === WebSocket.OPEN ? s : null;
}

export function sendRaw(socket: WebSocket, payload: WsOutboundMessage): void {
	socket.send(JSON.stringify(payload));
}

export function send(payload: WsOutboundMessage): boolean {
	const s = activeSocket();
	if (!s) return false;
	sendRaw(s, payload);
	return true;
}

// ─── Typed read-only requests ─────────────────────────────────────────

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
