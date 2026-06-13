import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useCallback, useState } from "react";
import { Image, Pressable, Share, View } from "react-native";
import Animated, { FadeInLeft, FadeInRight } from "react-native-reanimated";

import type { AgentInfo, Attachment } from "@/types/domain";
import { useTheme } from "@/theme/ThemeContext";
import MessageMarkdown from "@/components/markdown/MessageMarkdown";

interface ChatMessageProps {
	role: "user" | "assistant";
	text: string;
	isFirstInGroup?: boolean;
	isLastInGroup?: boolean;
	animate?: boolean;
	authorAgent?: AgentInfo | null;
	attachments?: Attachment[];
}

/** Renders image attachments as inline thumbnails inside a bubble. */
function BubbleAttachments({ attachments }: { attachments?: Attachment[] }) {
	const images = (attachments ?? []).filter((a) => a.kind === "image");
	if (images.length === 0) return null;
	return (
		<View className="flex-row flex-wrap gap-1.5 mb-1.5">
			{images.map((att, i) => (
				<Image
					key={`img-${i}`}
					source={{ uri: `data:${att.mime};base64,${att.data}` }}
					style={{ width: 160, height: 160, borderRadius: 12 }}
					resizeMode="cover"
				/>
			))}
		</View>
	);
}

/**
 * Single chat bubble. Receives role + text + grouping flags as props.
 * Side effects (copy, share) are local; no store reads.
 */
export default function ChatMessage({
	role,
	text,
	isFirstInGroup = true,
	isLastInGroup = true,
	animate = true,
	attachments,
}: ChatMessageProps) {
	const isUser = role === "user";
	const hasAttachments = attachments != null && attachments.length > 0;
	const theme = useTheme();
	const [copied, setCopied] = useState(false);

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

	if (isUser) {
		return (
			<Animated.View entering={entering}>
				<View className="items-end px-4">
					<Pressable onLongPress={handleCopy}>
						<View
							className={`max-w-[85%] bg-bg-tertiary px-4 py-3 ${copied ? "opacity-60" : ""}`}
							style={{
								borderRadius: 20,
								borderBottomRightRadius: isLastInGroup ? 6 : 16,
								borderTopRightRadius: isFirstInGroup ? 20 : 16,
							}}
						>
							{hasAttachments && (
								<BubbleAttachments attachments={attachments} />
							)}
							{text.trim().length > 0 && (
								<MessageMarkdown text={text} color={theme.colors.text} />
							)}
						</View>
					</Pressable>
				</View>
			</Animated.View>
		);
	}

	return (
		<Animated.View entering={entering}>
			<View className="px-4">
				<View className="w-full">
					<Pressable onLongPress={handleCopy}>
						<View className={copied ? "opacity-60" : ""}>
							{hasAttachments && (
								<BubbleAttachments attachments={attachments} />
							)}
							<MessageMarkdown text={text} color={theme.colors.text} />
						</View>
					</Pressable>

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
									color={
										copied
											? theme.colors.success
											: theme.colors.textSecondary
									}
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
		</Animated.View>
	);
}
