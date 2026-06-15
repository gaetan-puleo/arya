# Arya — Local Configuration

All runtime configuration lives in `config.json` (`~/.config/arya/config.json` by default). Edit it directly — there are
no environment-variable overrides for runtime config. Environment variables are reserved for plugin integrations only.

Required fields are validated at boot; arya refuses to start if any are missing (see `bootstrap.ts:loadConfig`).

## Fields

| `config.json` key     | Description                                                                                                                                                                                                                                      | Default                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------- |
| `baseUrl`             | OpenAI-compatible API endpoint                                                                                                                                                                                                                   | `http://localhost:11434/v1` |
| `model`               | Model name advertised by your provider (**required**)                                                                                                                                                                                            | `qwen2.5-coder:7b`          |
| `kind`                | Provider backend kind passed to `mu-local-provider` (e.g. `llama-swap`)                                                                                                                                                                          | _(none)_                    |
| `apiKey`              | API key/token for the provider endpoint, if it requires one                                                                                                                                                                                      | _(none)_                    |
| `wsPort`              | Companion/TUI WebSocket port (**required**)                                                                                                                                                                                                      | _(none)_                    |
| `wsHost`              | Bind address. A non-loopback value (e.g. `0.0.0.0`) requires a non-empty `authToken`                                                                                                                                                             | `127.0.0.1`                 |
| `authToken`           | Token required by companion/TUI clients (empty = none, allowed only on a loopback bind)                                                                                                                                                          | _(none)_                    |
| `primaryAgent`        | Name of the agent supplying the primary system prompt; the rest are reachable as sub-agents                                                                                                                                                      | _(built-in `arya`)_         |
| `agentsDir`           | Directory of agent definition files                                                                                                                                                                                                              | `<cwd>/definitions/agents`  |
| `tasksDir`            | Directory of scheduled-task YAML files                                                                                                                                                                                                           | `<cwd>/definitions/tasks`   |
| `capabilities.vision` | Model accepts image input (enables paste-an-image)                                                                                                                                                                                               | `false`                     |
| `capabilities.audio`  | Model accepts audio input                                                                                                                                                                                                                        | `false`                     |
| `voiceModel`          | Speech-to-text model for voice input (sent the recorded audio): the TUI's `/voice`/`/call` and the companion's call mode. Falls back to the selected model when unset; if that model has no audio support, voice reports it instead of recording | _(selected model)_          |
| `chatTemplateKwargs`  | Extra `chat_template_kwargs` merged into the **main** chat model's requests (not the voice model), forwarded verbatim — e.g. `{ "enable_thinking": false }` to disable Qwen3 reasoning                                                           | _(none)_                    |

## Multimodal (image + audio)

Image/audio attachments (paste-an-image in the TUI/companion) are **off by default** and only work when the configured
model actually accepts them. Opt in explicitly — arya advertises the capability to clients, which gate their attach
affordances and drop unsupported attachments with a clear message:

```json
{
  "baseUrl": "http://<vision-model-host>:8080/v1",
  "model": "<a-vision-capable-model>",
  "capabilities": { "vision": true }
}
```

In the **companion** app, an image button appears next to the composer when `vision` is on — it pastes the current
clipboard image. In the **TUI**, Ctrl+V (or pasting an image-file path) attaches it; Linux needs `wl-clipboard`
(Wayland) or `xclip` (X11) installed to read clipboard images.

## llama-swap setup

llama-swap exposes an OpenAI-compatible API. Point `baseUrl` at the host running llama-swap, **including the `/v1`
suffix**:

```json
{
  "baseUrl": "http://<llama-swap-host>:8080/v1",
  "model": "<the-model-id-as-known-to-llama-swap>"
}
```

- Replace `<llama-swap-host>` with the IP/hostname of the machine running llama-swap (e.g. `<host>` on LAN, or its
  Tailscale IP).
- The default llama-swap port is `8080`. Change to whatever `--listen` value you used.
- `model` must match an entry in your llama-swap `config.yaml` (the key under `models:`), **not** the underlying GGUF
  filename.

## Quick verify

From this machine, test that the LLM endpoint is reachable:

```bash
curl -sS http://<llama-swap-host>:8080/v1/models | jq .
```

You should see a list including the `model` you set above. If this fails, arya will respond to companion chats with
`[ws] server error: Connection error.`.

## Companion connection

The companion app connects via WebSocket on `wsPort` (default `3001`). Configure the URL inside the companion's Settings
screen, e.g. `ws://<this-machine-ip>:3001`. If you set `authToken`, paste the same value in the companion's "Token"
field.
