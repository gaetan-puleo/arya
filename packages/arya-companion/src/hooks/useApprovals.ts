/**
 * Approval snapshots + respond action.
 */

import { useCallback } from "react";
import * as Haptics from "expo-haptics";
import * as arya from "@/services/aryaClient";
import { useStore } from "@/state/store";

export function useApprovals() {
	const approvals = useStore((s) => s.approvals);

	const respond = useCallback(
		(approvalId: string, action: "approve" | "deny") => {
			const snap = useStore.getState().approvals.get(approvalId);
			if (!snap || snap.status !== "pending") return;
			Haptics.notificationAsync(
				action === "approve"
					? Haptics.NotificationFeedbackType.Success
					: Haptics.NotificationFeedbackType.Warning,
			);
			arya.respondApproval(approvalId, action);
		},
		[],
	);

	return { approvals, respond };
}
