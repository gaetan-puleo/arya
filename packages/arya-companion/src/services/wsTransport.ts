/**
 * Reconnecting WebSocket transport.
 *
 * Returns a `dispose` function that closes the current socket, cancels
 * the pending reconnect timer, and prevents further reconnect attempts.
 *
 * Pure side-effect layer — knows nothing about the arya wire protocol.
 *
 * `onSocket` is invoked *synchronously* after `new WebSocket(...)`, so
 * callers can attach `open`/`close`/`message` listeners before the
 * runtime has a chance to dispatch any of them. Some RN polyfills
 * dispatch `open` synchronously during construction; attaching the
 * handlers from the next microtask would miss that first event.
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
	/** Current socket, or null if not yet connected / between attempts. */
	getSocket: () => WebSocket | null;
}

/**
 * Exponential backoff with full jitter.
 *   base = 500ms, factor = 2, cap = 30s
 */
function backoffDelayMs(attempt: number): number {
	const base = 500;
	const cap = 30_000;
	const exp = Math.min(cap, base * 2 ** attempt);
	// Full jitter: random value in [0, exp].
	return Math.floor(Math.random() * exp);
}

export function createReconnectingSocket(
	url: string,
	token: string | undefined,
	onSocket: (socket: WebSocket) => void,
): ReconnectingSocket {
	let disposed = false;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let currentSocket: WebSocket | null = null;
	let attempt = 0;

	function scheduleReconnect(): void {
		if (disposed) return;
		if (reconnectTimer !== null) return;
		const delay = backoffDelayMs(attempt);
		attempt += 1;
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			connect();
		}, delay);
	}

	function connect(): void {
		if (disposed) return;
		const socket = new WebSocket(buildWsUrl(url, token));
		currentSocket = socket;

		// Attach baseline reconnect-on-close BEFORE handing the socket to
		// the consumer. The consumer's onSocket() will attach its own
		// `close` listener too; both fire — handlers don't conflict.
		socket.addEventListener("close", () => {
			if (currentSocket === socket) currentSocket = null;
			scheduleReconnect();
		});
		// Reset the backoff counter once the connection actually opens.
		socket.addEventListener("open", () => {
			attempt = 0;
		});

		// Synchronous — caller MUST attach listeners before returning.
		onSocket(socket);
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
		getSocket() {
			return currentSocket;
		},
	};
}
