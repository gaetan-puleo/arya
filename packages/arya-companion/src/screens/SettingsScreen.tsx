/**
 * Settings screen — configure the WS connection.
 *
 * Empty default URL on purpose: the user must enter their reachable
 * arya host explicitly. Hardcoding a stale LAN/Tailscale IP would
 * silently break on the next move.
 */

import * as Haptics from "expo-haptics";
import { type Href, Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
	Alert,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { reconnect } from "@/hooks/useConnection";
import {
	clearWsConfig,
	readWsConfig,
	writeWsConfig,
} from "@/services/wsConfig";
import type { WsConfig } from "@/types/config";

import FormGroup from "@/components/forms/FormGroup";
import HelpStep from "@/components/forms/HelpStep";
import TextField from "@/components/forms/TextField";
import { FloatingPill } from "@/components/primitives/FloatingPill";

export default function SettingsScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();

	const [url, setUrl] = useState("");
	const [token, setToken] = useState("");
	const [saved, setSaved] = useState<WsConfig | null>(null);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		(async () => {
			const stored = await readWsConfig();
			if (stored) {
				setUrl(stored.url);
				setToken(stored.token ?? "");
				setSaved(stored);
			}
		})();
	}, []);

	const dirty = useMemo(() => {
		const u = url.trim();
		const t = token.trim();
		if (!saved) return u.length > 0 || t.length > 0;
		return u !== saved.url || t !== (saved.token ?? "");
	}, [url, token, saved]);

	const connected = !!saved;

	const handleSave = async () => {
		if (!url.trim()) {
			Alert.alert("Missing URL", "The WebSocket URL is required.");
			return;
		}
		setSaving(true);
		try {
			const cfg: WsConfig = {
				url: url.trim(),
				token: token.trim() || undefined,
			};
			await writeWsConfig(cfg);
			setSaved(cfg);
			await reconnect();
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
		} catch {
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
			Alert.alert(
				"Save failed",
				"Could not write configuration to storage.",
			);
		} finally {
			setSaving(false);
		}
	};

	const handleReset = async () => {
		Alert.alert(
			"Reset configuration?",
			"This will clear the saved server URL and token.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Reset",
					style: "destructive",
					onPress: async () => {
						await clearWsConfig();
						setUrl("");
						setToken("");
						setSaved(null);
						await reconnect();
						Haptics.notificationAsync(
							Haptics.NotificationFeedbackType.Warning,
						);
					},
				},
			],
		);
	};

	return (
		<View className="flex-1 bg-bg">
			<Stack.Screen options={{ headerShown: false }} />

			<KeyboardAvoidingView
				className="flex-1"
				behavior={Platform.OS === "ios" ? "padding" : undefined}
			>
				<ScrollView
					className="flex-1"
					contentContainerStyle={{
						paddingTop: insets.top + 64,
						paddingBottom: insets.bottom + 32,
						paddingHorizontal: 20,
					}}
					keyboardShouldPersistTaps="handled"
				>
					<Text className="text-[28px] font-bold text-text mb-1">
						Settings
					</Text>
					<Text className="text-sm text-text-secondary mb-6">
						Configure the connection to your Arya server.
					</Text>

					<View className="flex-row items-center self-start gap-2 px-3 py-2 rounded-full border border-border bg-bg-secondary mb-7">
						<View
							className={`w-2 h-2 rounded-full ${
								connected ? "bg-success" : "bg-text-placeholder"
							}`}
						/>
						<Text className="text-[13px] text-text-secondary">
							{connected ? "Configured" : "Not configured"}
						</Text>
					</View>

					<Pressable
						onPress={() => router.push("/scan" as Href)}
						className="h-12 rounded-pill items-center justify-center bg-primary active:opacity-80 mb-3"
					>
						<Text className="text-[15px] font-bold text-text-inverse">
							Scan QR code
						</Text>
					</Pressable>
					<Text className="text-[13px] text-text-secondary mb-7 text-center">
						or enter the connection manually
					</Text>

					<FormGroup
						label="Server URL"
						hint="The WebSocket address of your Arya server."
					>
						<TextField
							value={url}
							onChangeText={setUrl}
							placeholder="ws://<host>:<port>"
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
					</FormGroup>

					<FormGroup
						label="Token"
						optional
						hint="Required only when the server is started with an auth token."
					>
						<TextField
							value={token}
							onChangeText={setToken}
							placeholder="Optional secret"
							secureTextEntry
							autoCapitalize="none"
							autoCorrect={false}
						/>
					</FormGroup>

					<View className="flex-row gap-3 mt-2">
						{dirty ? (
							<Pressable
								onPress={handleSave}
								disabled={saving}
								className="flex-1 h-12 rounded-pill items-center justify-center bg-primary active:opacity-80"
								style={{ opacity: saving ? 0.8 : 1 }}
							>
								<Text className="text-[15px] font-bold text-text-inverse">
									{saving ? "Saving…" : "Save"}
								</Text>
							</Pressable>
						) : (
							<View className="flex-1 h-12 rounded-pill items-center justify-center border border-border">
								<Text className="text-sm font-medium text-text-tertiary">
									{connected ? "Saved" : "No changes"}
								</Text>
							</View>
						)}
						{saved ? (
							<Pressable
								onPress={handleReset}
								className="h-12 px-4 rounded-pill items-center justify-center border border-border active:bg-bg-hover"
							>
								<Text className="text-sm font-semibold text-danger">
									Reset
								</Text>
							</Pressable>
						) : null}
					</View>

					<View className="mt-8 p-4 rounded-card border border-border bg-bg-secondary">
						<Text className="text-[15px] font-bold text-text mb-3">
							How to connect
						</Text>

						<HelpStep
							n={1}
							text="Start Arya on your host (`arya` or `bun run arya`)."
						/>
						<View className="h-2" />
						<HelpStep
							n={2}
							text="Note the host IP and the wsPort from ~/.config/arya/config.json."
						/>
						<View className="h-2" />
						<HelpStep
							n={3}
							text="Enter `ws://<host>:<port>` above and tap Save."
						/>
					</View>
				</ScrollView>
			</KeyboardAvoidingView>

			<FloatingPill
				onPress={() => router.back()}
				icon="chevron-back"
				label="Back"
				accessibilityLabel="Back"
				style={{
					position: "absolute",
					top: insets.top + 8,
					left: 12,
				}}
			/>
		</View>
	);
}
