/**
 * Persistence for the WS connection settings.
 *
 * The URL lives in AsyncStorage (not secret). The auth TOKEN lives in
 * expo-secure-store (Keychain on iOS, Keystore/EncryptedSharedPreferences on
 * Android) so it is excluded from unencrypted device backups and not readable
 * from a plain AsyncStorage dump. A one-time migration moves a token that an
 * older build left in AsyncStorage into the secure store and scrubs it.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import type { WsConfig } from "@/types/config";

const WS_STORAGE_KEY = "arya-companion-ws";
const TOKEN_STORAGE_KEY = "arya-companion-ws-token";

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
	let url: string | undefined;
	let legacyToken: string | undefined;
	try {
		const raw = await AsyncStorage.getItem(WS_STORAGE_KEY);
		if (raw) {
			const parsed: unknown = JSON.parse(raw);
			if (isWsConfig(parsed)) {
				url = parsed.url;
				legacyToken = parsed.token;
			}
		}
	} catch {
		// fall through to secure-store-only read
	}
	if (!url) return null;

	let token = legacyToken;
	try {
		const secureToken = await SecureStore.getItemAsync(TOKEN_STORAGE_KEY);
		// Secure store wins; fall back to the legacy AsyncStorage token so the
		// first launch after an upgrade still authenticates (don't drop it).
		token = secureToken ?? legacyToken;
	} catch {
		// secure store unavailable (e.g. unsupported device): keep legacy token if any
		token = legacyToken;
	}

	// One-time migration: move a token left in AsyncStorage by an older build
	// into the secure store, then scrub it from the plaintext blob.
	if (legacyToken) {
		try {
			if (!token) await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, legacyToken);
			await AsyncStorage.setItem(WS_STORAGE_KEY, JSON.stringify({ url }));
			token = legacyToken;
		} catch {
			// non-fatal: keep using the legacy token this session
		}
	}

	return token ? { url, token } : { url };
}

export async function writeWsConfig(cfg: WsConfig): Promise<void> {
	// URL only in AsyncStorage; token only in the secure store.
	await AsyncStorage.setItem(WS_STORAGE_KEY, JSON.stringify({ url: cfg.url }));
	try {
		if (cfg.token) {
			await SecureStore.setItemAsync(TOKEN_STORAGE_KEY, cfg.token);
		} else {
			await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
		}
	} catch {
		// If the secure store write fails, don't fall back to plaintext — a
		// missing token is safer than a leaked one.
	}
}

export async function clearWsConfig(): Promise<void> {
	await AsyncStorage.removeItem(WS_STORAGE_KEY);
	try {
		await SecureStore.deleteItemAsync(TOKEN_STORAGE_KEY);
	} catch {
		// nothing to clear
	}
}
