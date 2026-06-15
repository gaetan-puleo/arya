# arya

llama-swap-backed autonomous agent host. Thin composition layer on top of `mu-harness`: loads agents, skills,
permissions from `~/.config/arya/`, wires in `mu-tools` (filesystem + shell), `mu-webfetch`, and the harness scheduler,
then exposes the harness over `mu-harness`' channel layer (`webSocketAdapter`) so clients — the `arya-companion` app and
the built-in TUI channel — can connect.

CLI:

- `arya` — show help.
- `arya serve` — run the autonomous host (WebSocket server for channels), using `~/.config/arya/config.json` (falls back
  to `<repo>/config.json`). On first run (no/incomplete config) it starts an in-channel setup flow that asks for
  provider/model over the chat and writes the config for you (printing a QR for the companion); relaunch afterward to
  start normally. You can also write the file by hand.
- `arya --channel tui` — interactive TUI **client**. With a complete config it connects to a running `arya serve` at the
  configured host:port (errors if none is up — start `arya serve` first). With no/incomplete config it instead runs the
  first-run setup inside the TUI (hosting or joining a setup server on the port). `--connect ws://host:port` attaches to
  a remote server (token via `ARYA_TOKEN`).
- `arya install <path.ts>` — install a local plugin into the XDG data dir.

The TUI never boots a server — the autonomous host (`arya serve`) owns serving; the TUI only connects (run them as two
processes, or let several TUIs share one server).

Bind defaults to `127.0.0.1`. A non-loopback `wsHost` requires a non-empty `authToken`.
