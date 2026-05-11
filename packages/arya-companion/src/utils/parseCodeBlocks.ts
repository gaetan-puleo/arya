type TextSegment = { type: "text"; content: string };
type CodeSegment = {
	type: "code";
	content: string;
	language?: string;
};
export type Segment = TextSegment | CodeSegment;

// Closed fenced block: ```lang\n...```
const CLOSED_CODE_BLOCK_REGEX = /```(\w*)\n?([\s\S]*?)```/g;

// Opening fence at end-of-string (no closing ```): ```lang\n...
//
// Used during streaming so the code block can be rendered as soon as
// the opening fence is detected, before the model emits the closing
// fence. Captures:
//   1: language (optional)
//   2: code content (everything after the optional newline)
const OPEN_FENCE_TAIL_REGEX = /```(\w*)(?:\n([\s\S]*))?$/;

/**
 * Split a message string into text and fenced-code-block segments.
 *
 * - Closed fenced blocks (```lang\n...```) are matched normally.
 * - An unclosed opening fence at the very end of the input (typical
 *   during streaming) is also emitted as a `code` segment so the
 *   highlighted block appears immediately, without waiting for the
 *   closing ```. The closing fence, when it arrives, is handled on
 *   the next call by the closed-block branch.
 */
export function parseCodeBlocks(text: string): Segment[] {
	const segments: Segment[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(CLOSED_CODE_BLOCK_REGEX)) {
		const [fullMatch, language, code] = match;
		const index = match.index!;

		// Text before the code block (trim surrounding newlines)
		if (index > lastIndex) {
			const raw = text.slice(lastIndex, index);
			const trimmed = (lastIndex === 0 ? raw : raw.replace(/^\n+/, "")).replace(/\n+$/, "");
			if (trimmed) {
				segments.push({ type: "text", content: trimmed });
			}
		}

		segments.push({
			type: "code",
			content: code.trimEnd(),
			language: language || undefined,
		});

		lastIndex = index + fullMatch.length;
	}

	// Remaining tail after the last closed block (or the whole string if no
	// closed block matched). Look for an unclosed opening fence inside it.
	if (lastIndex < text.length) {
		const tail = text.slice(lastIndex);
		const openMatch = tail.match(OPEN_FENCE_TAIL_REGEX);

		if (openMatch && openMatch.index !== undefined) {
			// Text before the unclosed fence
			const before = tail.slice(0, openMatch.index).replace(/^\n+/, "").replace(/\n+$/, "");
			if (before) {
				segments.push({ type: "text", content: before });
			}

			const [, language, code] = openMatch;
			segments.push({
				type: "code",
				content: (code ?? "").replace(/\n$/, ""),
				language: language || undefined,
			});
		} else {
			const after = tail.replace(/^\n+/, "");
			if (after) {
				segments.push({ type: "text", content: after });
			}
		}
	}

	return segments.length > 0
		? segments
		: [{ type: "text", content: text }];
}
