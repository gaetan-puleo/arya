/**
 * Shared WebSocket utilities: URL coercion, token params, reconnecting socket.
 */

export function buildWsUrl(url: string, token?: string): string {
	const wsUrl = url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
	const params = token
		? `${wsUrl.includes("?") ? "&" : "?"}token=${token}`
		: "";
	return `${wsUrl}${params}`;
}

export function createReconnectingSocket(
	url: string,
	token: string | undefined,
	onMessage: (data: unknown) => void,
): WebSocket {
	const wsUrl = buildWsUrl(url, token);
	const socket = new WebSocket(wsUrl);

	socket.onmessage = (e) => {
		try {
			const msg = JSON.parse(e.data);
			onMessage(msg);
		} catch {
			// ignore
		}
	};

	socket.onclose = () => {
		setTimeout(() => {
			if (socket.readyState !== WebSocket.OPEN) {
				createReconnectingSocket(url, token, onMessage);
			}
		}, 3000);
	};

	return socket;
}
