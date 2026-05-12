/**
 * Shared WebSocket utilities: URL coercion + auto-reconnecting socket.
 *
 * Callers attach their own `message` listeners on the returned socket
 * (via `socket.addEventListener`); the reconnect loop creates a new
 * socket on close and invokes `onSocket` so the consumer can re-bind.
 */

function buildWsUrl(url: string, token?: string): string {
	const wsUrl = url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
	const params = token
		? `${wsUrl.includes("?") ? "&" : "?"}token=${token}`
		: "";
	return `${wsUrl}${params}`;
}

export function createReconnectingSocket(
	url: string,
	token: string | undefined,
	onSocket: (socket: WebSocket) => void,
): WebSocket {
	const socket = new WebSocket(buildWsUrl(url, token));
	onSocket(socket);

	socket.onclose = () => {
		setTimeout(() => {
			if (socket.readyState !== WebSocket.OPEN) {
				createReconnectingSocket(url, token, onSocket);
			}
		}, 3000);
	};

	return socket;
}
