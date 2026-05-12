import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Pressable, Share, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";
import { useTheme } from "@/theme/ThemeContext";
import type { AgentInfo } from "@/lib/ws";
import MessageMarkdown from "./MessageMarkdown";

interface ChatMessageProps {
	role: "user" | "assistant";
	text: string;
	isFirstInGroup?: boolean;
	isLastInGroup?: boolean;
	animate?: boolean;
	/** Agent that authored this assistant message — used for the avatar. */
	authorAgent?: AgentInfo | null;
}

export default function ChatMessage({
	role,
	text,
	isFirstInGroup = true,
	isLastInGroup = true,
	animate = true,
}: ChatMessageProps) {
	const isUser = role === "user";
	const theme = useTheme();
	const [copied, setCopied] = useState(false);

	// User bubbles slide in from the right; assistant bubbles from the
	// left, mirroring their alignment.
	const entering = animate
		? isUser
			? FadeInRight.duration(300).springify()
			: FadeInLeft.duration(300).springify()
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

	if (isUser) {
		// User: right-aligned bubble.
		return (
			<Animated.View entering={entering}>
				<View className="items-end px-4">
					<Pressable onLongPress={handleLongPress}>
						<View
							className={`max-w-[85%] bg-bg-tertiary px-4 py-3 ${copied ? "opacity-60" : ""}`}
							style={{
								borderRadius: 20,
								borderBottomRightRadius: isLastInGroup ? 6 : 16,
								borderTopRightRadius: isFirstInGroup ? 20 : 16,
							}}
						>
							<MessageMarkdown text={text} color={theme.colors.text} />
						</View>
					</Pressable>
				</View>
			</Animated.View>
		);
	}

	// Assistant: left-aligned, no avatar
	return (
		<Animated.View entering={entering}>
			<View className="px-4">
				<View className="w-full">
					<View className="w-full">
						<Pressable onLongPress={handleLongPress}>
							<View className={copied ? "opacity-60" : ""}>
								<MessageMarkdown text={text} color={theme.colors.text} />
							</View>
						</Pressable>

						{/* Actions (only on last message in group) */}
						{isLastInGroup && text.trim().length > 0 ? (
							<View className="flex-row items-center gap-1 mt-1.5 -ml-1.5">
								<Pressable
									onPress={handleCopy}
									hitSlop={8}
									className="p-1.5 rounded-md active:opacity-50"
								>
									<Ionicons
										name={copied ? "checkmark" : "copy-outline"}
										size={16}
										color={copied ? theme.colors.success : theme.colors.textSecondary}
									/>
								</Pressable>
								<Pressable
									onPress={handleShare}
									hitSlop={8}
									className="p-1.5 rounded-md active:opacity-50"
								>
									<Ionicons
										name="share-social-outline"
										size={16}
										color={theme.colors.textSecondary}
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
