import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { Keyboard, Platform } from "react-native";
import type { AgentInfo, CommandInfo, SubAgentEvent } from "@/lib/ws";
import type { SubAgentRunInfo } from "@/components/SubAgentCard";
import type { ApprovalStatus } from "@/types/approval";
import { globalSubAgentEvents } from "@/lib/subAgentStore";
import { createReconnectingSocket } from "@/lib/ws-client";

const WS_KEY = "arya-companion-ws";

export interface ApprovalData {
	msgId: string;
	requestId: string;
	token: string;
	toolName: string;
	toolArgs: string | undefined;
	status: ApprovalStatus;
}

let approvalSeq = 0;

// ── useWebSocket ────────────────────────────────────────────────────────

function useWebSocket() {
	const ws = useRef<WebSocket | null>(null);
	const [connected, setConnected] = useState(false);

	const connect = useCallback((url: string, token?: string) => {
		if (!url.trim()) return;

		const socket = createReconnectingSocket(
			url,
			token,
			(msg) => {
				// Handled by callers via onMessage callbacks
			},
		);
		ws.current = socket;

		socket.onopen = () => {
			setConnected(true);
			socket.send(JSON.stringify({ type: "commands" }));
			socket.send(JSON.stringify({ type: "agents" }));
		};
		socket.onerror = (err) => {
			console.error("[ws] error", err);
		};

		return socket;
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

	return { ws, connected };
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

	const filteredAgents = showAgentMenu
		? agents.filter((a) => {
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
	const { ws, connected } = useWebSocket();
	const { keyboardOpen, keyboardHeight } = useKeyboard();

	const [messages, setMessages] = useState<
		{ id: string; role: "user" | "assistant"; text: string }[]
	>([]);
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
	const [showScrollFab, setShowScrollFab] = useState(false);

	// ── Message handlers ──

	useEffect(() => {
		const socket = ws.current;
		if (!socket) return;

		const handleMessage = (e: MessageEvent) => {
			const msg = JSON.parse(e.data);

			if (msg.type === "stream") {
				setMessages((m) =>
					m.map((x) => (x.id === "streaming" ? { ...x, text: msg.text } : x)),
				);
			} else if (msg.type === "done") {
				setMessages((m) =>
					m.map((x) =>
						x.id === "streaming"
							? { ...x, text: msg.text, id: Date.now().toString() }
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
					const entry = { id: msgId, role: "assistant" as const, text: "" };
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
						const entry = {
							id: cardId,
							role: "assistant" as const,
							text: "",
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
				setLoading(false);
				console.error("[ws]", msg.message);
			}
		};

		socket.addEventListener("message", handleMessage);
		return () => socket.removeEventListener("message", handleMessage);
	}, [ws]);

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

		setMessages((m) => [
			...m,
			{ id: Date.now().toString(), role: "user", text: txt },
		]);
		setInput("");
		setLoading(true);
		setMessages((m) => [
			...m,
			{ id: "streaming", role: "assistant", text: "…" },
		]);

		if (isCommand) {
			ws.current.send(JSON.stringify({ type: "command", text: txt }));
		} else {
			ws.current.send(JSON.stringify({ type: "chat", text: txt }));
		}
	}, [input, loading, ws]);

	const clearChat = useCallback(() => {
		setMessages([]);
		setApprovals(new Map());
		setSubAgentRuns(new Map());
		globalSubAgentEvents.clear();
	}, []);

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
		showScrollFab,
		setShowScrollFab,
		keyboardOpen,
		keyboardHeight,
		// Actions
		respondApproval,
		send,
		clearChat,
		// Derived
		hasText,
		showCommandMenu,
		filteredCommands,
		showAgentMenu,
		filteredAgents,
	};
}
