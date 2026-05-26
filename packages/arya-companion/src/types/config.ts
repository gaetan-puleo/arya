/**
 * Persisted WS connection settings. Stored in AsyncStorage under a
 * single key (see services/wsConfig.ts).
 */
export interface WsConfig {
	url: string;
	token?: string;
}
