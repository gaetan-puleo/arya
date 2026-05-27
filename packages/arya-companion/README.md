# arya-companion

Expo / React Native client for an `arya` server. Connects over WebSocket,
streams assistant replies, surfaces approval prompts, and shows live
sub-agent activity.

Scripts:

- `expo start` (alias `pnpm start`) — Metro dev server.
- `expo start --clear` (`pnpm dev`) — same, with cleared cache.
- `expo run:ios` / `expo run:android` — native builds.

Routing is Expo Router. UI primitives are NativeWind (Tailwind). WebSocket
endpoint and auth token are configured from the in-app Settings screen and
persisted via `@react-native-async-storage/async-storage`.
