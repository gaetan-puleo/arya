/**
 * Mounts the WS transport at app root. Call once.
 */

import { useEffect } from "react";
import { start, stop } from "@/services/aryaClient";
import { useStore } from "@/state/store";

export function useConnection() {
	useEffect(() => {
		start();
		return () => stop();
	}, []);

	return useStore((s) => s.connected);
}

/** Re-dial the WS after a config change. */
export function reconnect(): Promise<void> {
	return start();
}
