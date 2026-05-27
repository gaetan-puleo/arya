# arya

llama-swap-backed coding agent exposed over WebSocket. Thin composition
layer on top of `mu-harness`: loads agents, skills, permissions from
`~/.config/arya/`, wires in `mu-tools` (filesystem + shell), `mu-webfetch`,
and the harness scheduler, then serves the runtime to a single WebSocket
client (typically `arya-companion`).

CLI:

- `arya` — start the server using `~/.config/arya/config.json`
  (falls back to `<repo>/config.json`).
- `arya init` — write the default config template.
- `arya install <npm:spec | path.ts>` — install a plugin into the XDG
  data dir.

Bind defaults to `127.0.0.1`. A non-loopback `wsHost` requires a non-empty
`authToken`.
