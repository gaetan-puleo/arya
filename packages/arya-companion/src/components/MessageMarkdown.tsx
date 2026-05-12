import { Linking, StyleSheet, Text } from "react-native";
import Markdown from "react-native-markdown-display";
import { useTheme } from "@/theme/ThemeContext";
import CodeBlock from "./CodeBlock";

interface MessageMarkdownProps {
	text: string;
	color: string;
	fontSize?: number;
	lineHeight?: number;
}

/**
 * Markdown renderer for chat messages.
 *
 * Wraps `react-native-markdown-display` with a theme-matched stylesheet
 * and a `fence` rule override that delegates to our themed `CodeBlock`
 * (so syntax highlighting + the "copy code" button stay consistent
 * with the rest of the app).
 *
 * Handles the streaming-text edge case where the model has opened a
 * fenced block (```lang\n…) but hasn't emitted the closing fence yet:
 * we append a synthetic ``` so the parser can still render the block
 * progressively, mirroring the behaviour of the previous hand-rolled
 * `parseCodeBlocks` helper.
 */
export default function MessageMarkdown({
	text,
	color,
	fontSize = 15,
	lineHeight = 22,
}: MessageMarkdownProps) {
	const theme = useTheme();

	const safeText = closeOpenFence(text);

	const monoFamily = theme.fonts.mono;

	// Theme-matched stylesheet. Keys mirror the rule names used by
	// react-native-markdown-display (see lib/styles.js). We only set the
	// properties that diverge from the library defaults — text color +
	// spacing tuned to match the previous hand-rolled renderer.
	const styles = StyleSheet.create({
		body: {
			color,
			fontSize,
			lineHeight,
		},
		heading1: {
			fontSize: 20,
			fontWeight: "700",
			lineHeight: 28,
			color,
		},
		heading2: {
			fontSize: 17,
			fontWeight: "700",
			lineHeight: 25,
			color,
		},
		heading3: {
			fontSize: 16,
			fontWeight: "700",
			lineHeight: 24,
			color,
		},
		heading4: {
			fontSize: 15,
			fontWeight: "700",
			lineHeight: 23,
			color,
		},
		heading5: {
			fontSize: 15,
			fontWeight: "700",
			lineHeight: 23,
			color,
		},
		heading6: {
			fontSize: 15,
			fontWeight: "700",
			lineHeight: 23,
			color,
		},
		strong: { fontWeight: "700" },
		em: { fontStyle: "italic" },
		s: { textDecorationLine: "line-through" },
		link: { color: theme.colors.success, textDecorationLine: "underline" },
		blockquote: {
			backgroundColor: "transparent",
			borderLeftColor: theme.colors.border,
			borderLeftWidth: 3,
			marginLeft: 0,
			paddingLeft: 12,
		},
		bullet_list: { marginVertical: 4 },
		ordered_list: { marginVertical: 4 },
		// Inline code — pill background matches the previous "rgba grey"
		// look while staying themed.
		code_inline: {
			fontFamily: "SpaceMono",
			backgroundColor: "rgba(128,128,128,0.15)",
			fontSize: fontSize - 1,
			color,
			borderRadius: 4,
			paddingHorizontal: 4,
		},
		// `code_block` is for indented (4-space) blocks; the lib renders
		// it inside a <Text>. Keep it monospace; fenced blocks (the
		// common case) go through the `fence` rule override below.
		code_block: {
			fontFamily: monoFamily,
			backgroundColor: theme.colors.backgroundTertiary,
			color,
			fontSize: fontSize - 1,
			padding: 8,
			borderRadius: 8,
		},
		hr: {
			backgroundColor: theme.colors.border,
			height: StyleSheet.hairlineWidth,
			marginVertical: 8,
		},
		// Tables — match the row separator style the previous
		// `MarkdownTable` component used.
		table: {
			borderWidth: 1,
			borderColor: theme.colors.border,
			borderRadius: 6,
			marginVertical: 8,
		},
		thead: { backgroundColor: theme.colors.backgroundTertiary },
		tr: { borderBottomWidth: 1, borderColor: theme.colors.border },
		th: { padding: 8 },
		td: { padding: 8 },
		// Re-color paragraph text — the library's default doesn't
		// inherit `body.color` everywhere.
		paragraph: { color, marginTop: 0, marginBottom: 8 },
	});

	return (
		<Markdown
			style={styles}
			onLinkPress={(url) => {
				Linking.openURL(url).catch(() => {});
				return true;
			}}
			rules={{
				// Delegate fenced blocks to our themed CodeBlock so syntax
				// highlighting + the copy button stay consistent.
				fence: (node) => {
					const content = stripTrailingNewline(String(node.content ?? ""));
					// `sourceInfo` is set by the parser at runtime (carries
					// the fence's language hint) but isn't on the published
					// ASTNode type; read it through a narrow cast.
					const sourceInfo = (node as { sourceInfo?: unknown })
						.sourceInfo;
					const language =
						typeof sourceInfo === "string" && sourceInfo.trim()
							? sourceInfo.trim()
							: undefined;
					return (
						<CodeBlock
							key={node.key}
							code={content}
							language={language}
						/>
					);
				},
				// Wrap text nodes to ensure the body color is honoured —
				// the default rule emits a bare <Text> without merging the
				// `body` style.
				text: (node, _children, _parent, _styles, inheritedStyles = {}) => (
					<Text key={node.key} style={[{ color }, inheritedStyles]}>
						{node.content}
					</Text>
				),
			}}
		>
			{safeText}
		</Markdown>
	);
}

/**
 * If the input ends with an unclosed fenced code block (opening ```
 * without a matching close), append a synthetic closing fence so the
 * markdown parser still renders the block during streaming. Mirrors
 * the behaviour of the previous `parseCodeBlocks` helper.
 */
function closeOpenFence(text: string): string {
	// Count standalone ``` fence markers on their own line. If the
	// count is odd, we're mid-block — append a closer.
	const fenceCount = (text.match(/^```/gm) ?? []).length;
	if (fenceCount % 2 === 1) {
		return text.endsWith("\n") ? `${text}\`\`\`` : `${text}\n\`\`\``;
	}
	return text;
}

function stripTrailingNewline(s: string): string {
	return s.endsWith("\n") ? s.slice(0, -1) : s;
}
