import Ionicons from "@expo/vector-icons/Ionicons";
import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "@/theme/ThemeContext";
import type { SubAgentEventKind } from "@/lib/ws";

export interface TimelineEntry {
	id: string;
	kind: SubAgentEventKind;
	ts: number;
	data: Record<string, unknown>;
}

function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString([], {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

function formatArgs(args: unknown): string {
	if (!args || typeof args !== "object") return "";
	return Object.entries(args as Record<string, unknown>)
		.slice(0, 5)
		.map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`)
		.join("\n");
}

/**
 * One row in the sub-agent detail screen's timeline. Renders different
 * layouts per `kind` of event — invocation start/end, tool call
 * start/end, message-end bubble.
 */
export default function TimelineItem({ entry }: { entry: TimelineEntry }) {
	const theme = useTheme();
	const c = theme.colors;

	switch (entry.kind) {
		case "invocation_start": {
			const prompt = entry.data.prompt as string | undefined;
			return (
				<Row icon="play-circle" iconColor={c.info}>
					<View className="flex-1 gap-0.5">
						<HeaderLine title="Invocation started" ts={entry.ts} />
						{prompt ? <CodeBox>{prompt}</CodeBox> : null}
					</View>
				</Row>
			);
		}
		case "tool_call_start": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const args = formatArgs(entry.data.args);
			return (
				<Row icon="construct" iconColor={c.warning} iconSize={14}>
					<View className="flex-1 gap-0.5">
						<HeaderLine title={toolName} ts={entry.ts} />
						{args ? <CodeBox>{args}</CodeBox> : null}
					</View>
				</Row>
			);
		}
		case "tool_call_end": {
			const toolName = (entry.data.toolName as string) ?? "unknown";
			const isError = entry.data.isError === true;
			const color = isError ? c.danger : c.success;
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
						{toolName} — {isError ? "failed" : "done"}
					</Text>
					<View className="flex-1 flex-row justify-end">
						<Text className="text-[10px] text-text-secondary">
							{formatTime(entry.ts)}
						</Text>
					</View>
				</Row>
			);
		}
		case "message_end": {
			const text = (entry.data.text as string) ?? "";
			return (
				<View className="px-4 py-1.5">
					<View
						className="rounded-card px-4 py-3"
						style={{ backgroundColor: "#2F2F2F" }}
					>
						<Text className="text-sm text-text leading-5">{text}</Text>
					</View>
					<View className="flex-row justify-between">
						<View />
						<Text className="text-[10px] text-text-secondary">
							{formatTime(entry.ts)}
						</Text>
					</View>
				</View>
			);
		}
		case "invocation_end": {
			const st = entry.data.status as string;
			const isError = st === "error";
			const errorMsg = entry.data.error as string | undefined;
			const color = isError ? c.danger : c.success;
			return (
				<Row
					icon={isError ? "close-circle" : "checkmark-circle"}
					iconColor={color}
				>
					<View className="flex-1 gap-0.5">
						<View className="flex-row justify-between">
							<Text className="text-sm font-semibold" style={{ color }}>
								{isError ? "Failed" : "Completed"}
							</Text>
							<Text className="text-[10px] text-text-secondary">
								{formatTime(entry.ts)}
							</Text>
						</View>
						{isError && errorMsg ? (
							<Text numberOfLines={3} className="text-xs text-danger">
								{errorMsg}
							</Text>
						) : null}
					</View>
				</Row>
			);
		}
		default:
			return null;
	}
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
