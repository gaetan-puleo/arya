/**
 * Sessions list + currentSessionId + CRUD actions.
 *
 * `currentSession` is memoised — pulling it via a zustand selector
 * would build a fresh object on every call when there's no match,
 * which trips Object.is and re-renders forever.
 */

import * as Haptics from "expo-haptics";
import { useCallback, useMemo } from "react";
import * as arya from "@/services/aryaClient";
import { useStore } from "@/state/store";
import type { SessionSummary } from "@/types/domain";

function newSessionId(): string {
	return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useSessions() {
	const sessions = useStore((s) => s.sessions);
	const currentSessionId = useStore((s) => s.currentSessionId);

	const currentSession = useMemo<SessionSummary | null>(() => {
		if (!currentSessionId) return null;
		return sessions.find((s) => s.id === currentSessionId) ?? null;
	}, [sessions, currentSessionId]);

	const select = useCallback((sessionId: string) => {
		if (sessionId === useStore.getState().currentSessionId) return;
		Haptics.selectionAsync();
		arya.selectSession(sessionId);
	}, []);

	const create = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		const id = newSessionId();
		arya.createSession(id);
		arya.selectSession(id);
	}, []);

	const remove = useCallback((sessionId: string) => {
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
		arya.deleteSession(sessionId);
		useStore.getState().dropTranscript(sessionId);
		if (sessionId === useStore.getState().currentSessionId) {
			arya.selectSession(null);
		}
	}, []);

	const removeAll = useCallback(() => {
		const all = useStore.getState().sessions;
		if (all.length === 0) return;
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
		for (const s of all) {
			arya.deleteSession(s.id);
			useStore.getState().dropTranscript(s.id);
		}
		arya.selectSession(null);
	}, []);

	const rename = useCallback((sessionId: string, title: string) => {
		arya.renameSession(sessionId, title);
	}, []);

	return {
		sessions,
		currentSessionId,
		currentSession,
		select,
		create,
		delete: remove,
		deleteAll: removeAll,
		rename,
	};
}
