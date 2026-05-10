import Ionicons from "@expo/vector-icons/Ionicons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useUnistyles } from "@/theme/ThemeContext";

const WS_STORAGE_KEY = "arya-companion-ws";

export default function ScanScreen() {
	const insets = useSafeAreaInsets();
	const router = useRouter();
	const { theme } = useUnistyles();
	const [permission, requestPermission] = useCameraPermissions();
	const [scanned, setScanned] = useState(false);
	const hasProcessed = useRef(false);

	const textColor = theme.colors.text;
	const bg = theme.colors.background;

	const handleBarCodeScanned = async ({ data }: { data: string }) => {
		if (hasProcessed.current) return;
		hasProcessed.current = true;
		setScanned(true);

		try {
			const parsed = JSON.parse(data);
			if (!parsed.url) {
				Alert.alert("QR invalide", "Le QR code ne contient pas d'URL WebSocket.");
				hasProcessed.current = false;
				setScanned(false);
				return;
			}

			const cfg = {
				url: parsed.url,
				token: parsed.token || undefined,
			};

			await AsyncStorage.setItem(WS_STORAGE_KEY, JSON.stringify(cfg));

			Alert.alert(
				"Connexion configurée",
				`URL: ${cfg.url}\nRedémarre l'app pour connecter.`,
				[{ text: "OK", onPress: () => router.back() }],
			);
		} catch {
			Alert.alert(
				"QR invalide",
				"Format attendu : {\"url\": \"ws://...\", \"token\": \"...\"}",
			);
			hasProcessed.current = false;
			setScanned(false);
		}
	};

	if (!permission) {
		return <View style={[styles.container, { backgroundColor: bg }]} />;
	}

	if (!permission.granted) {
		return (
			<View
				style={{
					flex: 1,
					backgroundColor: bg,
					alignItems: "center",
					justifyContent: "center",
					paddingHorizontal: 40,
					gap: 16,
				}}
			>
				<Ionicons name="camera-outline" size={48} color={textColor} />
				<Text
					style={{
						fontSize: 16,
						color: textColor,
						textAlign: "center",
						lineHeight: 24,
					}}
				>
					{"L'accès à la caméra est nécessaire pour scanner le QR code."}
				</Text>
				<Pressable
					onPress={requestPermission}
					style={({ pressed }) => ({
						backgroundColor: "#10A37F",
						borderRadius: 12,
						paddingHorizontal: 24,
						paddingVertical: 12,
						opacity: pressed ? 0.8 : 1,
					})}
				>
					<Text style={{ fontSize: 15, fontWeight: "600", color: "#FFFFFF" }}>
						Autoriser la caméra
					</Text>
				</Pressable>
				<Pressable
					onPress={() => router.back()}
					style={({ pressed }) => ({
						backgroundColor: "transparent",
						paddingHorizontal: 16,
						paddingVertical: 8,
						opacity: pressed ? 0.6 : 1,
					})}
				>
					<Text style={{ fontSize: 14, color: textColor }}>Retour</Text>
				</Pressable>
			</View>
		);
	}

	return (
		<View style={[styles.container, { backgroundColor: "#000" }]}>
			<CameraView
				style={StyleSheet.absoluteFillObject}
				facing="back"
				barcodeScannerSettings={{
					barcodeTypes: ["qr"],
				}}
				onBarcodeScanned={scanned ? undefined : handleBarCodeScanned}
			/>

			{/* Overlay */}
			<View style={styles.overlay}>
				{/* Top bar */}
				<View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
					<Pressable
						onPress={() => router.back()}
						style={({ pressed }) => ({
							width: 36,
							height: 36,
							borderRadius: 18,
							backgroundColor: "rgba(0,0,0,0.5)",
							justifyContent: "center",
							alignItems: "center",
							opacity: pressed ? 0.8 : 1,
						})}
					>
						<Ionicons name="close" size={22} color="#FFFFFF" />
					</Pressable>
				</View>

				{/* Center guide */}
				<View style={styles.center}>
					<View style={styles.scanFrame} />
				</View>

				{/* Bottom hint */}
				<View style={[styles.bottomBar, { paddingBottom: insets.bottom + 24 }]}>
					<Text
						style={{
							fontSize: 15,
							color: "#FFFFFF",
							textAlign: "center",
							lineHeight: 22,
						}}
					>
						Scannez le QR code affiché par Arya
					</Text>
				</View>
			</View>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	overlay: {
		...StyleSheet.absoluteFillObject,
		justifyContent: "space-between",
	},
	topBar: {
		paddingHorizontal: 16,
		alignItems: "flex-start",
	},
	center: {
		alignItems: "center",
		justifyContent: "center",
	},
	scanFrame: {
		width: 220,
		height: 220,
		borderWidth: 2,
		borderColor: "rgba(255,255,255,0.6)",
		borderRadius: 20,
	},
	bottomBar: {
		alignItems: "center",
		paddingHorizontal: 40,
	},
});
