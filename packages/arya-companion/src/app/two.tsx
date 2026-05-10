import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { Stack, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
	Alert,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";

const WS_STORAGE_KEY = "arya-companion-ws";

interface WsConfig {
	url: string;
	token?: string;
}

const DEFAULT_CONFIG: WsConfig = { url: "ws://<host>:<port>" };

/**
 * Settings screen — mirrors the chat screen's chrome (floating pill
 * controls instead of a native header) so the transition between the
 * two feels continuous. All copy is in English to match the rest of
 * the UI, and colors come from the theme so light/dark themes work
 * without bespoke overrides.
 */
export default function ConfigScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const { theme } = useUnistyles();

	const [url, setUrl] = useState(DEFAULT_CONFIG.url);
	const [token, setToken] = useState("");
	const [saved, setSaved] = useState<WsConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const [urlFocused, setUrlFocused] = useState(false);
	const [tokenFocused, setTokenFocused] = useState(false);

	useEffect(() => {
		(async () => {
			try {
				const stored = await AsyncStorage.getItem(WS_STORAGE_KEY);
				if (stored) {
					const parsed = JSON.parse(stored);
					setUrl(parsed.url || DEFAULT_CONFIG.url);
					setToken(parsed.token || "");
					setSaved(parsed);
				}
			} catch {
				// fall back to defaults silently
			}
		})();
	}, []);

	// "Dirty" means the form differs from the persisted state. Used to
	// hide the Save button when there's nothing to save, so it doesn't
	// look like an enabled action with no effect.
	const dirty = useMemo(() => {
		const u = url.trim();
		const t = token.trim();
		if (!saved) return u.length > 0 || t.length > 0;
		return u !== (saved.url || "") || t !== (saved.token || "");
	}, [url, token, saved]);

	const connected = !!saved && !!saved.url;

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
			await AsyncStorage.setItem(WS_STORAGE_KEY, JSON.stringify(cfg));
			setSaved(cfg);
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
			Alert.alert(
				"Configuration saved",
				"Restart the app to reconnect with the new settings.",
			);
		} catch {
			Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
			Alert.alert("Save failed", "Could not write configuration to storage.");
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
						await AsyncStorage.removeItem(WS_STORAGE_KEY);
						setUrl(DEFAULT_CONFIG.url);
						setToken("");
						setSaved(null);
						Haptics.notificationAsync(
							Haptics.NotificationFeedbackType.Warning,
						);
					},
				},
			],
		);
	};

	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background }}>
			<Stack.Screen options={{ headerShown: false }} />

			<KeyboardAvoidingView
				style={{ flex: 1 }}
				behavior={Platform.OS === "ios" ? "padding" : undefined}
			>
				<ScrollView
					style={{ flex: 1 }}
					contentContainerStyle={{
						paddingTop: insets.top + 64,
						paddingBottom: insets.bottom + 32,
						paddingHorizontal: 20,
					}}
					keyboardShouldPersistTaps="handled"
				>
					{/* ── Title ── */}
					<Text
						style={{
							fontSize: 28,
							fontWeight: "700",
							color: theme.colors.text,
							marginBottom: 4,
						}}
					>
						Settings
					</Text>
					<Text
						style={{
							fontSize: 14,
							color: theme.colors.textSecondary,
							marginBottom: 24,
						}}
					>
						Configure the connection to your Arya server.
					</Text>

					{/* ── Status chip ──
					    Mirrors the floating "Agent" chip on the chat screen
					    so users immediately recognize the pattern (dot +
					    label). Color hints at the current connection state. */}
					<View
						style={{
							flexDirection: "row",
							alignItems: "center",
							alignSelf: "flex-start",
							gap: 8,
							paddingHorizontal: 12,
							paddingVertical: 8,
							borderRadius: 999,
							borderWidth: 1,
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.backgroundSecondary,
							marginBottom: 28,
						}}
					>
						<View
							style={{
								width: 8,
								height: 8,
								borderRadius: 4,
								backgroundColor: connected
									? theme.colors.success
									: theme.colors.textPlaceholder,
							}}
						/>
						<Text
							style={{
								fontSize: 13,
								color: theme.colors.textSecondary,
							}}
						>
							{connected ? "Configured" : "Not configured"}
						</Text>
					</View>

					{/* ── Server URL ── */}
					<FormGroup
						label="Server URL"
						hint="The WebSocket address of your Arya companion server."
					>
						<TextField
							value={url}
							onChangeText={setUrl}
							placeholder="ws://<host>:<port>"
							focused={urlFocused}
							onFocus={() => setUrlFocused(true)}
							onBlur={() => setUrlFocused(false)}
							autoCapitalize="none"
							autoCorrect={false}
							keyboardType="url"
						/>
					</FormGroup>

					{/* ── Token ── */}
					<FormGroup
						label="Token"
						optional
						hint="Required only when the server is started with COMPANION_TOKEN."
					>
						<TextField
							value={token}
							onChangeText={setToken}
							placeholder="Optional secret"
							focused={tokenFocused}
							onFocus={() => setTokenFocused(true)}
							onBlur={() => setTokenFocused(false)}
							secureTextEntry
							autoCapitalize="none"
							autoCorrect={false}
						/>
					</FormGroup>

					{/* ── Save / Reset row ──
					    Save sits as the primary action (filled), Reset as a
					    quiet text button next to it. Save disappears when
					    the form matches the saved state, so the user never
					    taps it expecting something to happen and gets
					    nothing. */}
					<View style={{ flexDirection: "row", gap: 12, marginTop: 8 }}>
						{dirty ? (
							<Pressable
								onPress={handleSave}
								disabled={saving}
								style={({ pressed }) => ({
									flex: 1,
									height: 48,
									borderRadius: 24,
									alignItems: "center",
									justifyContent: "center",
									backgroundColor: theme.colors.primary,
									opacity: pressed || saving ? 0.8 : 1,
								})}
							>
								<Text
									style={{
										fontSize: 15,
										fontWeight: "700",
										color: theme.colors.textInverse,
									}}
								>
									{saving ? "Saving…" : "Save"}
								</Text>
							</Pressable>
						) : (
							<View
								style={{
									flex: 1,
									height: 48,
									borderRadius: 24,
									alignItems: "center",
									justifyContent: "center",
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: "transparent",
								}}
							>
								<Text
									style={{
										fontSize: 14,
										fontWeight: "500",
										color: theme.colors.textTertiary,
									}}
								>
									{connected ? "Saved" : "No changes"}
								</Text>
							</View>
						)}
						{saved ? (
							<Pressable
								onPress={handleReset}
								style={({ pressed }) => ({
									height: 48,
									paddingHorizontal: 16,
									borderRadius: 24,
									alignItems: "center",
									justifyContent: "center",
									borderWidth: 1,
									borderColor: theme.colors.border,
									backgroundColor: pressed
										? theme.colors.backgroundHover
										: "transparent",
								})}
							>
								<Text
									style={{
										fontSize: 14,
										fontWeight: "600",
										color: theme.colors.danger,
									}}
								>
									Reset
								</Text>
							</Pressable>
						) : null}
					</View>

					{/* ── Help card ──
					    Plain card with monospace snippet — matches the
					    code-block aesthetic used in chat messages. */}
					<View
						style={{
							marginTop: 32,
							padding: 16,
							borderRadius: 16,
							borderWidth: 1,
							borderColor: theme.colors.border,
							backgroundColor: theme.colors.backgroundSecondary,
						}}
					>
						<Text
							style={{
								fontSize: 15,
								fontWeight: "700",
								color: theme.colors.text,
								marginBottom: 12,
							}}
						>
							How to connect
						</Text>

						<HelpStep
							n={1}
							text="Start Arya with the companion server enabled:"
						/>
						<View
							style={{
								backgroundColor: theme.colors.backgroundInput,
								borderRadius: 10,
								padding: 12,
								marginLeft: 28,
								marginTop: 8,
								marginBottom: 16,
								borderWidth: 1,
								borderColor: theme.colors.border,
							}}
						>
							<Text
								style={{
									fontFamily:
										Platform.OS === "ios" ? "Menlo" : "monospace",
									fontSize: 12,
									color: theme.colors.text,
									lineHeight: 18,
								}}
							>
								COMPANION_PORT=3001 \{"\n"}COMPANION_TOKEN=your-secret
							</Text>
						</View>

						<HelpStep
							n={2}
							text="Copy the URL printed in the console."
						/>
						<View style={{ height: 8 }} />
						<HelpStep
							n={3}
							text="Paste it into the Server URL field above."
						/>
					</View>
				</ScrollView>
			</KeyboardAvoidingView>

			{/* ── Floating back pill ──
			    Same shape as the burger button on the chat screen so the
			    transition between screens feels continuous. Sits over the
			    scroll content (paddingTop above leaves room for it). */}
			<Pressable
				onPress={() => router.back()}
				hitSlop={6}
				accessibilityLabel="Back"
				accessibilityRole="button"
				style={({ pressed }) => ({
					position: "absolute",
					top: insets.top + 8,
					left: 12,
					height: 44,
					flexDirection: "row",
					alignItems: "center",
					gap: 6,
					paddingHorizontal: 12,
					borderRadius: 24,
					backgroundColor: theme.colors.backgroundTranslucent,
					borderWidth: 1,
					borderColor: theme.colors.border,
					opacity: pressed ? 0.7 : 1,
				})}
			>
				<Ionicons
					name="chevron-back"
					size={18}
					color={theme.colors.text}
				/>
				<Text
					style={{
						fontSize: 14,
						fontWeight: "600",
						color: theme.colors.text,
					}}
				>
					Back
				</Text>
			</Pressable>
		</View>
	);
}

// ── Local primitives ─────────────────────────────────────────────────────
// Kept inline (rather than added to Primitives.tsx) so the settings screen
// is fully self-contained and the shared module doesn't grow with one-off
// styles.

interface FormGroupProps {
	label: string;
	hint?: string;
	optional?: boolean;
	children: React.ReactNode;
}

function FormGroup({ label, hint, optional, children }: FormGroupProps) {
	const { theme } = useUnistyles();
	return (
		<View style={{ marginBottom: 18 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "baseline",
					marginBottom: 8,
				}}
			>
				<Text
					style={{
						fontSize: 13,
						fontWeight: "700",
						letterSpacing: 0.4,
						textTransform: "uppercase",
						color: theme.colors.textSecondary,
					}}
				>
					{label}
				</Text>
				{optional ? (
					<Text
						style={{
							marginLeft: 6,
							fontSize: 12,
							color: theme.colors.textTertiary,
						}}
					>
						· optional
					</Text>
				) : null}
			</View>
			{children}
			{hint ? (
				<Text
					style={{
						marginTop: 6,
						fontSize: 12,
						color: theme.colors.textTertiary,
						lineHeight: 16,
					}}
				>
					{hint}
				</Text>
			) : null}
		</View>
	);
}

interface TextFieldProps {
	value: string;
	onChangeText: (v: string) => void;
	placeholder?: string;
	focused: boolean;
	onFocus: () => void;
	onBlur: () => void;
	secureTextEntry?: boolean;
	autoCapitalize?: "none" | "sentences" | "words" | "characters";
	autoCorrect?: boolean;
	keyboardType?: "default" | "url" | "email-address";
}

function TextField({
	value,
	onChangeText,
	placeholder,
	focused,
	onFocus,
	onBlur,
	secureTextEntry,
	autoCapitalize,
	autoCorrect,
	keyboardType,
}: TextFieldProps) {
	const { theme } = useUnistyles();
	return (
		<View
			style={{
				borderRadius: 14,
				borderWidth: 1,
				borderColor: focused
					? theme.colors.borderFocus
					: theme.colors.border,
				backgroundColor: theme.colors.backgroundInput,
				paddingHorizontal: 14,
				paddingVertical: 10,
			}}
		>
			<TextInput
				value={value}
				onChangeText={onChangeText}
				onFocus={onFocus}
				onBlur={onBlur}
				placeholder={placeholder}
				placeholderTextColor={theme.colors.textPlaceholder}
				secureTextEntry={secureTextEntry}
				autoCapitalize={autoCapitalize}
				autoCorrect={autoCorrect}
				keyboardType={keyboardType}
				style={{
					fontSize: 15,
					color: theme.colors.text,
					paddingVertical: 4,
				}}
			/>
		</View>
	);
}

interface HelpStepProps {
	n: number;
	text: string;
}

function HelpStep({ n, text }: HelpStepProps) {
	const { theme } = useUnistyles();
	return (
		<View style={{ flexDirection: "row", alignItems: "flex-start" }}>
			<View
				style={{
					width: 20,
					height: 20,
					borderRadius: 10,
					alignItems: "center",
					justifyContent: "center",
					marginRight: 8,
					marginTop: 1,
					backgroundColor: theme.colors.backgroundTertiary,
				}}
			>
				<Text
					style={{
						fontSize: 11,
						fontWeight: "700",
						color: theme.colors.textSecondary,
					}}
				>
					{n}
				</Text>
			</View>
			<Text
				style={{
					flex: 1,
					fontSize: 13,
					lineHeight: 20,
					color: theme.colors.textSecondary,
				}}
			>
				{text}
			</Text>
		</View>
	);
}
