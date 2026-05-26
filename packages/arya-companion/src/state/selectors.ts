/**
 * Selectors that only return primitives or stable refs from store state.
 *
 * Derived values that build fresh arrays/objects on every call are NOT
 * exposed here — they live inside hooks behind `useMemo` so zustand's
 * default Object.is equality doesn't trigger infinite re-renders.
 */

import type { Store } from "@/state/store";

export function selectIsTurnInFlight(
	state: Store,
	sid: string | null,
): boolean {
	if (!sid) return false;
	return state.streamingPlaceholders.has(sid);
}
