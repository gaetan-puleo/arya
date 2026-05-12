import type { SessionSummary } from "@/lib/ws";

export interface SessionGroup {
	label: string;
	items: SessionSummary[];
}

/**
 * Group sessions into Today / Yesterday / Last 7 days / Older buckets,
 * preserving the input order inside each bucket.
 */
export function groupByDate(sessions: SessionSummary[]): SessionGroup[] {
	const now = new Date();
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
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
	if (yesterday.length) groups.push({ label: "Yesterday", items: yesterday });
	if (lastWeek.length) groups.push({ label: "Last 7 days", items: lastWeek });
	if (older.length) groups.push({ label: "Older", items: older });
	return groups;
}

/**
 * Compact relative-time formatter ("just now", "5m ago", "3h ago",
 * "2d ago"). Falls back to a locale date string after a week.
 */
export function formatRelativeTime(ts: number): string {
	const diffMs = Date.now() - ts;
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
