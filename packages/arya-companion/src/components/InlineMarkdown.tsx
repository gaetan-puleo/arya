import { Linking, Text, View, type TextStyle } from "react-native";
import MarkdownTable, {
	type MarkdownTableData,
} from "@/components/MarkdownTable";

/**
 * Inline + block markdown renderer.
 *
 * Supports inline:
 * - **bold**, *italic*, ~~strikethrough~~, `inline code`
 * - [links](url)
 *
 * Supports block:
 * - headings (# / ## / ### / #### / ##### / ######)
 * - bullet lists (- item / * item)
 * - numbered lists (1. item)
 * - blockquotes (> ...)
 * - horizontal rule (---, ___, ***)
 * - tables (GFM):
 *     | A | B |
 *     |---|:--:|
 *     | 1 | 2 |
 */

interface InlineMarkdownProps {
	text: string;
	color: string;
	fontSize?: number;
	lineHeight?: number;
}

// ── Inline tokens ──────────────────────────────────────────────────────

type InlineToken =
	| { type: "text"; content: string }
	| { type: "bold"; content: string }
	| { type: "italic"; content: string }
	| { type: "strike"; content: string }
	| { type: "code"; content: string }
	| { type: "link"; label: string; url: string };

// Order matters: bold (**) before italic (*); strikethrough (~~) before others.
const INLINE_RE =
	/(\*\*(.+?)\*\*)|(~~(.+?)~~)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))/g;

function parseInline(text: string): InlineToken[] {
	const tokens: InlineToken[] = [];
	let lastIndex = 0;

	for (const match of text.matchAll(INLINE_RE)) {
		const index = match.index!;
		if (index > lastIndex) {
			tokens.push({ type: "text", content: text.slice(lastIndex, index) });
		}

		if (match[2] !== undefined) {
			tokens.push({ type: "bold", content: match[2] });
		} else if (match[4] !== undefined) {
			tokens.push({ type: "strike", content: match[4] });
		} else if (match[6] !== undefined) {
			tokens.push({ type: "italic", content: match[6] });
		} else if (match[8] !== undefined) {
			tokens.push({ type: "code", content: match[8] });
		} else if (match[10] !== undefined && match[11] !== undefined) {
			tokens.push({ type: "link", label: match[10], url: match[11] });
		}

		lastIndex = index + match[0].length;
	}

	if (lastIndex < text.length) {
		tokens.push({ type: "text", content: text.slice(lastIndex) });
	}

	return tokens.length > 0 ? tokens : [{ type: "text", content: text }];
}

// ── Block parsing ─────────────────────────────────────────────────────

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const LIST_BULLET_RE = /^[-*]\s+(.+)$/;
const LIST_NUMBERED_RE = /^(\d+)\.\s+(.+)$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const HR_RE = /^(?:-{3,}|_{3,}|\*{3,})\s*$/;
// Table rows: must contain at least one non-edge pipe.
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
// Table separator: |---|:---:|---:| etc.
const TABLE_SEP_RE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;

type Block =
	| { type: "heading"; level: number; text: string }
	| { type: "bullet"; text: string }
	| { type: "numbered"; num: string; text: string }
	| { type: "blockquote"; text: string }
	| { type: "hr" }
	| { type: "paragraph"; text: string }
	| { type: "table"; data: MarkdownTableData };

function splitTableRow(line: string): string[] {
	// Strip leading/trailing pipe (and surrounding whitespace) then split on |.
	let trimmed = line.trim();
	if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
	if (trimmed.endsWith("|")) trimmed = trimmed.slice(0, -1);
	return trimmed.split("|").map((c) => c.trim());
}

function parseAlignments(sepLine: string): ("left" | "center" | "right")[] {
	return splitTableRow(sepLine).map((cell) => {
		const c = cell.trim();
		const left = c.startsWith(":");
		const right = c.endsWith(":");
		if (left && right) return "center";
		if (right) return "right";
		return "left";
	});
}

function parseBlocks(text: string): Block[] {
	const lines = text.split("\n");
	const blocks: Block[] = [];

	let i = 0;
	while (i < lines.length) {
		const line = lines[i];

		// Tables: header line + separator + 0..N body rows.
		// Require at least header + separator to commit (streaming-safe).
		if (
			TABLE_ROW_RE.test(line) &&
			i + 1 < lines.length &&
			TABLE_SEP_RE.test(lines[i + 1])
		) {
			const headers = splitTableRow(line);
			const alignments = parseAlignments(lines[i + 1]);
			const rows: string[][] = [];
			let j = i + 2;
			while (j < lines.length && TABLE_ROW_RE.test(lines[j])) {
				rows.push(splitTableRow(lines[j]));
				j++;
			}
			blocks.push({
				type: "table",
				data: { headers, alignments, rows },
			});
			i = j;
			continue;
		}

		// Heading
		const heading = line.match(HEADING_RE);
		if (heading) {
			blocks.push({
				type: "heading",
				level: Math.min(6, heading[1].length),
				text: heading[2],
			});
			i++;
			continue;
		}

		// HR
		if (HR_RE.test(line)) {
			blocks.push({ type: "hr" });
			i++;
			continue;
		}

		// Bullet
		const bullet = line.match(LIST_BULLET_RE);
		if (bullet) {
			blocks.push({ type: "bullet", text: bullet[1] });
			i++;
			continue;
		}

		// Numbered
		const numbered = line.match(LIST_NUMBERED_RE);
		if (numbered) {
			blocks.push({ type: "numbered", num: numbered[1], text: numbered[2] });
			i++;
			continue;
		}

		// Blockquote
		const bq = line.match(BLOCKQUOTE_RE);
		if (bq) {
			blocks.push({ type: "blockquote", text: bq[1] });
			i++;
			continue;
		}

		// Paragraph (single line; preserve blank lines as empty paragraphs).
		blocks.push({ type: "paragraph", text: line });
		i++;
	}

	return blocks;
}

// ── Renderer ──────────────────────────────────────────────────────────

export default function InlineMarkdown({
	text,
	color,
	fontSize = 15,
	lineHeight = 22,
}: InlineMarkdownProps) {
	const baseStyle: TextStyle = { fontSize, lineHeight, color };
	const blocks = parseBlocks(text);

	// Group consecutive non-block elements (headings/lists/paragraphs/quotes/hr)
	// inside a single <Text> for tight wrapping. Tables break out of <Text>
	// because they need <View>-based layout.
	const out: React.ReactNode[] = [];
	let textRun: Block[] = [];
	let runKey = 0;

	const flushTextRun = () => {
		if (textRun.length === 0) return;
		const run = textRun;
		textRun = [];
		out.push(
			<Text key={`run-${runKey++}`} style={baseStyle}>
				{run.map((b, bi) => renderTextBlock(b, bi, run.length, baseStyle, color))}
			</Text>,
		);
	};

	for (const b of blocks) {
		if (b.type === "table") {
			flushTextRun();
			out.push(
				<MarkdownTable
					key={`table-${out.length}`}
					table={b.data}
					textColor={color}
					fontSize={fontSize - 1}
				/>,
			);
		} else {
			textRun.push(b);
		}
	}
	flushTextRun();

	return <View>{out}</View>;
}

function renderTextBlock(
	block: Block,
	index: number,
	total: number,
	baseStyle: TextStyle,
	color: string,
): React.ReactNode {
	const isLast = index === total - 1;
	const trail = isLast ? "" : "\n";

	switch (block.type) {
		case "heading": {
			const headingSize =
				block.level === 1
					? 20
					: block.level === 2
						? 17
						: block.level === 3
							? 16
							: 15;
			return (
				<Text key={index}>
					<Text
						style={{
							fontSize: headingSize,
							fontWeight: "700",
							lineHeight: headingSize + 8,
							color,
						}}
					>
						{block.text}
					</Text>
					{trail}
				</Text>
			);
		}

		case "bullet":
			return (
				<Text key={index}>
					<Text style={baseStyle}>{"  •  "}</Text>
					<RenderInline
						tokens={parseInline(block.text)}
						baseStyle={baseStyle}
						color={color}
					/>
					{trail}
				</Text>
			);

		case "numbered":
			return (
				<Text key={index}>
					<Text style={baseStyle}>{`  ${block.num}.  `}</Text>
					<RenderInline
						tokens={parseInline(block.text)}
						baseStyle={baseStyle}
						color={color}
					/>
					{trail}
				</Text>
			);

		case "blockquote":
			return (
				<Text key={index}>
					<Text
						style={[
							baseStyle,
							{
								color: blendForQuote(color),
								fontStyle: "italic",
							},
						]}
					>
						{"  ▎ "}
					</Text>
					<RenderInline
						tokens={parseInline(block.text)}
						baseStyle={{
							...baseStyle,
							color: blendForQuote(color),
							fontStyle: "italic",
						}}
						color={blendForQuote(color)}
					/>
					{trail}
				</Text>
			);

		case "hr":
			return (
				<Text key={index}>
					<Text style={[baseStyle, { color: blendForQuote(color) }]}>
						{"─────────────"}
					</Text>
					{trail}
				</Text>
			);

		case "paragraph":
		default: {
			const paragraph = block as Extract<Block, { type: "paragraph" }>;
			return (
				<Text key={index}>
					<RenderInline
						tokens={parseInline(paragraph.text)}
						baseStyle={baseStyle}
						color={color}
					/>
					{trail}
				</Text>
			);
		}
	}
}

/** Soft variant of the foreground color for muted elements (quotes/HRs). */
function blendForQuote(color: string): string {
	// Cheap fade: accept hex; ignore unknown formats and return as-is.
	if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
	const r = parseInt(color.slice(1, 3), 16);
	const g = parseInt(color.slice(3, 5), 16);
	const b = parseInt(color.slice(5, 7), 16);
	const fade = (c: number) => Math.round(c * 0.7);
	return `rgb(${fade(r)},${fade(g)},${fade(b)})`;
}

function RenderInline({
	tokens,
	baseStyle,
	color,
}: {
	tokens: InlineToken[];
	baseStyle: TextStyle;
	color: string;
}) {
	return (
		<>
			{tokens.map((token, i) => {
				switch (token.type) {
					case "bold":
						return (
							<Text key={i} style={[baseStyle, { fontWeight: "700" }]}>
								{token.content}
							</Text>
						);
					case "italic":
						return (
							<Text key={i} style={[baseStyle, { fontStyle: "italic" }]}>
								{token.content}
							</Text>
						);
					case "strike":
						return (
							<Text
								key={i}
								style={[
									baseStyle,
									{ textDecorationLine: "line-through" },
								]}
							>
								{token.content}
							</Text>
						);
					case "code":
						return (
							<Text
								key={i}
								style={[
									baseStyle,
									{
										fontFamily: "SpaceMono",
										backgroundColor: "rgba(128,128,128,0.15)",
										fontSize: baseStyle.fontSize ? baseStyle.fontSize - 1 : 14,
									},
								]}
							>
								{` ${token.content} `}
							</Text>
						);
					case "link":
						return (
							<Text
								key={i}
								style={[
									baseStyle,
									{ color: "#10A37F", textDecorationLine: "underline" },
								]}
								onPress={() => Linking.openURL(token.url)}
							>
								{token.label}
							</Text>
						);
					default:
						return (
							<Text key={i} style={baseStyle}>
								{token.content}
							</Text>
						);
				}
			})}
		</>
	);
}
