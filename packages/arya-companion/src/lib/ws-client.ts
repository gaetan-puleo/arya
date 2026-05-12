/**
 * Disposable auto-reconnecting WebSocket.
 *
 * `createReconnectingSocket` returns a `dispose` function that:
 *   - closes the current socket
 *   - cancels any pending reconnect timer
 *   - prevents further reconnect attempts
 *
 * This fixes the leak where closing the store's socket left an orphaned
 * `setTimeout` that would reopen a connection after 3s.
 */

function buildWsUrl(url: string, token?: string): string {
	const wsUrl = url.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
	const params = token
		? `${wsUrl.includes("?") ? "&" : "?"}token=${token}`
		: "";
	return `${wsUrl}${params}`;
}

export interface ReconnectingSocket {
	/** Dispose: close the socket and cancel any pending reconnect. */
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

	function connect() {
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
