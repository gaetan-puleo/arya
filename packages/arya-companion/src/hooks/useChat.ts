import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "@/lib/appStore";
import type { AgentInfo, ChatMessageItem } from "@/lib/ws";
import type { ApprovalData } from "@/types/approval";
import { handleSessionMessage } from "@/hooks/chatDispatch";
import { useKeyboard } from "@/hooks/useKeyboard";
import { useSlashAndAt } from "@/hooks/useSlashAndAt";

/** Persisted last-active sessionId. Survives app restarts. */
const SESSION_ID_KEY = "arya-companion-current-session";

/**
 * Chat-screen orchestrator. Subscribes to the app-level store for the
 * connection + cross-cutting registries (agents, sessions, sub-agent
 * runs) and owns the screen-local transcript state (messages,
 * approvals, loading, scroll-to-bottom fab).
 *
 * The actual per-message updates live in `chatDispatch.ts` — a pure
 * function over the inbound message and the screen-local setters.
 */
export function useChat() {
	// ── Store slices ──
	const connected = useAppStore((s) => s.connected);
	const commands = useAppStore((s) => s.commands);
	const agents = useAppStore((s) => s.agents);
	const activeAgentId = useAppStore((s) => s.activeAgentId);
	const sessions = useAppStore((s) => s.sessions);
	const subAgentRuns = useAppStore((s) => s.subAgentRuns);
	const {
		setActiveAgent,
		createSession: storeCreateSession,
		deleteSession: storeDeleteSession,
		renameSession,
		requestSessionHistory,
		sendChat: storeSendChat,
		sendCommand: storeSendCommand,
		respondApproval: storeRespondApproval,
		clearSubAgentRuns,
		subscribeToSessionMessages,
	} = useAppStore(
		useShallow((s) => ({
			setActiveAgent: s.setActiveAgent,
			createSession: s.createSession,
			deleteSession: s.deleteSession,
			renameSession: s.renameSession,
			requestSessionHistory: s.requestSessionHistory,
			sendChat: s.sendChat,
			sendCommand: s.sendCommand,
			respondApproval: s.respondApproval,
			clearSubAgentRuns: s.clearSubAgentRuns,
			subscribeToSessionMessages: s.subscribeToSessionMessages,
		})),
	);

	// ── Local state ──
	const { keyboardOpen, keyboardHeight } = useKeyboard();
	const [messages, setMessages] = useState<ChatMessageItem[]>([]);
	const [approvals, setApprovals] = useState<Map<string, ApprovalData>>(
		new Map(),
	);
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [showScrollFab, setShowScrollFab] = useState(false);
	const [currentSessionId, setCurrentSessionId] = useState<string | null>(
		null,
	);

	// Synchronous mirror of currentSessionId. Same-tick callers (e.g.
	// `send` right after `createSession`) need the just-set id without
	// waiting for the next render.
	const currentSessionIdRef = useRef<string | null>(null);
	useEffect(() => {
		currentSessionIdRef.current = currentSessionId;
		if (currentSessionId) {
			AsyncStorage.setItem(SESSION_ID_KEY, currentSessionId).catch(() => {});
		}
	}, [currentSessionId]);

	// Restore the previously active session on first launch.
	useEffect(() => {
		AsyncStorage.getItem(SESSION_ID_KEY)
			.then((id) => {
				if (id) setCurrentSessionId(id);
			})
			.catch(() => {});
	}, []);

	// First-load fallback: if the server lists at least one session and
	// we don't have one yet, adopt the most recent.
	useEffect(() => {
		if (currentSessionId) return;
		if (sessions.length === 0) return;
		setCurrentSessionId(sessions[0]!.id);
	}, [sessions, currentSessionId]);

	const resetTranscript = useCallback(() => {
		setMessages([]);
		setApprovals(new Map());
		setLoading(false);
		clearSubAgentRuns();
	}, [clearSubAgentRuns]);

	// ── Subscribe to inbound store messages ──
	// activeAgentId is mirrored on a ref so the dispatcher reads it
	// without resubscribing the listener per change.
	const activeAgentIdRef = useRef<string | null>(activeAgentId);
	useEffect(() => {
		activeAgentIdRef.current = activeAgentId;
	}, [activeAgentId]);

	useEffect(() => {
		return subscribeToSessionMessages((msg) =>
			handleSessionMessage(msg, {
				currentSessionIdRef,
				activeAgentIdRef,
				setMessages,
				setApprovals,
				setLoading,
			}),
		);
	}, [subscribeToSessionMessages]);

	// Request the session's persisted history whenever the connection
	// is up and we know which session to view.
	useEffect(() => {
		if (!connected) return;
		if (!currentSessionId) return;
		requestSessionHistory(currentSessionId);
	}, [connected, currentSessionId, requestSessionHistory]);

	// ── Derived ──
	const activeAgent = useMemo<AgentInfo | null>(() => {
		if (!activeAgentId) return null;
		const found = agents.find(
			(a) => a.id === activeAgentId && (a.type ?? "primary") === "primary",
		);
		if (found) return found;
		return { id: activeAgentId, description: "" };
	}, [agents, activeAgentId]);

	const primaryAgents = useMemo<AgentInfo[]>(
		() => agents.filter((a) => (a.type ?? "primary") === "primary"),
		[agents],
	);

	const currentSession = useMemo(() => {
		if (!currentSessionId) return null;
		return sessions.find((s) => s.id === currentSessionId) ?? null;
	}, [sessions, currentSessionId]);

	const { showCommandMenu, filteredCommands, showAgentMenu, filteredAgents } =
		useSlashAndAt(input, commands, agents);

	// ── Session actions ──
	const selectSession = useCallback(
		(sessionId: string) => {
			if (sessionId === currentSessionIdRef.current) return;
			Haptics.selectionAsync();
			resetTranscript();
			currentSessionIdRef.current = sessionId;
			setCurrentSessionId(sessionId);
		},
		[resetTranscript],
	);

	const createSession = useCallback(() => {
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		storeCreateSession(id);
		resetTranscript();
		currentSessionIdRef.current = id;
		setCurrentSessionId(id);
	}, [storeCreateSession, resetTranscript]);

	const deleteSession = useCallback(
		(sessionId: string) => {
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
			storeDeleteSession(sessionId);
			if (sessionId === currentSessionIdRef.current) {
				resetTranscript();
				currentSessionIdRef.current = null;
				setCurrentSessionId(null);
				AsyncStorage.removeItem(SESSION_ID_KEY).catch(() => {});
			}
		},
		[storeDeleteSession, resetTranscript],
	);

	const deleteAllSessions = useCallback(() => {
		if (sessions.length === 0) return;
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
		for (const s of sessions) storeDeleteSession(s.id);
		resetTranscript();
		currentSessionIdRef.current = null;
		setCurrentSessionId(null);
		AsyncStorage.removeItem(SESSION_ID_KEY).catch(() => {});
	}, [sessions, storeDeleteSession, resetTranscript]);

	const respondApproval = useCallback(
		(msgId: string, action: "approve" | "deny") => {
			const data = approvals.get(msgId);
			if (!data || data.status !== "pending") return;

			Haptics.notificationAsync(
				action === "approve"
					? Haptics.NotificationFeedbackType.Success
					: Haptics.NotificationFeedbackType.Warning,
			);

			storeRespondApproval(data.requestId, data.token, action);

			setApprovals((prev) => {
				const next = new Map(prev);
				next.set(msgId, {
					...data,
					status: action === "approve" ? "approved" : "denied",
				});
				return next;
			});
		},
		[approvals, storeRespondApproval],
	);

	const send = useCallback(() => {
		const txt = input.trim();
		if (!txt || loading || !connected) return;

		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

		const isCommand = txt.startsWith("/");

		let sessId = currentSessionIdRef.current;
		if (!sessId) {
			sessId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
			currentSessionIdRef.current = sessId;
			setCurrentSessionId(sessId);
		}

		setMessages((m) => [
			...m,
			{ id: Date.now().toString(), role: "user", text: txt },
		]);
		setInput("");
		setLoading(true);
		setMessages((m) => [
			...m,
			{
				id: "streaming",
				role: "assistant",
				text: "…",
				authorAgentId: activeAgentIdRef.current ?? undefined,
			},
		]);

		if (isCommand) storeSendCommand(sessId, txt);
		else storeSendChat(sessId, txt);
	}, [input, loading, connected, storeSendChat, storeSendCommand]);

	return {
		// State
		messages,
		approvals,
		subAgentRuns,
		input,
		setInput,
		loading,
		commands,
		agents,
		activeAgent,
		activeAgentId,
		primaryAgents,
		showScrollFab,
		setShowScrollFab,
		keyboardOpen,
		keyboardHeight,
		// Sessions
		sessions,
		currentSessionId,
		currentSession,
		// Actions
		respondApproval,
		send,
		setActiveAgent,
		selectSession,
		createSession,
		deleteSession,
		deleteAllSessions,
		renameSession,
		// Derived
		showCommandMenu,
		filteredCommands,
		showAgentMenu,
		filteredAgents,
	};
}
