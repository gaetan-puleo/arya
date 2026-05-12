import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";
import CenteredCard from "./CenteredCard";

interface ConfirmModalProps {
	open: boolean;
	title: string;
	body: string;
	confirmLabel?: string;
	/** Renders the confirm button with the destructive theme color. */
	destructive?: boolean;
	onClose: () => void;
	onConfirm: () => void;
}

/**
 * Centered confirmation dialog with title + body + Cancel/Confirm
 * buttons. When `destructive` is set, the confirm button takes the
 * theme's danger color and fires a Warning haptic before invoking
 * the callback.
 */
export default function ConfirmModal({
	open,
	title,
	body,
	confirmLabel = "OK",
	destructive,
	onClose,
	onConfirm,
}: ConfirmModalProps) {
	return (
		<CenteredCard open={open} onClose={onClose}>
			<Text className="text-base font-bold text-text">{title}</Text>

			<Text className="text-sm leading-[18px] text-text-secondary">{body}</Text>

			<View className="flex-row justify-end gap-2">
				<Pressable
					onPress={onClose}
					className="px-4 py-2 rounded-full active:bg-bg-hover"
				>
					<Text className="text-sm font-semibold text-text-secondary">
						Cancel
					</Text>
				</Pressable>
				<Pressable
					onPress={() => {
						if (destructive) {
							Haptics.notificationAsync(
								Haptics.NotificationFeedbackType.Warning,
							);
						}
						onConfirm();
					}}
					className={
						destructive
							? "px-4 py-2 rounded-full bg-danger active:bg-bg-hover"
							: "px-4 py-2 rounded-full border border-border bg-bg-secondary active:bg-bg-hover"
					}
				>
					<Text
						className={
							destructive
								? "text-sm font-bold text-white"
								: "text-sm font-bold text-text"
						}
					>
						{confirmLabel}
					</Text>
				</Pressable>
			</View>
		</CenteredCard>
	);
}
