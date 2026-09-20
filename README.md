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

**3. Configure** — run the terminal setup wizard once:

```bash
arya setup         # interactive wizard → writes ~/.config/arya/config.json
arya setup model   # re-run just the provider/model section
arya setup server  # re-run just the WebSocket section
```

It asks for your provider/endpoint, lists the models the endpoint advertises (pick by number), and sets the
WebSocket port/bind. Press Enter to accept each `[default]`.

**4. Run arya:**

```bash
arya serve         # server for the companion app + TUI clients
arya               # interactive TUI (connects to a running `arya serve`)
```

If config is incomplete, `arya serve`/`arya` tell you to run `arya setup` first.

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

## Browser & PC control (Hermes-style)

Arya can drive your **browser** and your **desktop**. The host stack (WebSocket,
`serveHost`, service, doctor) now lives in **`packages/arya-core`**; the control
tools are `arya-core`'s `browser/`, `pc/` and `vision/` modules, wired into the
`arya` agent by `bootstrap.ts`.

**Model constraint:** the chat model (halogen) has **no vision**. Browser reading is
**structured** (`browser_snapshot` → roles/text/refs, no screenshot needed). For
"what's on screen" questions, `screen_analyze` sends a screenshot to a separate
**vision model** you configure.

### Browser (BrowserProvider → CDP)

Following the Hermes pattern, the browser backend is a **`BrowserProvider`**: it owns
the browser *lifecycle* and hands back a CDP endpoint; the shared `BrowserController`
drives the page. The provider never browses — every backend gets the same `browser_*`
toolset for free. Select one with `browser.provider` (or `ARYA_BROWSER_PROVIDER`);
unset auto-selects.

| Provider | What it does | Setup |
|---|---|---|
| `remote` | Connects to a CDP endpoint you already run (your real, logged-in Chrome). | `cdpUrl` / `ARYA_CDP_URL` |
| `obscura` | Rust headless CDP browser (no Chrome). Local spawn or remote server. | `obscura` on PATH / `OBSCURA_CDP_URL` |
| `local` | Spawns a headless browser per session, owns its teardown. **Works on a bare headless box** — no display server needed. | Chrome on PATH, else auto-downloads `chrome-headless-shell` to `~/.cache/arya/browsers` |

The `local` provider resolves its binary as `ARYA_CHROME_BIN` → system Chrome →
cached `chrome-headless-shell` → **auto-provisioned** `chrome-headless-shell`
(one-time ~120 MB download, no root). Headless Chrome renders without X11/Wayland,
so `browser_*` tools work on a server with no screen out of the box.

```bash
# remote — attach to your real browser:
google-chrome --remote-debugging-port=9222
# config: { "browserProvider": "remote", "cdpUrl": "http://127.0.0.1:9222" }

# local — arya spawns its own headless Chrome:
# config: { "browserProvider": "local" }

# obscura — Rust headless CDP, no Chrome needed:
# config: { "browserProvider": "obscura" }   or   OBSCURA_CDP_URL=http://127.0.0.1:9222
```

Tools: `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`,
`browser_press`, `browser_scroll`, `browser_screenshot`, `browser_back`,
`browser_tabs`, `browser_new_tab`, `browser_select_tab`.

### Desktop (keyboard / mouse / windows / launch / screenshot)

Arya auto-detects the display server and backend. Install what matches your session:

| Need | X11 | Wayland |
|---|---|---|
| keyboard + mouse | `xdotool` | `wtype` (kbd) / `ydotool` (kbd+mouse) |
| windows | `wmctrl` | (limited) |
| screenshot | `scrot` / `maim` / `import` | `grim` |

Tools: `pc_env`, `pc_key`, `pc_type`, `pc_mouse_move`, `pc_click`, `pc_scroll`,
`pc_window_list`, `pc_window_focus`, `pc_launch`, `pc_screenshot`. Each reports a
clear error if its binary is missing.

### Vision on demand

Point `screen_analyze` at a vision-capable model (any OpenAI-compatible endpoint):

```bash
export ARYA_VISION_BASE_URL=http://host:port/v1
export ARYA_VISION_MODEL=some-vision-model
export ARYA_VISION_API_KEY=...
```

Without it, `screen_analyze` says so and the agent falls back to structured reads.

### Safety

Read-only tools (`*_snapshot`, `*_list`, `pc_env`, `*_screenshot`, `screen_analyze`)
are `allow`; every mutating tool (click/type/key/launch/navigate…) is `ask` — the
companion prompts you before it acts. Grants live in `packages/arya/src/default-agents.ts`.

## Kanban task board

Arya keeps a **kanban board of tasks for agents**, backed by a directory of
per-task YAML files (`definitions/tasks/*.yaml`, or `tasksDir`). Both humans and
agents drive it: edit files by hand (picked up via reload) or let agents manage
their own work through the `task_*` tools. Every mutation is persisted and
broadcast to WS clients as a `task_event`, so board views stay in sync.

**Columns (status):** `backlog` → `todo` → `in_progress` → `in_review` → `done`.
**Priority:** `low` · `normal` · `high` · `urgent`.

Task shape:

```yaml
id: build-kanban-view-pyeu
title: Build kanban view
status: in_progress
assignee: arya
priority: high
notes: optional detail
createdAt: 2026-09-17T07:34:32.114Z
updatedAt: 2026-09-17T07:34:32.117Z
```

Tools: `task_create`, `task_list` (filter by status/assignee), `task_get`,
`task_update` (title/assignee/priority/notes), `task_move` (change column).
Read tools are `allow`; create/update/move are `ask`.

Wire: `task_event` frames (`created` / `updated` / `moved` / `removed`) carry the
`WireTask` plus the `previous` state, so a client can animate a card between
columns. The store + wire protocol live in `packages/arya-core/src/tasks/`; the
view (TUI `/board`, companion, or web) is built on top of that contract.

## Admin dashboard

Arya can serve a self-contained **admin dashboard** (HTTP + a dedicated `/admin`
WebSocket) for managing the kanban board and creating sub-agents. Enable it with
`adminPort` (or `ARYA_ADMIN_PORT`); it's off otherwise.

```bash
export ARYA_ADMIN_PORT=8732
# config: { "adminPort": 8732 }
# then open:  http://<host>:8732/?token=<arya authToken>
```

**Auth** reuses the shared `authToken`: both the page and the `/admin` socket
require `?token=<authToken>` (mismatch → 401 / WS close). No separate credential.

What it does:
- **Kanban** — live board (5 columns) synced via `task_event`; create, move (◀/▶),
  and priority/assignee. Same store the agent drives via `task_*` tools.
- **Sub-agents** — list existing definitions and create new ones; the form writes a
  `definitions/agents/<name>.md` (YAML frontmatter + prompt), hot-reloaded by the
  definition watcher.

The dashboard is a single vanilla-JS HTML document bundled into the binary (no
static-asset pipeline). The admin surface lives in `packages/arya-core/src/admin/`
and is kept separate from the chat WS.

## License

MIT
