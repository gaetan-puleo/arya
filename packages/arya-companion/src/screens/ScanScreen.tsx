/**
 * Scan the connection QR printed by `arya serve`.
 *
 * The QR payload is a JSON blob `{ "url": "ws://…", "token"?: "…" }`. On a valid
 * scan we persist it to wsConfig, reconnect, and jump to the chat. The server
 * must already be configured (run `arya setup` on the host first).
 */

import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { reconnect } from "@/hooks/useConnection";
import { writeWsConfig } from "@/services/wsConfig";
import type { WsConfig } from "@/types/config";

import { FloatingPill } from "@/components/primitives/FloatingPill";

/** Parse the scanned text into a WsConfig. Accepts the JSON blob, or a bare ws URL. */
function parsePayload(data: string): WsConfig | null {
	const text = data.trim();
	try {
		const obj: unknown = JSON.parse(text);
		if (obj && typeof obj === "object") {
			const o = obj as Record<string, unknown>;
			if (typeof o.url === "string" && o.url.trim()) {
				return {
					url: o.url.trim(),
					token: typeof o.token === "string" && o.token ? o.token : undefined,
				};
			}
		}
	} catch {
		// not JSON — fall through to URL handling
	}
	if (/^wss?:\/\//i.test(text)) return { url: text };
	return null;
}

export default function ScanScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const [permission, requestPermission] = useCameraPermissions();
	const [busy, setBusy] = useState(false);
	const handled = useRef(false);

	const onScanned = async (data: string) => {
		if (handled.current || busy) return;
		const cfg = parsePayload(data);
		if (!cfg) {
			// Let the user try again with a valid code.
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
			Alert.alert("Unrecognized code", "That QR code is not an Arya connection code.");
			return;
		}
		handled.current = true;
		setBusy(true);
		try {
			await writeWsConfig(cfg);
			await reconnect();
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
			router.replace("/");
		} catch {
			handled.current = false;
			setBusy(false);
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
			Alert.alert("Connection failed", "Could not save or connect with the scanned settings.");
		}
	};

	return (
		<View className="flex-1 bg-bg">
			<Stack.Screen options={{ headerShown: false }} />

			{permission?.granted ? (
				<CameraView
					style={{ flex: 1 }}
					facing="back"
					barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
					onBarcodeScanned={({ data }: { data: string }) => void onScanned(data)}
				/>
			) : (
				<View
					className="flex-1 items-center justify-center px-8"
					style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
				>
					<Text className="text-[22px] font-bold text-text mb-2 text-center">
						Scan to connect
					</Text>
					<Text className="text-sm text-text-secondary mb-6 text-center">
						Point your camera at the QR code shown by `arya serve` to configure the
						connection automatically.
					</Text>
					<Pressable
						onPress={() => void requestPermission()}
						className="h-12 px-6 rounded-pill items-center justify-center bg-primary active:opacity-80"
					>
						<Text className="text-[15px] font-bold text-text-inverse">
							{permission ? "Allow camera access" : "Enable camera"}
						</Text>
					</Pressable>
				</View>
			)}

			<View
				className="absolute left-0 right-0 items-center"
				style={{ bottom: insets.bottom + 28 }}
				pointerEvents="none"
			>
				{permission?.granted ? (
					<Text className="text-[13px] text-text-inverse bg-black/50 px-3 py-1.5 rounded-full">
						{busy ? "Connecting…" : "Point at the Arya QR code"}
					</Text>
				) : null}
			</View>

			<FloatingPill
				onPress={() => router.back()}
				icon="chevron-back"
				label="Back"
				accessibilityLabel="Back"
				style={{ position: "absolute", top: insets.top + 8, left: 12 }}
			/>
		</View>
	);
}
