import { useState } from "react";
import { TextInput, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

interface TextFieldProps {
	value: string;
	onChangeText: (v: string) => void;
	placeholder?: string;
	secureTextEntry?: boolean;
	autoCapitalize?: "none" | "sentences" | "words" | "characters";
	autoCorrect?: boolean;
	keyboardType?: "default" | "url" | "email-address";
}

/**
 * Themed text input with a focus-ring border. Owns its own `focused`
 * state — the previous version had every screen track that locally,
 * which was needless boilerplate.
 */
export default function TextField({
	value,
	onChangeText,
	placeholder,
	secureTextEntry,
	autoCapitalize,
	autoCorrect,
	keyboardType,
}: TextFieldProps) {
	const theme = useTheme();
	const [focused, setFocused] = useState(false);
	return (
		<View
			className={`rounded-[14px] border bg-bg-input px-3.5 py-2.5 ${
				focused ? "border-border-focus" : "border-border"
			}`}
		>
			<TextInput
				value={value}
				onChangeText={onChangeText}
				onFocus={() => setFocused(true)}
				onBlur={() => setFocused(false)}
				placeholder={placeholder}
				placeholderTextColor={theme.colors.textPlaceholder}
				secureTextEntry={secureTextEntry}
				autoCapitalize={autoCapitalize}
				autoCorrect={autoCorrect}
				keyboardType={keyboardType}
				className="text-[15px] text-text py-1"
			/>
		</View>
	);
}
