/**
 * Wire-shape types for persisted sessions exchanged with the arya
 * server.
 *
 * The server emits mu-core `ChatMessage[]` directly inside
 * `sessions:history` payloads AND inline in `synthetic_message` events.
 * The companion projects them to `MessageDisplayRow` at render time via
 * `mu-core/client`'s `projectMessage`. This file owns only the wire
 * envelope types — projection lives in mu-core.
 */

import { projectMessage } from "mu-core/client";
import type { ChatMessage, MessageDisplayRow } from "mu-core/client";

/** Re-export the canonical message shape; aliases the prior name. */
export type ChatMessageWire = ChatMessage;

/** Re-export the projected row shape under the legacy name. */
export type PersistedMessage = MessageDisplayRow;

export interface PersistedSessionWire {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessageWire[];
}

export interface PersistedSession {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: PersistedMessage[];
}

/** Project a wire ChatMessage into the flat display row. */
export function chatMessageWireToPersisted(
	msg: ChatMessageWire,
	index: number,
): PersistedMessage {
	return projectMessage(msg, index);
}

export function persistedSessionFromWire(
	session: PersistedSessionWire,
): PersistedSession {
	return {
		version: session.version,
		id: session.id,
		title: session.title,
		createdAt: session.createdAt,
		updatedAt: session.updatedAt,
		messages: session.messages.map((m, i) => projectMessage(m, i)),
	};
}
