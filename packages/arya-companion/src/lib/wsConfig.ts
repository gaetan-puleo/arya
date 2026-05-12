import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Single source of truth for the WebSocket configuration storage key
 * and value shape. Previously hardcoded in three different places.
 */

const WS_STORAGE_KEY = "arya-companion-ws";

export interface WsConfig {
	url: string;
	token?: string;
}

export async function readWsConfig(): Promise<WsConfig | null> {
	try {
		const raw = await AsyncStorage.getItem(WS_STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as WsConfig;
		if (!parsed?.url?.trim()) return null;
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
