import { Platform } from "react-native";
import { SizableText, YStack } from "tamagui";
import CodeHighlighter from "react-native-code-highlighter";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";

interface CodeBlockProps {
	code: string;
	language?: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
	return (
		<YStack borderRadius={5} overflow="hidden" marginVertical={8}>
			{/* Highlighted code */}
			<CodeHighlighter
				hljsStyle={vs2015}
				language={language || "text"}
				textStyle={{
					fontFamily:
						Platform.OS === "ios" ? "Menlo-Regular" : "monospace",
					fontSize: 13,
				}}
				scrollViewProps={{
					contentContainerStyle: {
						padding: 8,
						paddingTop: language ? 24 : 8,
						minWidth: "100%",
					},
				}}
			>
				{code}
			</CodeHighlighter>

			{/* Language label — floating top-right */}
			{language ? (
				<SizableText
					fontSize={10}
					color="#666"
					fontWeight="400"
					position="absolute"
					top={6}
					left={8}
				>
					{language}
				</SizableText>
			) : null}
		</YStack>
	);
}
