# Arya — Local Configuration

All runtime configuration lives in `config.json`
(`~/.config/arya/config.json` by default). Edit it directly — there are no
environment-variable overrides for runtime config. Environment variables are
reserved for plugin integrations only (see `.env.example`).

Required fields are validated at boot; arya refuses to start if any are
missing (see `bootstrap.ts:loadConfig`).

## Fields

| `config.json` key | Description | Default |
|---|---|---|
| `baseUrl` | OpenAI-compatible API endpoint | `http://localhost:11434/v1` |
| `model` | Model name advertised by your provider | `qwen2.5-coder:7b` |
| `maxTokens` | Max tokens per response | `4096` |
| `temperature` | Sampling temperature | `0.7` |
| `streamTimeoutMs` | Inactivity timeout for streaming | `60000` |
| `wsPort` | Companion WebSocket port | `3001` |
| `authToken` | Token required by companion (empty = none) | _(none)_ |

## llama-swap setup

llama-swap exposes an OpenAI-compatible API. Point `baseUrl` at the host
running llama-swap, **including the `/v1` suffix**:

```json
{
  "baseUrl": "http://<llama-swap-host>:8080/v1",
  "model": "<the-model-id-as-known-to-llama-swap>"
}
```

- Replace `<llama-swap-host>` with the IP/hostname of the machine running
  llama-swap (e.g. `<host>` on LAN, or its Tailscale IP).
- The default llama-swap port is `8080`. Change to whatever `--listen` value
  you used.
- `model` must match an entry in your llama-swap `config.yaml` (the key
  under `models:`), **not** the underlying GGUF filename.

## Quick verify

From this machine, test that the LLM endpoint is reachable:

```bash
curl -sS http://<llama-swap-host>:8080/v1/models | jq .
```

You should see a list including the `model` you set above. If this fails,
arya will respond to companion chats with `[ws] server error: Connection error.`.

## Companion connection

The companion app connects via WebSocket on `wsPort` (default `3001`).
Configure the URL inside the companion's Settings screen, e.g.
`ws://<this-machine-ip>:3001`. If you set `authToken`, paste the same
value in the companion's "Token" field.
