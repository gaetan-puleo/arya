/**
 * Composer state: input, slash/at popovers, and the send action.
 *
 * Subsumes the previous `useSlashAndAt`. Owns no transcript state —
 * read transcripts via `useTranscript()`.
 */

import { useCallback, useState } from "react";
import * as Haptics from "expo-haptics";
import * as arya from "@/services/aryaClient";
import { useStore } from "@/state/store";
import type { AgentInfo, CommandInfo } from "@/types/domain";

interface ComposerState {
	input: string;
	setInput: (v: string) => void;
	send: () => void;
	loading: boolean;
	connected: boolean;
	commands: CommandInfo[];
	showCommandMenu: boolean;
	filteredCommands: CommandInfo[];
	agents: AgentInfo[];
	showAgentMenu: boolean;
	filteredAgents: AgentInfo[];
}

function newSessionId(): string {
	return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useComposer(): ComposerState {
	const [input, setInput] = useState("");

	const connected = useStore((s) => s.connected);
	const commands = useStore((s) => s.commands);
	const agents = useStore((s) => s.agents);
	const currentSessionId = useStore((s) => s.currentSessionId);
	const loading = useStore((s) =>
		currentSessionId
			? s.streamingPlaceholders.has(currentSessionId)
			: false,
	);

	const showCommandMenu = input.startsWith("/") && !input.includes(" ");
	const showAgentMenu = input.startsWith("@") && !input.includes(" ");
	const query = input.slice(1).toLowerCase();

	const filteredCommands = showCommandMenu
		? commands.filter(
				(c) =>
					!query ||
					c.command.toLowerCase().includes(query) ||
					c.description.toLowerCase().includes(query),
			)
		: [];

	const filteredAgents = showAgentMenu
		? agents
				.filter((a) => (a.type ?? "primary") === "subagent")
				.filter(
					(a) =>
						!query ||
						a.id.toLowerCase().includes(query) ||
						a.description.toLowerCase().includes(query),
				)
		: [];

	const send = useCallback(() => {
		const txt = input.trim();
		if (!txt || loading || !connected) return;

		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

		let sid = useStore.getState().currentSessionId;
		if (!sid) {
			sid = newSessionId();
			arya.createSession(sid);
			arya.selectSession(sid);
		}

		setInput("");
		if (txt.startsWith("/")) arya.sendCommand(sid, txt);
		else arya.sendChat(sid, txt);
	}, [input, loading, connected]);

	return {
		input,
		setInput,
		send,
		loading,
		connected,
		commands,
		showCommandMenu,
		filteredCommands,
		agents,
		showAgentMenu,
		filteredAgents,
	};
}
