import { useEffect, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useUnistyles } from "@/theme/ThemeContext";
import {
	Card,
	HelpSection,
	IconButton,
	InputField,
	ResetButton,
	SaveButton,
	SectionLabel,
} from "@/components/Primitives";

const WS_STORAGE_KEY = "arya-companion-ws";

interface WsConfig {
	url: string;
	token?: string;
}

const DEFAULT_CONFIG: WsConfig = { url: "ws://<host>:<port>" };

export default function ConfigScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const [url, setUrl] = useState(DEFAULT_CONFIG.url);
	const [token, setToken] = useState("");
	const [saved, setSaved] = useState<WsConfig | null>(null);
	const [saving, setSaving] = useState(false);
	const { theme } = useUnistyles();

	const bg = theme.colors.background;
	const bgSecondary = theme.colors.backgroundSecondary;
	const borderColor = theme.colors.border;
	const successColor = theme.colors.success;
	const textColor = theme.colors.text;
	const textSecondary = theme.colors.textSecondary;

	useEffect(() => {
		loadConfig();
	}, []);

	const loadConfig = async () => {
		try {
			const stored = await AsyncStorage.getItem(WS_STORAGE_KEY);
			if (stored) {
				const parsed = JSON.parse(stored);
				setUrl(parsed.url || DEFAULT_CONFIG.url);
				setToken(parsed.token || "");
				setSaved(parsed);
			}
		} catch {
			// use defaults
		}
	};

	const handleSave = async () => {
		if (!url.trim()) {
			Alert.alert("L'URL WebSocket est requise");
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
			Alert.alert("Configuration mise à jour. Redémarre l'app pour reconnecter.");
		} catch {
			Alert.alert("Impossible de sauvegarder");
		} finally {
			setSaving(false);
		}
	};

	const handleReset = async () => {
		await AsyncStorage.removeItem(WS_STORAGE_KEY);
		setUrl(DEFAULT_CONFIG.url);
		setToken("");
		setSaved(null);
		Alert.alert("Configuration réinitialisée");
	};

	return (
		<View style={{ flex: 1, backgroundColor: bg }}>
			<Stack.Screen
				options={{
					headerShown: true,
					headerBackTitle: "Chat",
					headerTintColor: textColor,
					headerStyle: { backgroundColor: bgSecondary },
					headerLeft: () => (
						<IconButton name="arrow-back" onPress={() => router.back()} />
					),
				}}
			/>

			<ScrollView
				style={{ flex: 1 }}
				contentContainerStyle={{
					paddingTop: 16,
					paddingBottom: insets.bottom + 24,
				}}
			>
				<View style={{ padding: 20 }}>
					<Text
						style={{
							fontSize: 28,
							fontWeight: "700",
							color: textColor,
							marginBottom: 24,
						}}
					>
						Configuration
					</Text>

					{/* URL Section */}
					<SectionLabel>URL WebSocket</SectionLabel>
					<InputField
						value={url}
						onChangeText={setUrl}
						placeholder="ws://<host>:<port>"
						helperText="L'URL du serveur Companion WebSocket"
					/>

					{/* Token Section */}
					<SectionLabel style={{ marginTop: 16 }}>Token (optionnel)</SectionLabel>
					<InputField
						value={token}
						onChangeText={setToken}
						placeholder="Token de connexion"
						secureTextEntry
						helperText="Si le serveur est protégé par un token (COMPANION_TOKEN)"
					/>

					<SaveButton
						label="Sauvegarder"
						loading={saving}
						onPress={handleSave}
					/>

					{/* Saved Config */}
					{saved && (
						<Card
							style={{
								backgroundColor: "rgba(46,213,115,0.08)",
								borderColor: "rgba(46,213,115,0.2)",
								marginBottom: 16,
							}}
						>
							<SectionLabel style={{ marginBottom: 12, color: successColor }}>
								Configuration actuelle
							</SectionLabel>
							<View style={{ flexDirection: "row", marginBottom: 6 }}>
								<Text
									style={{
										fontSize: 14,
										fontWeight: "600",
										color: textSecondary,
										width: 60,
									}}
								>
									URL :
								</Text>
								<Text
									numberOfLines={2}
									style={{ fontSize: 14, color: textColor, flex: 1 }}
								>
									{saved.url}
								</Text>
							</View>
							<View style={{ flexDirection: "row" }}>
								<Text
									style={{
										fontSize: 14,
										fontWeight: "600",
										color: textSecondary,
										width: 60,
									}}
								>
									Token :
								</Text>
								<Text style={{ fontSize: 14, color: textColor }}>
									{saved.token ? "••••••••" : "(aucun)"}
								</Text>
							</View>
						</Card>
					)}

					<ResetButton onPress={handleReset} />

					<HelpSection title="Comment connecter Arya">
						<Text
							style={{
								fontSize: 14,
								color: textSecondary,
								lineHeight: 22,
								marginBottom: 8,
							}}
						>
							1. D&eacute;marre Arya avec les variables d{'\u2019'}environnement :
						</Text>
						<View
							style={{
								backgroundColor: theme.colors.backgroundInput,
								borderRadius: 10,
								padding: 12,
								marginBottom: 12,
							}}
						>
							<Text style={{ fontSize: 13, color: textColor, lineHeight: 22 }}>
								COMPANION_PORT=3001 \{'\n'}COMPANION_TOKEN=monsecret
							</Text>
						</View>
						<Text
							style={{
								fontSize: 14,
								color: textSecondary,
								lineHeight: 22,
								marginBottom: 8,
							}}
						>
							2. Note l{'\u2019'}URL affichée dans la console
						</Text>
						<Text
							style={{ fontSize: 14, color: textSecondary, lineHeight: 22 }}
						>
							3. Colle-la dans le champ URL ci-dessus
						</Text>
					</HelpSection>
				</View>
			</ScrollView>
		</View>
	);
}
