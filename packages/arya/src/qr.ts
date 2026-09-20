// Connection QR for the arya companion. `arya serve` prints this so the phone can
// scan it (Settings → Scan QR) instead of typing the URL/token by hand. The payload
// is a JSON blob the companion parses into its wsConfig: {"url":"ws://…","token"?:…}.

import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';

/** Best-effort LAN IPv4 so a phone on the same network can reach the host. */
export function lanIp(): string {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return '127.0.0.1';
}

export interface ConnectInfo {
  url: string;
  token?: string;
}

/** The JSON the companion scanner ingests. */
export function connectPayload(info: ConnectInfo): string {
  return JSON.stringify(info.token ? { url: info.url, token: info.token } : { url: info.url });
}

/** Print a scannable QR (JSON payload) plus the URL as a fallback.
 * The token is carried by the QR only — never printed in plain text, so it
 * doesn't leak into terminal scrollback or (under systemd) journalctl. For
 * manual entry, read it from the config file. */
export async function printConnectQr(info: ConnectInfo, out: (line: string) => void = console.log): Promise<void> {
  let qr = '';
  try {
    qr = await QRCode.toString(connectPayload(info), { type: 'terminal', small: true });
  } catch {
    qr = '(could not render QR — enter the URL manually and read the token from the config file)';
  }
  out('');
  out('Scan with the arya companion (Settings → Scan QR):');
  out(qr);
  out(`  URL:   ${info.url}`);
  out('');
}
