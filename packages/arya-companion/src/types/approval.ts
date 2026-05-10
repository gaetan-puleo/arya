export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalData {
	msgId: string;
	requestId: string;
	token: string;
	toolName: string;
	toolArgs: string | undefined;
	status: ApprovalStatus;
}
