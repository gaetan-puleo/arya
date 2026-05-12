import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

/**
 * Subscribes to keyboard show/hide events and exposes whether the
 * keyboard is open + its measured height. iOS uses the
 * `keyboardWillShow`/`Hide` events (driven by the system animation),
 * Android uses `keyboardDidShow`/`Hide` since `Will*` events aren't
 * emitted reliably there.
 */
export function useKeyboard() {
	const [keyboardOpen, setKeyboardOpen] = useState(false);
	const [keyboardHeight, setKeyboardHeight] = useState(0);

	useEffect(() => {
		const showEvent =
			Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent =
			Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		const showSub = Keyboard.addListener(showEvent, (e) => {
			setKeyboardOpen(true);
			setKeyboardHeight(e.endCoordinates?.height ?? 0);
		});
		const hideSub = Keyboard.addListener(hideEvent, () => {
			setKeyboardOpen(false);
			setKeyboardHeight(0);
		});

		return () => {
			showSub.remove();
			hideSub.remove();
		};
	}, []);

	return { keyboardOpen, keyboardHeight };
}
