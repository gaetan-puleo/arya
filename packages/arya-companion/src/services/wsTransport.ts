/**
 * Reconnecting WebSocket transport.
 *
 * Returns a `dispose` function that closes the current socket, cancels
 * the pending reconnect timer, and prevents further reconnect attempts.
 *
 * Pure side-effect layer — knows nothing about the arya wire protocol.
 */

function buildWsUrl(url: string, token?: string): string {
	const wsUrl = url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
	const params = token
		? `${wsUrl.includes("?") ? "&" : "?"}token=${token}`
		: "";
	return `${wsUrl}${params}`;
}

export interface ReconnectingSocket {
	dispose: () => void;
}

export function createReconnectingSocket(
	url: string,
	token: string | undefined,
	onSocket: (socket: WebSocket) => void,
): ReconnectingSocket {
	let disposed = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let currentSocket: WebSocket | null = null;

	function connect(): void {
		if (disposed) return;
		const socket = new WebSocket(buildWsUrl(url, token));
		currentSocket = socket;
		onSocket(socket);

		socket.onclose = () => {
			if (disposed) return;
			reconnectTimer = setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, 3000);
		};
	}

	connect();

	return {
		dispose() {
			disposed = true;
			if (reconnectTimer !== null) {
				clearTimeout(reconnectTimer);
				reconnectTimer = null;
			}
			currentSocket?.close();
			currentSocket = null;
		},
	};
}
