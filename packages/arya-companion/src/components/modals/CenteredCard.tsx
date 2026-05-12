import { Modal, Pressable } from "react-native";

/**
 * Centered modal shell shared by the rename + confirmation dialogs.
 *
 * Renders a faded backdrop (tap-to-dismiss) and a gray card with the
 * uniform `bg-bg-tertiary` surface used across the in-app modal
 * stack. The inner Pressable swallows touches so a tap on the card
 * itself doesn't bubble up and close the modal.
 */
export default function CenteredCard({
	open,
	onClose,
	children,
}: {
	open: boolean;
	onClose: () => void;
	children: React.ReactNode;
}) {
	return (
		<Modal
			visible={open}
			transparent
			animationType="fade"
			onRequestClose={onClose}
		>
			<Pressable
				onPress={onClose}
				className="flex-1 bg-bg-overlay items-center justify-center p-6"
			>
				<Pressable
					onPress={() => {}}
					className="w-full max-w-[340px] bg-bg-tertiary rounded-card p-4 gap-3"
				>
					{children}
				</Pressable>
			</Pressable>
		</Modal>
	);
}
