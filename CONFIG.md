# Arya — Local Configuration

This file explains `config.json` (and its environment-variable equivalents).
Edit `config.json` directly OR override via environment variables — env vars
take precedence (see `bootstrap.ts:loadConfig`).

## Fields

| `config.json` key | Env var | Description | Default |
|---|---|---|---|
| `baseUrl` | `ARYA_BASE_URL` | OpenAI-compatible API endpoint | `http://localhost:11434/v1` |
| `model` | `ARYA_MODEL` | Model name advertised by your provider | `qwen2.5-coder:7b` |
| `maxTokens` | `ARYA_MAX_TOKENS` | Max tokens per response | `4096` |
| `temperature` | `ARYA_TEMPERATURE` | Sampling temperature | `0.7` |
| `streamTimeoutMs` | `ARYA_STREAM_TIMEOUT_MS` | Inactivity timeout for streaming | `60000` |
| `wsPort` | `ARYA_WS_PORT` | Companion WebSocket port | `3001` |
| `authToken` | `ARYA_COMPANION_TOKEN` | Token required by companion (empty = none) | _(none)_ |

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
