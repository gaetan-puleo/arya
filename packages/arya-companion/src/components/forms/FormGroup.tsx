import { Text, View } from "react-native";

interface FormGroupProps {
	label: string;
	hint?: string;
	optional?: boolean;
	children: React.ReactNode;
}

/**
 * Uppercase-label form group with optional hint text. Used by the
 * settings screen — kept generic for future forms.
 */
export default function FormGroup({
	label,
	hint,
	optional,
	children,
}: FormGroupProps) {
	return (
		<View className="mb-[18px]">
			<View className="flex-row items-baseline mb-2">
				<Text className="text-[13px] font-bold tracking-[0.4px] uppercase text-text-secondary">
					{label}
				</Text>
				{optional ? (
					<Text className="ml-1.5 text-xs text-text-tertiary">· optional</Text>
				) : null}
			</View>
			{children}
			{hint ? (
				<Text className="mt-1.5 text-xs text-text-tertiary leading-4">
					{hint}
				</Text>
			) : null}
		</View>
	);
}
