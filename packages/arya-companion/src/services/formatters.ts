/**
 * Pure, channel-agnostic formatters used by multiple screens.
 */

import type { SessionSummary } from "@/types/domain";

/** Compact duration formatter — `123ms`, `4.2s`, `1m 30s`. */
export function formatDuration(
	startTs: number,
	endTs?: number,
	now?: number,
): string {
	const end = endTs ?? now ?? Date.now();
	const ms = Math.max(0, end - startTs);
	if (ms < 1000) return `${ms}ms`;
	const totalSec = ms / 1000;
	if (totalSec < 60) {
		const tenths = Math.round(totalSec * 10) / 10;
		return `${tenths}s`;
	}
	const min = Math.floor(totalSec / 60);
	const sec = Math.round(totalSec - min * 60);
	if (sec === 0) return `${min}m`;
	return `${min}m ${sec}s`;
}

/** "just now" / "5m ago" / "3h ago" / "2d ago" → locale date after 7d. */
export function formatRelativeTime(ts: number, now?: number): string {
	const diffMs = (now ?? Date.now()) - ts;
	const sec = Math.round(diffMs / 1000);
	if (sec < 60) return "just now";
	const min = Math.round(sec / 60);
	if (min < 60) return `${min}m ago`;
	const hr = Math.round(min / 60);
	if (hr < 24) return `${hr}h ago`;
	const day = Math.round(hr / 24);
	if (day < 7) return `${day}d ago`;
	return new Date(ts).toLocaleDateString();
}

export type SessionGroupLabel =
	| "Today"
	| "Yesterday"
	| "Last 7 days"
	| "Older";

export interface SessionGroup {
	label: SessionGroupLabel;
	items: SessionSummary[];
}

export function groupByDate(
	sessions: SessionSummary[],
	now?: number,
): SessionGroup[] {
	const nowDate = new Date(now ?? Date.now());
	const startOfToday = new Date(
		nowDate.getFullYear(),
		nowDate.getMonth(),
		nowDate.getDate(),
	).getTime();
	const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
	const sevenDaysAgo = startOfToday - 6 * 24 * 60 * 60 * 1000;

	const today: SessionSummary[] = [];
	const yesterday: SessionSummary[] = [];
	const lastWeek: SessionSummary[] = [];
	const older: SessionSummary[] = [];

	for (const s of sessions) {
		if (s.updatedAt >= startOfToday) today.push(s);
		else if (s.updatedAt >= startOfYesterday) yesterday.push(s);
		else if (s.updatedAt >= sevenDaysAgo) lastWeek.push(s);
		else older.push(s);
	}

	const groups: SessionGroup[] = [];
	if (today.length) groups.push({ label: "Today", items: today });
	if (yesterday.length)
		groups.push({ label: "Yesterday", items: yesterday });
	if (lastWeek.length) groups.push({ label: "Last 7 days", items: lastWeek });
	if (older.length) groups.push({ label: "Older", items: older });
	return groups;
}

/** Title-case the first letter of an agent id for display. */
export function capitalizeAgentName(id: string): string {
	if (!id) return id;
	return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Stringify args for an approval-card preview or tool-call panel. */
export function prettyArgs(args: unknown): string {
	if (args == null) return "";
	if (typeof args === "string") return args;
	try {
		return JSON.stringify(args, null, 2);
	} catch {
		return String(args);
	}
}
