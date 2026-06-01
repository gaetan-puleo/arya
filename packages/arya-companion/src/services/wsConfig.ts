/**
 * AsyncStorage persistence for the WS connection settings.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { WsConfig } from "@/types/config";

const WS_STORAGE_KEY = "arya-companion-ws";

/**
 * Runtime guard. Narrows arbitrary JSON to `WsConfig`. AsyncStorage may
 * contain anything (older app version, corrupt write, hand-edited backup),
 * so we never trust the parsed shape without checking it.
 */
function isWsConfig(value: unknown): value is WsConfig {
	if (!value || typeof value !== "object") return false;
	const v = value as Partial<WsConfig>;
	if (typeof v.url !== "string" || v.url.trim().length === 0) return false;
	if (v.token !== undefined && typeof v.token !== "string") return false;
	return true;
}

export async function readWsConfig(): Promise<WsConfig | null> {
	try {
		const raw = await AsyncStorage.getItem(WS_STORAGE_KEY);
		if (!raw) return null;
		const parsed: unknown = JSON.parse(raw);
		if (!isWsConfig(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}

export async function writeWsConfig(cfg: WsConfig): Promise<void> {
	await AsyncStorage.setItem(WS_STORAGE_KEY, JSON.stringify(cfg));
}

export async function clearWsConfig(): Promise<void> {
	await AsyncStorage.removeItem(WS_STORAGE_KEY);
}
