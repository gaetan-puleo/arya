import { Text, View, type ViewStyle } from "react-native";

interface AgentHint {
	id: string;
	color?: string;
}

interface AryaAvatarProps {
	size?: number;
	style?: ViewStyle;
	/**
	 * Optional agent hint. When provided, the avatar uses the agent's
	 * first letter + a luminance-readable text color over the agent's
	 * color. When omitted, falls back to "A" on white.
	 */
	agent?: AgentHint | null;
}

function readableTextOn(bgHex: string | undefined): string {
	if (!bgHex || !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(bgHex)) return "#000000";
	let hex = bgHex.slice(1);
	if (hex.length === 3) {
		hex = hex
			.split("")
			.map((c) => c + c)
			.join("");
	}
	const r = parseInt(hex.slice(0, 2), 16) / 255;
	const g = parseInt(hex.slice(2, 4), 16) / 255;
	const b = parseInt(hex.slice(4, 6), 16) / 255;
	const lin = (c: number) =>
		c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
	const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
	return L > 0.5 ? "#000000" : "#FFFFFF";
}

export function AryaAvatar({ size = 24, style, agent }: AryaAvatarProps) {
	const useAgentHint = !!agent && !!agent.id;
	const bgColor = useAgentHint ? agent!.color ?? "#FFFFFF" : "#FFFFFF";
	const textColor = useAgentHint ? readableTextOn(bgColor) : "#000000";
	const letter = useAgentHint ? agent!.id.charAt(0).toUpperCase() : "A";

	return (
		<View
			className="justify-center items-center shrink-0"
			style={[
				{
					width: size,
					height: size,
					borderRadius: size / 2,
					backgroundColor: bgColor,
					marginBottom: size === 52 ? 4 : 2,
				},
				style,
			]}
		>
			<Text
				className="font-bold"
				style={{ fontSize: size * 0.54, color: textColor }}
			>
				{letter}
			</Text>
		</View>
	);
}
