import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Floating "Chat" FAB anchored to the bottom-right of the sessions
 * drawer. White background with a dark icon + label so it pops as the
 * primary action against the panel.
 */
export default function NewChatFab({ onPress }: { onPress: () => void }) {
	const insets = useSafeAreaInsets();
	return (
		<Pressable
			onPress={() => {
				Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
				onPress();
			}}
			accessibilityLabel="New chat"
			accessibilityRole="button"
			className="absolute right-4 flex-row items-center gap-2 pl-5 pr-6 h-14 rounded-full bg-white active:opacity-90"
			style={{
				// Absolute positioning ignores the parent's paddingBottom,
				// so we add the inset manually here. Otherwise the FAB
				// would overlap the iOS home indicator / Android nav bar.
				bottom: insets.bottom + 16,
				shadowColor: "#000",
				shadowOffset: { width: 0, height: 4 },
				shadowOpacity: 0.18,
				shadowRadius: 10,
				elevation: 6,
			}}
		>
			{/* Each child is wrapped in a fixed-height centering box so
			    its glyph is justified inside an identical bounding box.
			    Without this, RN's flex `alignItems:center` aligns the
			    *bounding boxes* — but Ionicons glyphs sit pixel-centered
			    while text glyphs are positioned by font metrics, leading
			    to a subtle 1–2px vertical mismatch. Forcing both
			    children into the same 22px tall box and centering each
			    glyph inside removes that ambiguity. */}
			<View className="h-[22px] justify-center items-center">
				<Ionicons name="create-outline" size={22} color="#000000" />
			</View>
			<View className="h-[22px] justify-center">
				<Text
					className="text-base font-bold text-black"
					style={{
						// Android-only quirks: includeFontPadding adds extra
						// space above/below glyphs by default, and
						// textAlignVertical needs to be set explicitly for
						// centering inside a height-constrained box.
						includeFontPadding: false,
						textAlignVertical: "center",
					}}
				>
					Chat
				</Text>
			</View>
		</Pressable>
	);
}
