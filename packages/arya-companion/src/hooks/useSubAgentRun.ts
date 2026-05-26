/**
 * Sub-agent run snapshots — by id or the full Map.
 */

import { useStore } from "@/state/store";

export function useSubAgentRuns() {
	return useStore((s) => s.subAgentRuns);
}

export function useSubAgentRun(runId: string | undefined) {
	return useStore((s) => (runId ? s.subAgentRuns.get(runId) : undefined));
}
