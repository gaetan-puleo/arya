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

Run from source (needs [Deno](https://deno.com/); mu is pulled from npm automatically):

```bash
deno task arya:serve     # run the server
deno task arya:tui       # run the TUI
deno task compile        # build standalone binaries into dist/
```

Pushing a `v*` tag runs `.github/workflows/release.yml`, which builds the binaries `install.sh` pulls from.

## License

MIT
