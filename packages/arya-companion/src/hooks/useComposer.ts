/**
 * Composer state: input, slash/at popovers, and the send action.
 *
 * Subsumes the previous `useSlashAndAt`. Owns no transcript state —
 * read transcripts via `useTranscript()`.
 */

import { useCallback, useState } from "react";
import * as Haptics from "expo-haptics";
import * as Clipboard from "expo-clipboard";
import * as arya from "@/services/aryaClient";
import { useStore } from "@/state/store";
import type { AgentInfo, Attachment, CommandInfo } from "@/types/domain";

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
	/** Pending image/audio attachments to send with the next message. */
	attachments: Attachment[];
	/** True when the server's model accepts images (gates the paste-image button). */
	canAttachImage: boolean;
	/** Paste an image from the clipboard into the pending attachments. */
	pasteImage: () => void;
	removeAttachment: (index: number) => void;
}

/** Split a `data:<mime>;base64,<payload>` URI into its mime + raw base64 payload. */
function parseDataUri(uri: string): { mime: string; data: string } | null {
	const match = /^data:([^;]+);base64,(.*)$/s.exec(uri);
	if (!match) return null;
	return { mime: match[1], data: match[2] };
}

function newSessionId(): string {
	return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function useComposer(): ComposerState {
	const [input, setInput] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);

	const connected = useStore((s) => s.connected);
	const commands = useStore((s) => s.commands);
	const agents = useStore((s) => s.agents);
	const canAttachImage = useStore((s) => s.capabilities.vision);
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

	// The `@` agent menu is plumbed end-to-end but currently has no rows
	// to surface — every wire agent is hardcoded `type: "primary"` and
	// the previous filter (`=== "subagent"`) produced an empty list.
	// Re-enable once the server emits sub-agent entries on the `agents` wire.
	const filteredAgents: AgentInfo[] = [];

	const pasteImage = useCallback(() => {
		if (!canAttachImage) return;
		void (async () => {
			const has = await Clipboard.hasImageAsync().catch(() => false);
			if (!has) return;
			const img = await Clipboard.getImageAsync({ format: "png" }).catch(
				() => null,
			);
			if (!img) return;
			const parsed = parseDataUri(img.data);
			if (!parsed) return;
			Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
			setAttachments((prev) => [
				...prev,
				{ kind: "image", mime: parsed.mime, data: parsed.data },
			]);
		})();
	}, [canAttachImage]);

	const removeAttachment = useCallback((index: number) => {
		setAttachments((prev) => prev.filter((_, i) => i !== index));
	}, []);

	const send = useCallback(() => {
		const txt = input.trim();
		const atts = attachments;
		// Allow attachment-only messages (no text) as long as something is present.
		if ((!txt && atts.length === 0) || loading || !connected) return;

		Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

		let sid = useStore.getState().currentSessionId;
		if (!sid) {
			sid = newSessionId();
			arya.createSession(sid);
			arya.selectSession(sid);
		}

		setInput("");
		setAttachments([]);
		if (txt.startsWith("/")) arya.sendCommand(sid, txt);
		else arya.sendChat(sid, txt, atts.length > 0 ? atts : undefined);
	}, [input, attachments, loading, connected]);

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
		attachments,
		canAttachImage,
		pasteImage,
		removeAttachment,
	};
}
