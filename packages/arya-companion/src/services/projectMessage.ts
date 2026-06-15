/**
 * THE single wire→domain validation gate.
 *
 *   1. `isValidWireMessage` — type guard. Rejects anything that
 *      doesn't satisfy the `WireMessage` schema at runtime. Legacy
 *      session-header records (no `role`) get filtered out here.
 *   2. `isVisibleWireMessage` — what should land in the main
 *      transcript. Drops tool rows, transient rows, LLM-only rows.
 *      System rows pass only with explicit `visibility: "ui"` (so
 *      arya's `/agents` output shows; raw LLM system prompts don't).
 *   3. `projectMessage` — field-copy projection. Assumes a validated
 *      input; no fallbacks, no coercion.
 *   4. `wireSessionToRows` — composes the three above into the only
 *      function callers need: WireMessage[] → ChatMessageItem[].
 *
 * Downstream code trusts every field is its declared type. No more
 * `?? ""` sprinkles, no defensive null checks.
 */

import type { ChatMessageItem } from "@/types/domain";
import type { WireMessage, WireRole } from "@/types/wire";

const VALID_ROLES: ReadonlySet<WireRole> = new Set<WireRole>([
	"user",
	"assistant",
	"system",
	"tool",
]);

/**
 * Runtime guard. Empty `content: ""` is accepted (it's a valid value);
 * UI-empty rows get filtered later by `wireSessionToRows`.
 */
export function isValidWireMessage(x: unknown): x is WireMessage {
	if (!x || typeof x !== "object") return false;
	const m = x as Partial<WireMessage>;
	return (
		typeof m.id === "string" &&
		typeof m.ts === "number" &&
		typeof m.role === "string" &&
		VALID_ROLES.has(m.role as WireRole) &&
		typeof m.content === "string"
	);
}

/**
 * Visibility filter for the main transcript. Tool rows are surfaced
 * via approval / sub-agent cards, not the transcript. System rows
 * render only when explicitly marked UI-targeted (e.g. arya's
 * `/agents` command output).
 */
export function isVisibleWireMessage(m: WireMessage): boolean {
	if (m.meta?.transient) return false;
	if (m.meta?.visibility === "llm") return false;
	if (m.role === "tool") return false;
	if (m.role === "system") return m.meta?.visibility === "ui";
	return true;
}

/**
 * UI-empty filter. After projection, an assistant row with empty
 * content offers nothing to render — drop it.
 */
function isUIEmpty(m: WireMessage): boolean {
	return m.content.trim().length === 0 && !(m.attachments && m.attachments.length > 0);
}

/**
 * Field-copy projection. Assumes input has been narrowed by
 * `isValidWireMessage` and `isVisibleWireMessage`.
 *
 * Author attribution rules:
 *   - User rows: no author (the user is not an agent).
 *   - Assistant rows: prefer `meta.source` (when the server stamps which
 *     agent produced the message); only fall back to `streamingAgentId`
 *     when the row is a live stream — historical rows from past sessions
 *     stay unattributed rather than incorrectly inherit the currently-
 *     active agent.
 */
// Strip ANSI SGR codes — server-side commands (e.g. /context) colour their output
// for the terminal; in the RN UI those escape sequences would render as garbage.
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the ESC control char is the point
const ANSI_RE = /\x1b\[[0-9;]*m/g;
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");

export function wireToChatRow(
	m: WireMessage,
	streamingAgentId: string | null,
	isStreaming = false,
): ChatMessageItem {
	const authorFromMeta = m.meta?.source;
	const authorAgentId = authorFromMeta
		? authorFromMeta
		: isStreaming
			? (streamingAgentId ?? undefined)
			: undefined;
	return {
		id: m.id,
		// system → assistant coercion is local to the transcript view.
		role: m.role === "system" ? "assistant" : (m.role as "user" | "assistant"),
		text: stripAnsi(m.content),
		authorAgentId,
		...(m.attachments && m.attachments.length > 0 ? { attachments: m.attachments } : {}),
	};
}

/**
 * The one function every caller uses to convert server-provided
 * messages into the transcript rows the UI renders.
 *
 * Historical messages do NOT carry the currently-active agent as their
 * author — that produced the misattribution bug where every prior assistant
 * row in an old session re-rendered with the user's CURRENT agent badge.
 */
export function wireSessionToRows(
	messages: readonly unknown[],
	_streamingAgentId: string | null,
): ChatMessageItem[] {
	const out: ChatMessageItem[] = [];
	for (const raw of messages) {
		if (!isValidWireMessage(raw)) continue;
		if (!isVisibleWireMessage(raw)) continue;
		if (isUIEmpty(raw)) continue;
		// Pass `null` and `isStreaming=false` so historical rows fall through
		// to "no attribution" unless the server stamped `meta.source`.
		out.push(wireToChatRow(raw, null, false));
	}
	return out;
}
