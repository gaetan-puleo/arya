import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback } from "react";
import {
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	View,
} from "react-native";
import type { TextStyle } from "react-native";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/default-highlight";
import { atomOneDark } from "react-syntax-highlighter/dist/esm/styles/hljs";
import { useTheme } from "@/theme/ThemeContext";

interface CodeBlockProps {
	code: string;
	language?: string;
}

// ── Language alias map ────────────────────────────────────────────────
//
// highlight.js (via lowlight) registers languages under their canonical
// names (e.g. `javascript`, `typescript`, `python`). Markdown fences
// commonly use short aliases (`js`, `ts`, `py`). Map them to canonical
// names so highlighting works reliably; unknown languages fall back to
// `highlightAuto` upstream.
const LANGUAGE_ALIASES: Record<string, string> = {
	js: "javascript",
	jsx: "javascript",
	ts: "typescript",
	tsx: "typescript",
	py: "python",
	rb: "ruby",
	sh: "bash",
	zsh: "bash",
	yml: "yaml",
	md: "markdown",
	"c++": "cpp",
	cs: "csharp",
	kt: "kotlin",
	rs: "rust",
	htm: "xml",
	html: "xml",
	svg: "xml",
	plain: "plaintext",
	text: "plaintext",
	txt: "plaintext",
};

function resolveLanguage(input?: string): string {
	const lang = input?.trim().toLowerCase();
	if (!lang) return "plaintext";
	return LANGUAGE_ALIASES[lang] ?? lang;
}

// ── hast → React Native renderer ───────────────────────────────────────
//
// react-syntax-highlighter's default `createElement` emits web tags like
// `<span>` / `<code>` which RN cannot render (causing the "ViewConfig
// getter callback for component span" error). We replace the renderer
// with one that produces nested `<Text>` elements and looks up styles
// from the hljs stylesheet via class names.

type HastTextNode = { type: "text"; value: string };
type HastElementNode = {
	type: "element";
	tagName: string;
	properties?: { className?: string[]; style?: TextStyle };
	children: HastNode[];
};
type HastNode = HastTextNode | HastElementNode;

function resolveStyleFromClassNames(
	classNames: string[] | undefined,
	stylesheet: Record<string, TextStyle>,
): TextStyle | undefined {
	if (!classNames || classNames.length === 0) return undefined;
	const merged: TextStyle = {};
	for (const cn of classNames) {
		const s = stylesheet[cn];
		if (s) Object.assign(merged, s);
	}
	return Object.keys(merged).length > 0 ? merged : undefined;
}

function renderNode(
	node: HastNode,
	stylesheet: Record<string, TextStyle>,
	key: string,
): React.ReactNode {
	if (node.type === "text") {
		return node.value;
	}
	const style = resolveStyleFromClassNames(
		node.properties?.className,
		stylesheet,
	);
	const inlineStyle = node.properties?.style;
	const children = node.children.map((child, i) =>
		renderNode(child, stylesheet, `${key}-${i}`),
	);
	return (
		<Text key={key} style={[style, inlineStyle]}>
			{children}
		</Text>
	);
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
	const theme = useTheme();

	const rawLang = language?.trim() || "text";
	const displayLang = rawLang.charAt(0).toUpperCase() + rawLang.slice(1);
	const highlightLang = resolveLanguage(language);

	const handleCopy = useCallback(async () => {
		try {
			await Clipboard.setStringAsync(code);
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		} catch {
			// noop
		}
	}, [code]);

	const grayBg = "#2A2A2A";
	const stylesheet = atomOneDark as Record<string, TextStyle>;

	const baseTextStyle: TextStyle = {
		color: theme.colors.text,
		fontFamily: theme.fonts.mono,
		fontSize: theme.fontSizes.sm,
	};

	// Custom renderer: receives `{ rows, stylesheet, useInlineStyles }`.
	const renderer = useCallback(
		({ rows }: { rows: HastNode[] }) =>
			rows.map((row, i) => renderNode(row, stylesheet, `row-${i}`)),
		[stylesheet],
	);

	// Replace web tags with RN-safe wrappers.
	const PreTag = useCallback(
		({ children }: { children?: React.ReactNode }) => (
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.preContent}
			>
				<View>{children}</View>
			</ScrollView>
		),
		[],
	);

	const CodeTag = useCallback(
		({ children }: { children?: React.ReactNode }) => (
			<Text style={baseTextStyle}>{children}</Text>
		),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[theme.colors.text, theme.fonts.mono, theme.fontSizes.sm],
	);

	return (
		<View
			className="self-stretch my-4 rounded-card overflow-hidden"
			style={{ backgroundColor: grayBg }}
		>
			{/* Header */}
			<View
				className="flex-row items-center justify-between pl-3 pr-2 py-1"
				style={{ backgroundColor: grayBg }}
			>
				<Text
					className="text-sm font-medium text-white font-mono"
				>
					{displayLang}
				</Text>

				<Pressable
					onPress={handleCopy}
					hitSlop={8}
					className="w-8 h-8 items-center justify-center rounded-full active:opacity-85"
				>
					<Ionicons
						name="copy-outline"
						size={20}
						color={theme.colors.textSecondary}
					/>
				</Pressable>
			</View>

			{/* Code */}
			<View className="p-3">
				<SyntaxHighlighter
					language={highlightLang}
					style={stylesheet as never}
					customStyle={{ margin: 0, padding: 0, backgroundColor: grayBg }}
					PreTag={PreTag as never}
					CodeTag={CodeTag as never}
					renderer={renderer as never}
				>
					{code}
				</SyntaxHighlighter>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	preContent: {
		flexGrow: 1,
	},
});
