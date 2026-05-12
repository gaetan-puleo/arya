/**
 * Server wire ↔ companion display conversion for persisted sessions.
 *
 * The server emits mu-core `ChatMessage[]` directly inside
 * `sessions:history` payloads; the companion derives flat display
 * rows (text, toolName, agentId, …) from them at render time.
 */

/**
 * Mirror of mu-core's `ChatMessage`. The server emits these directly in
 * `sessions:history` payloads; the companion derives display fields
 * (text, toolName, agentId, …) from them at render time.
 */
interface ChatMessageWire {
	role: "user" | "assistant" | "system" | "tool";
	content: string;
	reasoning?: string;
	toolCallId?: string;
	toolResult?: {
		name: string;
		content: string;
		error?: boolean;
	};
	toolCallArgs?: Record<string, string>;
	meta?: Record<string, unknown>;
	customType?: string;
}

/**
 * Display-shaped row used by the chat UI. Derived from `ChatMessageWire`
 * via `chatMessageWireToPersisted`. Keeps the same field names the rest
 * of the companion has consumed historically so the rendering layer is
 * unchanged.
 */
interface PersistedMessage {
	id: string;
	role: "user" | "assistant" | "tool";
	text: string;
	ts: number;
	agentId?: string;
	toolName?: string;
	toolArgs?: string;
	toolResult?: string;
	toolError?: boolean;
}

export interface PersistedSessionWire {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: ChatMessageWire[];
}

interface PersistedSession {
	version: 1;
	id: string;
	title: string;
	createdAt: number;
	updatedAt: number;
	messages: PersistedMessage[];
}

function readMetaString(
	meta: Record<string, unknown> | undefined,
	key: string,
): string | undefined {
	if (!meta) return undefined;
	const v = meta[key];
	return typeof v === "string" ? v : undefined;
}

function readMetaNumber(
	meta: Record<string, unknown> | undefined,
	key: string,
	fallback: number,
): number {
	if (!meta) return fallback;
	const v = meta[key];
	return typeof v === "number" ? v : fallback;
}

/**
 * Map a mu-core ChatMessage (as serialised by the server) to the flat
 * `PersistedMessage` row the chat UI knows how to render.
 *
 * - `content` → `text` for user/assistant/tool.
 * - `toolResult.name/content/error` → `toolName/toolResult/toolError`.
 * - `meta.agentId` → `agentId`.
 * - `meta.id`/`meta.ts` → row id and timestamp (synthesised when missing
 *   so legacy / minimal messages still render).
 * - Tool args we pretty-print from `toolCallArgs` when present so the
 *   Approval widget keeps showing JSON; mu-coding messages carry the
 *   same data via `toolCallArgs`.
 */
function chatMessageWireToPersisted(
	msg: ChatMessageWire,
	index: number,
): PersistedMessage {
	const meta = msg.meta;
	// Role narrowing: `system` messages are kept out of the visible
	// transcript by the server, but be defensive — treat them as assistant.
	const role: PersistedMessage["role"] =
		msg.role === "system" ? "assistant" : msg.role;
	const text = msg.role === "tool" ? "" : msg.content;
	const toolName = msg.toolResult?.name;
	const toolResultContent = msg.toolResult?.content;
	const toolError = msg.toolResult?.error === true;
	const metaToolArgs = readMetaString(meta, "toolArgs");
	const toolArgs =
		metaToolArgs ??
		(msg.toolCallArgs ? JSON.stringify(msg.toolCallArgs, null, 2) : undefined);
	const id = readMetaString(meta, "id") ?? msg.toolCallId ?? `m-${index}`;
	const ts = readMetaNumber(meta, "ts", 0);
	const agentId = readMetaString(meta, "agentId");
	return {
		id,
		role,
		text,
		ts,
		agentId,
		toolName,
		toolArgs,
		toolResult: toolResultContent,
		toolError,
	};
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
		messages: session.messages.map((m, i) => chatMessageWireToPersisted(m, i)),
	};
}
