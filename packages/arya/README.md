# arya

llama-swap-backed autonomous agent host. Thin composition layer on top of
`mu-harness`: loads agents, skills, permissions from `~/.config/arya/`, wires in
`mu-tools` (filesystem + shell), `mu-webfetch`, and the harness scheduler, then
exposes the harness over `mu-harness`' channel layer (`webSocketAdapter`) so
clients — the `arya-companion` app and the built-in TUI channel — can connect.

CLI:

- `arya` — show help.
- `arya serve` — run the autonomous host (WebSocket server for channels), using
  `~/.config/arya/config.json` (falls back to `<repo>/config.json`). Create this
  file yourself; arya does not generate one.
- `arya --channel tui` — interactive TUI: boots a server in-process, then
  connects to it as a WebSocket client. `--connect ws://host:port` attaches to an
  already-running `arya serve` instead (a separate process; pass a token via
  `ARYA_TOKEN`).
- `arya install <path.ts>` — install a local plugin into the XDG data dir.

The harness is used two ways — same process (`--channel tui` boots + connects
locally) or a separate process (`--connect` to a remote host). The TUI is always
a channel client; the autonomous host never renders a TUI directly.

Bind defaults to `127.0.0.1`. A non-loopback `wsHost` requires a non-empty
`authToken`.
