/**
 * Visible transcript for the currently-selected session. Includes the
 * streaming placeholder row when a turn is in flight.
 *
 * Reads stable slices (Map references, primitives) from the store and
 * builds the merged array under `useMemo` — never builds a fresh array
 * inside a zustand selector (that would trip Object.is and cause
 * infinite re-renders).
 */

import { useMemo } from "react";
import { useStore } from "@/state/store";
import {
	STREAMING_ROW_ID,
	type ChatMessageItem,
} from "@/types/domain";

export function useTranscript() {
	const sid = useStore((s) => s.currentSessionId);
	const transcriptsMap = useStore((s) => s.transcripts);
	const placeholdersMap = useStore((s) => s.streamingPlaceholders);
	const activeAgentId = useStore((s) => s.activeAgentId);

	// Read the per-session slots into local refs. Both Maps are
	// replaced wholesale on every mutation, so these references are
	// only stable across renders that didn't touch this session.
	const transcript = sid ? transcriptsMap.get(sid) : undefined;
	const placeholder = sid ? placeholdersMap.get(sid) : undefined;

	const messages = useMemo<ChatMessageItem[]>(() => {
		const base = transcript ?? [];
		if (placeholder === undefined) return base;
		return [
			...base,
			{
				id: STREAMING_ROW_ID,
				role: "assistant",
				text: placeholder,
				authorAgentId: activeAgentId ?? undefined,
			},
		];
	}, [transcript, placeholder, activeAgentId]);

	const loading = placeholder !== undefined;
	return { messages, loading };
}
