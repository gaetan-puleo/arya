# arya-agent

A local autonomous agent and assistant backed by [llama-swap](https://github.com/mostlygeek/llama-swap), served over
WebSocket and built on **mu**. Runs as a terminal TUI or as a server for the companion app.

- **`packages/arya`** — the server (agent sessions, sub-agents, tools, scheduler, WebSocket transport).
- **`packages/arya-companion`** — the Expo/React Native mobile client.

## Quick start

**1. Install** — a self-contained binary, no runtime dependencies:

```bash
curl -fsSL https://raw.githubusercontent.com/gaetan-puleo/arya/main/install.sh | sh
```

Installs the latest `arya` to `~/.local/bin` (override with `ARYA_INSTALL_DIR`). On Windows, grab
`arya-windows-x64.exe` from the [releases page](https://github.com/gaetan-puleo/arya/releases).

**2. Run a model backend** — arya needs a [llama-swap](https://github.com/mostlygeek/llama-swap) server with at least
one model loaded.

**3. Run arya:**

```bash
arya serve         # server for the companion app + TUI clients
arya               # interactive TUI (connects to a running `arya serve`)
```

On first launch with no config, arya walks you through a setup Q&A and writes `~/.config/arya/config.json`.

## Development

pnpm workspace (Node >= 24; mu is pulled from npm automatically):

```bash
pnpm install         # install workspace deps (server + companion app)
pnpm dev             # run the server from source (tsx)
pnpm tui             # run the TUI client
pnpm test            # vitest
pnpm check           # type-check (tsc)
pnpm compile         # cross-compile standalone binaries into dist/
pnpm app:start       # start the companion (Expo) dev server
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the binaries `install.sh` pulls from.

## License

MIT
