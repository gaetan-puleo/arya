import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";
import type {
	AgentInfo,
	ChatMessageItem,
	CommandInfo,
	PersistedSession,
	SessionSummary,
	SubAgentEvent,
} from "@/lib/ws";
import type { SubAgentRunInfo } from "@/components/SubAgentCard";
import type { ApprovalData, ApprovalStatus } from "@/types/approval";
import { globalSubAgentEvents } from "@/lib/subAgentStore";
import { createReconnectingSocket } from "@/lib/ws-client";

const WS_KEY = "arya-companion-ws";
/** AsyncStorage key for the last-active sessionId; survives app restarts. */
const SESSION_ID_KEY = "arya-companion-current-session";

let approvalSeq = 0;

// ── useWebSocket ────────────────────────────────────────────────────────

function useWebSocket() {
	const ws = useRef<WebSocket | null>(null);
	const [socket, setSocket] = useState<WebSocket | null>(null);
	const [connected, setConnected] = useState(false);

	const connect = useCallback((url: string, token?: string) => {
		if (!url.trim()) return;

		console.log(`[ws] connecting to ${url}${token ? " (with token)" : ""}`);

		const newSocket = createReconnectingSocket(
			url,
			token,
			(msg) => {
				// Handled by callers via onMessage callbacks
			},
			(s) => {
				ws.current = s;
				setSocket(s);

				s.addEventListener("open", () => {
					console.log(`[ws] connected to ${url}`);
				});
				s.addEventListener("close", (e: CloseEvent) => {
					setConnected(false);
					console.warn(
						`[ws] closed (code=${e.code}, reason="${e.reason || ""}") — will retry in 3s`,
					);
				});
				s.addEventListener("error", (err: Event) => {
					const m = (err as Event & { message?: string }).message;
					console.error(
						`[ws] socket error on ${url}${m ? `: ${m}` : ""} — check that the agent is running and the URL is reachable`,
					);
				});
			},
		);

		newSocket.onopen = () => {
			setConnected(true);
			newSocket.send(JSON.stringify({ type: "commands" }));
			newSocket.send(JSON.stringify({ type: "agents" }));
		};

		return newSocket;
	}, []);

	useEffect(() => {
		AsyncStorage.getItem(WS_KEY).then((raw) => {
			if (!raw) return;
			const cfg = JSON.parse(raw);
			connect(cfg.url, cfg.token);
		});
	}, [connect]);

	useEffect(() => {
		return () => {
			ws.current?.close();
		};
	}, []);

	return { ws, socket, connected };
}

// ── useKeyboard ────────────────────────────────────────────────────────

function useKeyboard() {
	const [keyboardOpen, setKeyboardOpen] = useState(false);
	const [keyboardHeight, setKeyboardHeight] = useState(0);

	useEffect(() => {
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		const showSub = Keyboard.addListener(showEvent, (e) => {
			setKeyboardOpen(true);
			setKeyboardHeight(e.endCoordinates?.height ?? 0);
		});
		const hideSub = Keyboard.addListener(hideEvent, () => {
			setKeyboardOpen(false);
			setKeyboardHeight(0);
		});

		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	return { keyboardOpen, keyboardHeight };
}

// ── useSlashAndAt ──────────────────────────────────────────────────────

function useSlashAndAt(
	input: string,
	commands: CommandInfo[],
	agents: AgentInfo[],
) {
	const showCommandMenu = input.startsWith("/") && !input.includes(" ");
	const commandQuery = input.slice(1).toLowerCase();

	const filteredCommands = showCommandMenu
		? commands.filter((c) => {
				if (!commandQuery) return true;
				return (
					c.command.toLowerCase().includes(commandQuery) ||
					c.description.toLowerCase().includes(commandQuery)
				);
			})
		: [];

	const showAgentMenu = input.startsWith("@") && !input.includes(" ");
	const agentQuery = input.slice(1).toLowerCase();

	// Only subagents are dispatchable via `@<name>` — the server's
	// mu-agents `transformUserInput` hook intercepts mentions of registered
	// subagents and runs them. Mentioning a primary agent would just become
	// literal text, so we hide them from the inline menu.
	const filteredAgents = showAgentMenu
		? agents
				.filter((a) => (a.type ?? "primary") === "subagent")
				.filter((a) => {
					if (!agentQuery) return true;
					return (
						a.id.toLowerCase().includes(agentQuery) ||
						a.description.toLowerCase().includes(agentQuery)
					);
				})
		: [];

	return {
		showCommandMenu,
		filteredCommands,
		showAgentMenu,
		filteredAgents,
	};
}

// ── useChat (orchestrator) ─────────────────────────────────────────────

export function useChat() {
	const { ws, socket, connected } = useWebSocket();
	const { keyboardOpen, keyboardHeight } = useKeyboard();

	const [messages, setMessages] = useState<ChatMessageItem[]>([]);
	const [approvals, setApprovals] = useState<Map<string, ApprovalData>>(
		new Map(),
	);
	const [subAgentRuns, setSubAgentRuns] = useState<
		Map<string, SubAgentRunInfo>
	>(new Map());
	const [input, setInput] = useState("");
	const [loading, setLoading] = useState(false);
	const [commands, setCommands] = useState<CommandInfo[]>([]);
	const [agents, setAgents] = useState<AgentInfo[]>([]);
	const [activeAgentId, setActiveAgentId] = useState<string | null>(null);

	// Persisted, server-managed sessions. `currentSessionId` is the one
	// the user has selected in the drawer (and is sent with each chat
	// message). We restore it from AsyncStorage on mount so the user
	// lands back in their last conversation.
	const [sessions, setSessions] = useState<SessionSummary[]>([]);
	const [currentSessionId, setCurrentSessionId] = useState<string | null>(
		null,
	);
	const currentSessionIdRef = useRef<string | null>(null);
	useEffect(() => {
		currentSessionIdRef.current = currentSessionId;
		// Persist so we re-open the same session next launch. We tolerate
		// the write failing silently (offline/no storage) — the worst case
		// is the user picks a session manually next time.
		if (currentSessionId) {
			AsyncStorage.setItem(SESSION_ID_KEY, currentSessionId).catch(() => {});
		}
	}, [currentSessionId]);

	// Restore the last-used sessionId once on mount. We do NOT request
	// history here; we wait until both the sessionId and the socket are
	// ready (see effect below) so the request lands on an open socket.
	useEffect(() => {
		AsyncStorage.getItem(SESSION_ID_KEY)
			.then((id) => {
				if (id) setCurrentSessionId(id);
			})
			.catch(() => {});
	}, []);
	// Mirror activeAgentId in a ref so message creation paths (inside the WS
	// onMessage handler) tag assistant messages with the agent that authored
	// them at that moment, without resubscribing the WS handler.
	const activeAgentIdRef = useRef<string | null>(null);
	useEffect(() => {
		activeAgentIdRef.current = activeAgentId;
	}, [activeAgentId]);
	const [showScrollFab, setShowScrollFab] = useState(false);

	// ── Message handlers ──

	useEffect(() => {
		if (!socket) return;

		const handleMessage = (e: MessageEvent) => {
			const msg = JSON.parse(e.data);

			// For per-session events we drop anything that doesn't belong to
			// the currently viewed conversation; otherwise switching sessions
			// mid-stream would leak text from one chat into another.
			const evtSessionId =
				typeof msg.sessionId === "string" ? msg.sessionId : null;
			const isForCurrentSession =
				!evtSessionId || evtSessionId === currentSessionIdRef.current;

			if (msg.type === "stream") {
				if (!isForCurrentSession) return;
				setMessages((m) =>
					m.map((x) => (x.id === "streaming" ? { ...x, text: msg.text } : x)),
				);
			} else if (msg.type === "done") {
				if (!isForCurrentSession) return;
				setMessages((m) =>
					m.map((x) =>
						x.id === "streaming"
							? {
								...x,
								// Keep the accumulated streamed text; only overwrite if
								// the server explicitly sent a non-empty final payload.
								text: msg.text && String(msg.text).length > 0 ? msg.text : x.text,
								id: Date.now().toString(),
							}
							: x,
					),
				);
				setLoading(false);
			} else if (msg.type === "approval_request") {
				approvalSeq += 1;
				const requestId = String(msg.requestId ?? msg.token);
				const msgId = `approval-${requestId}-${approvalSeq}`;
				const data: ApprovalData = {
					msgId,
					requestId,
					token: String(msg.token ?? requestId),
					toolName: String(msg.toolName ?? ""),
					toolArgs: msg.toolArgs
						? JSON.stringify(msg.toolArgs, null, 2)
						: undefined,
					status: "pending",
				};
				setApprovals((prev) => new Map(prev).set(msgId, data));
				setMessages((m) => {
					const streamIdx = m.findIndex((x) => x.id === "streaming");
					const entry: ChatMessageItem = {
						id: msgId,
						role: "assistant",
						text: "",
						authorAgentId: activeAgentIdRef.current ?? undefined,
					};
					if (streamIdx === -1) return [...m, entry];
					const next = [...m];
					next.splice(streamIdx, 0, entry);
					return next;
				});
			} else if (msg.type === "approval_response") {
				const status: ApprovalStatus =
					msg.action === "approved" ? "approved" : "denied";
				setApprovals((prev) => {
					const next = new Map(prev);
					for (const [key, entry] of next) {
						if (
							entry.requestId === String(msg.requestId ?? msg.token) &&
							entry.status === "pending"
						) {
							next.set(key, { ...entry, status });
						}
					}
					return next;
				});
			} else if (msg.type === "commands") {
				setCommands(msg.commands || []);
			} else if (msg.type === "agents") {
				setAgents(msg.agents || []);
				if (
					typeof msg.activeAgentId === "string" ||
					msg.activeAgentId === null
				) {
					setActiveAgentId(msg.activeAgentId);
				}
			} else if (msg.type === "active_agent") {
				setActiveAgentId(
					typeof msg.agentId === "string" ? msg.agentId : null,
				);
			} else if (msg.type === "sessions:listed") {
				const list = Array.isArray(msg.sessions)
					? (msg.sessions as SessionSummary[])
					: [];
				setSessions(list);
				// First-load handling: if we have no current session yet (fresh
				// install or AsyncStorage was cleared) and the server has at
				// least one, adopt the most recent. Otherwise the user is
				// stuck looking at an empty UI until they create one.
				if (!currentSessionIdRef.current && list.length > 0) {
					setCurrentSessionId(list[0]!.id);
				}
			} else if (msg.type === "sessions:history") {
				const sessId = String(msg.sessionId ?? "");
				if (sessId !== currentSessionIdRef.current) return;
				const session = msg.session as PersistedSession | null;
				if (!session) {
					// Server says this session id is unknown — start fresh.
					setMessages([]);
					return;
				}
				// Replay the persisted transcript. We use stable ids from disk
				// so React keys are consistent across reloads.
				setMessages(
					session.messages.map((m) => ({
						id: m.id,
						role: m.role,
						text: m.text,
						authorAgentId: m.agentId,
						toolName: m.toolName,
						toolArgs: m.toolArgs,
						toolResult: m.toolResult,
						toolError: m.toolError,
					})),
				);
				// Hydrate tool messages into the approvals map so the
				// ApprovalMessage widget renders them in resolved state.
				const replayedApprovals = new Map<string, ApprovalData>();
				for (const m of session.messages) {
					if (m.role !== "tool") continue;
					replayedApprovals.set(m.id, {
						msgId: m.id,
						requestId: m.id,
						token: m.id,
						toolName: m.toolName ?? "tool",
						toolArgs: m.toolArgs,
						status: m.toolError ? "denied" : "approved",
						toolResult: m.toolResult,
					});
				}
				setApprovals(replayedApprovals);
				setSubAgentRuns(new Map());
			} else if (msg.type === "sub_agent_event" && msg.event) {
				const evt = msg.event as SubAgentEvent;
				const { runId: saRunId } = evt;

				// Store event for the detail screen
				const stored = globalSubAgentEvents.get(saRunId) ?? [];
				stored.push(evt);
				globalSubAgentEvents.set(saRunId, stored);

				if (evt.kind === "invocation_start") {
					const cardId = `sub-agent-${saRunId}`;
					const runInfo: SubAgentRunInfo = {
						runId: saRunId,
						agentId: evt.agentId,
						status: "running",
						toolCount: 0,
						startTs: evt.ts,
					};
					setSubAgentRuns((prev) => new Map(prev).set(cardId, runInfo));
					setMessages((m) => {
						const streamIdx = m.findIndex((x) => x.id === "streaming");
						const entry: ChatMessageItem = {
							id: cardId,
							role: "assistant",
							text: "",
							authorAgentId: evt.agentId,
						};
						if (streamIdx === -1) return [...m, entry];
						const next = [...m];
						next.splice(streamIdx, 0, entry);
						return next;
					});
				} else if (evt.kind === "tool_call_start") {
					const cardId = `sub-agent-${saRunId}`;
					setSubAgentRuns((prev) => {
						const run = prev.get(cardId);
						if (!run) return prev;
						const next = new Map(prev);
						next.set(cardId, {
							...run,
							toolCount: run.toolCount + 1,
						});
						return next;
					});
				} else if (evt.kind === "invocation_end") {
					const cardId = `sub-agent-${saRunId}`;
					const st = evt.data.status as string;
					setSubAgentRuns((prev) => {
						const run = prev.get(cardId);
						if (!run) return prev;
						const next = new Map(prev);
						next.set(cardId, {
							...run,
							status: st === "success" ? "success" : "error",
							endTs: evt.ts,
						});
						return next;
					});
				}
			} else if (msg.type === "error") {
				// Surface the failure to the user. The server emits `error`
				// followed by `done`, but `done` carries empty text on
				// failure paths — so if we don't capture the message here
				// the streaming placeholder ("…") is finalized to nothing
				// and the user is left staring at an empty bubble forever.
				if (!isForCurrentSession) {
					setLoading(false);
					return;
				}
				const errText =
					typeof msg.message === "string" && msg.message.trim()
						? `⚠️ ${msg.message}`
						: "⚠️ The agent failed to respond. Check the server logs.";
				console.error("[ws] server error:", msg.message);
				setMessages((m) => {
					const idx = m.findIndex((x) => x.id === "streaming");
					if (idx === -1) {
						return [
							...m,
							{
								id: `err-${Date.now()}`,
								role: "assistant",
								text: errText,
								authorAgentId: activeAgentIdRef.current ?? undefined,
							},
						];
					}
					const next = [...m];
					next[idx] = {
						...next[idx]!,
						text: errText,
						id: `err-${Date.now()}`,
					};
					return next;
				});
				setLoading(false);
			}
		};

		socket.addEventListener("message", handleMessage);
		return () => socket.removeEventListener("message", handleMessage);
	}, [socket]);

	// Whenever the socket is open and we know which session to show,
	// request its persisted history. Re-fires when the user picks
	// another session in the drawer. The handler above replays the
	// returned transcript into `messages`.
	useEffect(() => {
		if (!socket || socket.readyState !== WebSocket.OPEN) return;
		if (!currentSessionId) return;
		socket.send(
			JSON.stringify({ type: "sessions:get", sessionId: currentSessionId }),
		);
	}, [socket, currentSessionId, connected]);

	// ── Derived ──

	const hasText = input.trim().length > 0;
	const { showCommandMenu, filteredCommands, showAgentMenu, filteredAgents } =
		useSlashAndAt(input, commands, agents);

	// ── Actions ──

	const respondApproval = useCallback(
		(msgId: string, action: "approve" | "deny") => {
			const data = approvals.get(msgId);
			if (!data || data.status !== "pending") return;
			if (ws.current?.readyState !== WebSocket.OPEN) return;

			Haptics.notificationAsync(
				action === "approve"
					? Haptics.NotificationFeedbackType.Success
					: Haptics.NotificationFeedbackType.Warning,
			);

			ws.current.send(
				JSON.stringify({
					type: "approval_response",
					requestId: data.requestId,
					token: data.token,
					action,
					channelId: "websocket",
				}),
			);

			setApprovals((prev) => {
				const next = new Map(prev);
				next.set(msgId, {
					...data,
					status: action === "approve" ? "approved" : "denied",
				});
				return next;
			});
		},
		[approvals, ws],
	);

	const send = useCallback(() => {
		const txt = input.trim();
		if (!txt || loading || ws.current?.readyState !== WebSocket.OPEN) return;

		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

		const isCommand = txt.startsWith("/");

		// Make sure we always submit against an explicit sessionId; the
		// server accepts an absent value (and falls back to the URL's
		// `sessionId` query param), but being explicit guarantees
		// persistence lands in the same file the drawer is showing.
		let sessId = currentSessionIdRef.current;
		if (!sessId) {
			// Generate a client-side id so persistence + listing stay
			// consistent across the very first message of a brand-new app
			// install. The server's appendMessage will auto-create the file.
			sessId = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
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

		const payload = isCommand
			? { type: "command", text: txt, sessionId: sessId }
			: { type: "chat", text: txt, sessionId: sessId };
		ws.current.send(JSON.stringify(payload));
	}, [input, loading, ws]);

	const clearChat = useCallback(() => {
		setMessages([]);
		setApprovals(new Map());
		setSubAgentRuns(new Map());
		globalSubAgentEvents.clear();
	}, []);

	// Resolve the currently active primary agent from the list. Falls back
	// to a synthesized AgentInfo when the id is known but the list hasn't
	// arrived yet, so the UI can still render the mode label without delay.
	const activeAgent = useMemo<AgentInfo | null>(() => {
		if (!activeAgentId) return null;
		const found = agents.find(
			(a) => a.id === activeAgentId && (a.type ?? "primary") === "primary",
		);
		if (found) return found;
		return { id: activeAgentId, description: "" };
	}, [agents, activeAgentId]);

	// Primary agents only — used by the agent switcher UI.
	const primaryAgents = useMemo<AgentInfo[]>(
		() => agents.filter((a) => (a.type ?? "primary") === "primary"),
		[agents],
	);

	const setActiveAgent = useCallback(
		(agentId: string) => {
			if (ws.current?.readyState !== WebSocket.OPEN) return;
			if (agentId === activeAgentId) return;
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			ws.current.send(JSON.stringify({ type: "set_active_agent", agentId }));
			// Optimistic update — server will echo via `active_agent` to confirm.
			setActiveAgentId(agentId);
		},
		[activeAgentId, ws],
	);

	// ── Session-management actions ──

	const selectSession = useCallback(
		(sessionId: string) => {
			if (sessionId === currentSessionIdRef.current) return;
			Haptics.selectionAsync();
			// Clear the current view immediately; the `sessions:history`
			// handler will replay the new transcript when it arrives.
			setMessages([]);
			setApprovals(new Map());
			setSubAgentRuns(new Map());
			setLoading(false);
			setCurrentSessionId(sessionId);
			// History request fires from the dependency-driven effect.
		},
		[],
	);

	const createSession = useCallback(() => {
		if (ws.current?.readyState !== WebSocket.OPEN) return;
		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
		// Generate the id locally so we can switch into it before the
		// server replies. The server's `sessions:create` is idempotent on
		// existing ids, so passing our pre-generated id is safe.
		const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
		ws.current.send(
			JSON.stringify({ type: "sessions:create", sessionId: id }),
		);
		// Optimistic switch — empty transcript is correct for a new session.
		setMessages([]);
		setApprovals(new Map());
		setSubAgentRuns(new Map());
		setLoading(false);
		setCurrentSessionId(id);
	}, [ws]);

	const deleteSession = useCallback(
		(sessionId: string) => {
			if (ws.current?.readyState !== WebSocket.OPEN) return;
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
			ws.current.send(
				JSON.stringify({ type: "sessions:delete", sessionId }),
			);
			// If the user just deleted the session they were viewing,
			// clear the view; the next `sessions:listed` push will pick a
			// new active id (or leave us with none for the empty state).
			if (sessionId === currentSessionIdRef.current) {
				setMessages([]);
				setCurrentSessionId(null);
				AsyncStorage.removeItem(SESSION_ID_KEY).catch(() => {});
			}
		},
		[ws],
	);

	const deleteAllSessions = useCallback(() => {
		if (ws.current?.readyState !== WebSocket.OPEN) return;
		// Snapshot the ids first — `sessions` will be mutated by the
		// incoming `sessions:listed` pushes and iterating over a moving
		// target would skip entries.
		const ids = sessions.map((s) => s.id);
		if (ids.length === 0) return;
		Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
		// The server doesn't expose a bulk-delete message, so we fan
		// out one `sessions:delete` per id. The store is in-memory on
		// the agent side, so this is cheap; the final `sessions:listed`
		// broadcast converges the UI to an empty list in one render.
		for (const id of ids) {
			ws.current.send(JSON.stringify({ type: "sessions:delete", sessionId: id }));
		}
		// Clear the active view immediately — by the time the server
		// echoes back, every session the user could have been on is
		// gone, so the empty-state is the only correct outcome.
		setMessages([]);
		setApprovals(new Map());
		setSubAgentRuns(new Map());
		setLoading(false);
		setCurrentSessionId(null);
		AsyncStorage.removeItem(SESSION_ID_KEY).catch(() => {});
	}, [ws, sessions]);

	const renameSession = useCallback(
		(sessionId: string, title: string) => {
			if (ws.current?.readyState !== WebSocket.OPEN) return;
			ws.current.send(
				JSON.stringify({ type: "sessions:rename", sessionId, title }),
			);
		},
		[ws],
	);

	// Lookup of the currently selected session (for the header label).
	const currentSession = useMemo<SessionSummary | null>(() => {
		if (!currentSessionId) return null;
		return sessions.find((s) => s.id === currentSessionId) ?? null;
	}, [sessions, currentSessionId]);

	return {
		// State
		messages,
		approvals,
		subAgentRuns,
		input,
		setInput,
		loading,
		connected,
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
		clearChat,
		setActiveAgent,
		selectSession,
		createSession,
		deleteSession,
		deleteAllSessions,
		renameSession,
		// Derived
		hasText,
		showCommandMenu,
		filteredCommands,
		showAgentMenu,
		filteredAgents,
	};
}
