/**
 * Agent registry + active-agent selection.
 *
 * Derived values (`activeAgent`, `primaryAgents`) are memoised here
 * rather than in zustand selectors, because they'd build fresh
 * arrays/objects on every store read and Object.is equality would
 * cause infinite re-renders.
 */

import { useCallback, useMemo } from "react";
import * as arya from "@/services/aryaClient";
import { useStore } from "@/state/store";
import type { AgentInfo } from "@/types/domain";

export function useAgents() {
	const agents = useStore((s) => s.agents);
	const activeAgentId = useStore((s) => s.activeAgentId);

	const activeAgent = useMemo<AgentInfo | null>(() => {
		if (!activeAgentId) return null;
		const found = agents.find(
			(a) =>
				a.id === activeAgentId && (a.type ?? "primary") === "primary",
		);
		return found ?? { id: activeAgentId, description: "" };
	}, [agents, activeAgentId]);

	const primaryAgents = useMemo<AgentInfo[]>(
		() => agents.filter((a) => (a.type ?? "primary") === "primary"),
		[agents],
	);

	const setActive = useCallback((agentId: string) => {
		arya.setActiveAgent(agentId, useStore.getState().currentSessionId);
	}, []);

	return {
		agents,
		activeAgentId,
		activeAgent,
		primaryAgents,
		setActive,
	};
}
