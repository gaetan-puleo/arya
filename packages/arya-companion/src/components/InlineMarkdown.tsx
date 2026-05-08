import { Linking, Text, type TextStyle } from "react-native";

/**
 * Inline markdown renderer.
 *
 * Supports:
 * - **bold**
 * - *italic*
 * - `inline code`
 * - [links](url)
 * - bullet lists (- item)
 * - numbered lists (1. item)
 * - headings (# / ## / ###)
 */

interface InlineMarkdownProps {
  text: string;
  color: string;
  fontSize?: number;
  lineHeight?: number;
}

// Inline token types
type InlineToken =
  | { type: "text"; content: string }
  | { type: "bold"; content: string }
  | { type: "italic"; content: string }
  | { type: "code"; content: string }
  | { type: "link"; label: string; url: string };

// Regex for inline markdown tokens (order matters: bold before italic)
const INLINE_RE =
  /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+?)`)|(\[([^\]]+?)\]\(([^)]+?)\))/g;

function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(INLINE_RE)) {
    const index = match.index!;
    if (index > lastIndex) {
      tokens.push({ type: "text", content: text.slice(lastIndex, index) });
    }

    if (match[2]) {
      tokens.push({ type: "bold", content: match[2] });
    } else if (match[4]) {
      tokens.push({ type: "italic", content: match[4] });
    } else if (match[6]) {
      tokens.push({ type: "code", content: match[6] });
    } else if (match[8] && match[9]) {
      tokens.push({ type: "link", label: match[8], url: match[9] });
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push({ type: "text", content: text.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ type: "text", content: text }];
}

// Heading regex: # at start of line
const HEADING_RE = /^(#{1,3})\s+(.+)$/;
const LIST_BULLET_RE = /^[-*]\s+(.+)$/;
const LIST_NUMBERED_RE = /^\d+\.\s+(.+)$/;

export default function InlineMarkdown({
  text,
  color,
  fontSize = 15,
  lineHeight = 22,
}: InlineMarkdownProps) {
  const baseStyle: TextStyle = { fontSize, lineHeight, color };
  const lines = text.split("\n");

  return (
    <Text style={baseStyle}>
      {lines.map((line, li) => {
        const isLast = li === lines.length - 1;

        // Heading
        const headingMatch = line.match(HEADING_RE);
        if (headingMatch) {
          const level = headingMatch[1].length;
          const headingSize = level === 1 ? 20 : level === 2 ? 17 : 15;
          return (
            <Text key={li}>
              <Text
                style={{
                  fontSize: headingSize,
                  fontWeight: "700",
                  lineHeight: headingSize + 8,
                  color,
                }}
              >
                {headingMatch[2]}
              </Text>
              {!isLast && "\n"}
            </Text>
          );
        }

        // Bullet list
        const bulletMatch = line.match(LIST_BULLET_RE);
        if (bulletMatch) {
          return (
            <Text key={li}>
              <Text style={baseStyle}>{"  •  "}</Text>
              <RenderInline tokens={parseInline(bulletMatch[1])} baseStyle={baseStyle} color={color} />
              {!isLast && "\n"}
            </Text>
          );
        }

        // Numbered list
        const numberedMatch = line.match(LIST_NUMBERED_RE);
        if (numberedMatch) {
          const num = line.match(/^(\d+)\./)?.[1] ?? "";
          return (
            <Text key={li}>
              <Text style={baseStyle}>{`  ${num}.  `}</Text>
              <RenderInline tokens={parseInline(numberedMatch[1])} baseStyle={baseStyle} color={color} />
              {!isLast && "\n"}
            </Text>
          );
        }

        // Regular line with inline formatting
        return (
          <Text key={li}>
            <RenderInline tokens={parseInline(line)} baseStyle={baseStyle} color={color} />
            {!isLast && "\n"}
          </Text>
        );
      })}
    </Text>
  );
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
                style={[baseStyle, { color: "#10A37F", textDecorationLine: "underline" }]}
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
