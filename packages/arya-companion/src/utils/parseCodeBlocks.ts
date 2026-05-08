export type TextSegment = { type: "text"; content: string };
export type CodeSegment = {
	type: "code";
	content: string;
	language?: string;
};
export type Segment = TextSegment | CodeSegment;

const CODE_BLOCK_REGEX = /```(\w*)\n?([\s\S]*?)```/g;

/**
 * Split a message string into text and fenced-code-block segments.
 *
 * Unmatched opening fences (e.g. during streaming) are left as plain text
 * so incomplete blocks don't break the UI.
 */
export function parseCodeBlocks(text: string): Segment[] {
	const segments: Segment[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(CODE_BLOCK_REGEX)) {
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

	// Remaining text after the last block (trim leading newlines)
	if (lastIndex < text.length) {
		const after = text.slice(lastIndex).replace(/^\n+/, "");
		if (after) {
			segments.push({ type: "text", content: after });
		}
	}

	return segments.length > 0
		? segments
		: [{ type: "text", content: text }];
}
