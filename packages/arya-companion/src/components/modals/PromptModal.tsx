import { useEffect, useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import CenteredCard from "./CenteredCard";

interface PromptModalProps {
	open: boolean;
	title: string;
	/** Prefilled value; `onSubmit` receives the trimmed edited string. */
	initial: string;
	placeholder?: string;
	submitLabel?: string;
	onClose: () => void;
	onSubmit: (value: string) => void;
}

/**
 * Centered single-input prompt. Submit-on-return supported. The text
 * is selected on focus so the user can immediately retype. Empty
 * submissions are treated as cancellations.
 */
export default function PromptModal({
	open,
	title,
	initial,
	placeholder,
	submitLabel = "Save",
	onClose,
	onSubmit,
}: PromptModalProps) {
	const theme = useTheme();
	const [draft, setDraft] = useState(initial);
	const inputRef = useRef<TextInput | null>(null);

	useEffect(() => {
		if (open) {
			setDraft(initial);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [open, initial]);

	const submit = () => {
		const v = draft.trim();
		if (!v) {
			onClose();
			return;
		}
		onSubmit(v);
	};

	return (
		<CenteredCard open={open} onClose={onClose}>
			<Text className="text-base font-bold text-text">{title}</Text>

			<TextInput
				ref={inputRef}
				value={draft}
				onChangeText={setDraft}
				onSubmitEditing={submit}
				returnKeyType="done"
				selectTextOnFocus
				placeholder={placeholder}
				placeholderTextColor={theme.colors.textPlaceholder}
				className="text-sm text-text border border-border rounded-lg px-3 py-2 bg-bg-input"
			/>

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
					onPress={submit}
					className="px-4 py-2 rounded-full border border-border bg-bg-secondary active:bg-bg-hover"
				>
					<Text className="text-sm font-bold text-text">{submitLabel}</Text>
				</Pressable>
			</View>
		</CenteredCard>
	);
}
