import { Linking, StyleSheet, Text } from "react-native";
import Markdown from "react-native-markdown-display";

import { useTheme } from "@/theme/ThemeContext";
import CodeBlock from "@/components/markdown/CodeBlock";

interface MessageMarkdownProps {
	text: string;
	color: string;
	fontSize?: number;
	lineHeight?: number;
}

/**
 * Markdown renderer for chat messages. Wraps `react-native-markdown-display`
 * with a theme-matched stylesheet and a `fence` rule override that
 * delegates to our themed `CodeBlock`.
 *
 * The streaming-text edge case (fenced block opened but not yet
 * closed) is patched by `closeOpenFence` so the parser can render
 * progressively.
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

	const styles = StyleSheet.create({
		body: { color, fontSize, lineHeight },
		heading1: { fontSize: 20, fontWeight: "700", lineHeight: 28, color },
		heading2: { fontSize: 17, fontWeight: "700", lineHeight: 25, color },
		heading3: { fontSize: 16, fontWeight: "700", lineHeight: 24, color },
		heading4: { fontSize: 15, fontWeight: "700", lineHeight: 23, color },
		heading5: { fontSize: 15, fontWeight: "700", lineHeight: 23, color },
		heading6: { fontSize: 15, fontWeight: "700", lineHeight: 23, color },
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
		code_inline: {
			fontFamily: "SpaceMono",
			backgroundColor: "rgba(128,128,128,0.15)",
			fontSize: fontSize - 1,
			color,
			borderRadius: 4,
			paddingHorizontal: 4,
		},
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
				fence: (node) => {
					const content = stripTrailingNewline(
						String(node.content ?? ""),
					);
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
				text: (
					node,
					_children,
					_parent,
					_styles,
					inheritedStyles = {},
				) => (
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

function closeOpenFence(text: string): string {
	const fenceCount = (text.match(/^```/gm) ?? []).length;
	if (fenceCount % 2 === 1) {
		return text.endsWith("\n") ? `${text}\`\`\`` : `${text}\n\`\`\``;
	}
	return text;
}

function stripTrailingNewline(s: string): string {
	return s.endsWith("\n") ? s.slice(0, -1) : s;
}
