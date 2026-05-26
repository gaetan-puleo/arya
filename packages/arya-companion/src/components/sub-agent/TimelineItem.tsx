import Ionicons from "@expo/vector-icons/Ionicons";
import type { MessageDisplayRow } from "@/types/domain";
import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";

function formatTime(ts: number): string {
	if (!ts) return "";
	return new Date(ts).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

/**
 * One row in the sub-agent detail screen's timeline. Renders one
 * `MessageDisplayRow` (the server-projected snapshot entry) per `role`.
 *
 * No reduction — the server already produced the timeline. We just pick
 * the right layout for the role/customType.
 */
export default function TimelineItem({ row }: { row: MessageDisplayRow }) {
	const theme = useTheme();
	const c = theme.colors;

	if (row.role === "user") {
		return (
			<Row icon="play-circle" iconColor={c.info}>
				<View className="flex-1 gap-0.5">
					<HeaderLine title="Invocation started" ts={row.ts} />
					{row.text ? <CodeBox>{row.text}</CodeBox> : null}
				</View>
			</Row>
		);
	}

	if (row.role === "tool") {
		const isError = row.toolError === true;
		const color = isError ? c.danger : c.success;
		const name = row.toolName ?? "tool";
		return (
			<Row
				icon={isError ? "close-circle" : "checkmark-circle"}
				iconColor={color}
				iconSize={13}
				alignCenter
				paddingV={4}
			>
				<Text
					className="text-xs"
					style={{ color: isError ? c.danger : c.textSecondary }}
				>
					{name} — {isError ? "failed" : "done"}
				</Text>
				<View className="flex-1 flex-row justify-end">
					<Text className="text-[10px] text-text-secondary">
						{formatTime(row.ts)}
					</Text>
				</View>
			</Row>
		);
	}

	// role === 'assistant' — render as message bubble.
	if (!row.text) return null;
	return (
		<View className="px-4 py-1.5">
			<View
				className="rounded-card px-4 py-3"
				style={{ backgroundColor: "#2F2F2F" }}
			>
				<Text className="text-sm text-text leading-5">{row.text}</Text>
			</View>
			<View className="flex-row justify-between">
				<View />
				<Text className="text-[10px] text-text-secondary">
					{formatTime(row.ts)}
				</Text>
			</View>
		</View>
	);
}

// ── Internal primitives ──

function Row({
	children,
	icon,
	iconColor,
	iconSize = 16,
	alignCenter,
	paddingV = 6,
}: {
	children: React.ReactNode;
	icon: keyof typeof Ionicons.glyphMap;
	iconColor: string;
	iconSize?: number;
	alignCenter?: boolean;
	paddingV?: number;
}) {
	return (
		<View
			className={`flex-row gap-2.5 px-4 ${alignCenter ? "items-center" : "items-start"}`}
			style={{ paddingVertical: paddingV }}
		>
			<View
				className="w-5 items-center"
				style={{ paddingTop: alignCenter ? undefined : 3 }}
			>
				<Ionicons name={icon} size={iconSize} color={iconColor} />
			</View>
			{children}
		</View>
	);
}

function HeaderLine({ title, ts }: { title: string; ts: number }) {
	return (
		<View className="flex-row justify-between">
			<Text className="text-sm font-semibold text-text">{title}</Text>
			<Text className="text-[10px] text-text-secondary">{formatTime(ts)}</Text>
		</View>
	);
}

function CodeBox({ children }: { children: React.ReactNode }) {
	return (
		<View
			className="rounded-lg px-3 py-1.5 mt-1"
			style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
		>
			<Text numberOfLines={6} className="text-xs text-text-secondary">
				{children}
			</Text>
		</View>
	);
}
