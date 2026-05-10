import { Platform, View, Text } from "react-native";
import SyntaxHighlighter from "react-syntax-highlighter/dist/esm/light";
import { vs2015 } from "react-syntax-highlighter/dist/esm/styles/hljs";

interface CodeBlockProps {
	code: string;
	language?: string;
}

export default function CodeBlock({ code, language }: CodeBlockProps) {
	return (
		<View style={{ borderRadius: 5, overflow: "hidden", marginVertical: 8 }}>
			<SyntaxHighlighter
				language={language || "text"}
				style={vs2015}
				customStyle={{
					margin: 0,
					padding: 8,
					paddingTop: language ? 24 : 8,
					fontSize: 13,
					fontFamily: Platform.OS === "ios" ? "Menlo-Regular" : "monospace",
				}}
				showLineNumbers
			>
				{code}
			</SyntaxHighlighter>

			{language ? (
				<Text
					style={{
						fontSize: 10,
						color: "#666",
						fontWeight: "400",
						position: "absolute",
						top: 6,
						left: 8,
					}}
				>
					{language}
				</Text>
			) : null}
		</View>
	);
}
