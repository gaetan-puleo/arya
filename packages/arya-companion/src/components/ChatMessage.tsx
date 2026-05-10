import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Pressable, Share, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";
import { useUnistyles } from "@/theme/ThemeContext";
import { parseCodeBlocks } from "@/utils/parseCodeBlocks";
import type { AgentInfo } from "@/lib/ws";
import CodeBlock from "./CodeBlock";
import InlineMarkdown from "./InlineMarkdown";

interface ChatMessageProps {
	role: "user" | "assistant";
	text: string;
	isFirstInGroup?: boolean;
	isLastInGroup?: boolean;
	animate?: boolean;
	/** Agent that authored this assistant message — used for the avatar. */
	authorAgent?: AgentInfo | null;
}

function MessageContent({ text, textColor }: { text: string; textColor: string }) {
	const segments = parseCodeBlocks(text);

	if (segments.length === 1 && segments[0].type === "text") {
		return <InlineMarkdown text={text} color={textColor} />;
	}

	return (
		<View>
			{segments.map((seg, i) =>
				seg.type === "code" ? (
					<CodeBlock key={i} code={seg.content} language={seg.language} />
				) : (
					<InlineMarkdown key={i} text={seg.content} color={textColor} />
				),
			)}
		</View>
	);
}

export default function ChatMessage({
	role,
	text,
	isFirstInGroup = true,
	isLastInGroup = true,
	animate = true,
	authorAgent,
}: ChatMessageProps) {
	const isUser = role === "assistant";
	const { theme } = useUnistyles();
	const [copied, setCopied] = useState(false);

	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;
	const successColor = theme.colors.success;
	const bgTertiary = theme.colors.backgroundTertiary;

	const entering = animate
		? isUser
			? FadeInLeft.duration(300).springify()
			: FadeInRight.duration(300).springify()
		: undefined;

	const handleCopy = useCallback(() => {
		Clipboard.setStringAsync(text);
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	}, [text]);

	const handleShare = useCallback(async () => {
		try {
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			await Share.share({ message: text });
		} catch {
			// user cancelled or share unavailable
		}
	}, [text]);

	const handleLongPress = handleCopy;

	if (!isUser) {
		// User: right-aligned bubble
		return (
			<Animated.View entering={entering}>
				<View
					style={{
						alignItems: "flex-end",
						paddingHorizontal: 16,
					}}
				>
					<Pressable onLongPress={handleLongPress}>
						<View
							style={{
								maxWidth: "85%",
								backgroundColor: bgTertiary,
								borderRadius: 20,
								borderBottomRightRadius: isLastInGroup ? 6 : 16,
								borderTopRightRadius: isFirstInGroup ? 20 : 16,
								paddingHorizontal: 16,
								paddingVertical: 12,
								opacity: copied ? 0.6 : 1,
							}}
						>
							<MessageContent text={text} textColor={textColor} />
						</View>
					</Pressable>
				</View>
			</Animated.View>
		);
	}

	// Assistant: left-aligned, no avatar
	return (
		<Animated.View entering={entering}>
			<View
				style={{
					paddingHorizontal: 16,
				}}
			>
				<View style={{ width: "100%" }}>
					<View style={{ width: "100%" }}>
						<Pressable onLongPress={handleLongPress}>
							<View
								style={{
									opacity: copied ? 0.6 : 1,
								}}
							>
								<MessageContent text={text} textColor={textColor} />
							</View>
						</Pressable>

						{/* ── Actions (only on last message in group) ── */}
						{isLastInGroup && text.trim().length > 0 ? (
							<View
								style={{
									flexDirection: "row",
									alignItems: "center",
									gap: 4,
									marginTop: 6,
									marginLeft: -6,
								}}
							>
								<Pressable
									onPress={handleCopy}
									hitSlop={8}
									style={({ pressed }) => ({
										padding: 6,
										borderRadius: 6,
										opacity: pressed ? 0.5 : 1,
									})}
								>
									<Ionicons
										name={copied ? "checkmark" : "copy-outline"}
										size={16}
										color={copied ? successColor : textSecondary}
									/>
								</Pressable>
								<Pressable
									onPress={handleShare}
									hitSlop={8}
									style={({ pressed }) => ({
										padding: 6,
										borderRadius: 6,
										opacity: pressed ? 0.5 : 1,
									})}
								>
									<Ionicons
										name="share-social-outline"
										size={16}
										color={textSecondary}
									/>
								</Pressable>
							</View>
						) : null}
					</View>
				</View>
			</View>
		</Animated.View>
	);
}
