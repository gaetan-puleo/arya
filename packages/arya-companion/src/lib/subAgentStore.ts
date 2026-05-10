import type { SubAgentEvent } from "./ws";

/** Global store for sub-agent events (populated by useChat, consumed by detail screen). */
export const globalSubAgentEvents = new Map<string, SubAgentEvent[]>();
