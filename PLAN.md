# arya-companion — Simplification Plan

> Snapshot of the companion-app refactor: what's been done, what was discovered along the way, and what's worth doing next. Scope is `packages/arya-companion/src/` (~6,400 LOC, 31 files, Expo/React Native).

---

## 1. Context

The companion app started as an Expo Router scaffold and grew organically: chat + sessions + sub-agent timeline + settings. State, gestures, markdown rendering and styling all evolved inline, leading to a few monolithic files and several cross-cutting indirections.

This plan tracks:
- **What we already simplified** (Section 3).
- **What's still expensive** (Section 4).
- **What to do next, by leverage** (Section 5).

The largest cost driver isn't the line count — it's that **state and side-effects (WebSocket, AsyncStorage, modal coordination) are duplicated across screens** rather than living in one app-level owner.

---

## 2. Constraints

- **`components/SessionsLayout.tsx` (307 LOC) is off-limits.** The custom PanResponder + Reanimated parallax-reveal drawer stays untouched.
- **No downgrade of `react-syntax-highlighter`** (v16 → v6) to make the RN-native wrapper work. The existing custom hast renderer in `CodeBlock.tsx` stays.
- Visual UX should not regress without notice. Streaming-fence rendering, approval-card insertion ordering, drawer gestures, and the agent-chip dropdown are user-visible behaviours that must survive any refactor.

---

## 3. What has been simplified (round 1)

All seven steps below pass `tsc --noEmit` + `eslint src/`. The 8th item (syntax highlighter swap) was investigated and dropped — see Section 2.

| # | Change | Files touched | Outcome |
|---|---|---|---|
| 3.1 | Dead code removed | `ChatInputBar`, `Primitives` (IconButton inlined), `useChat` (`hasText` export, `more` button, theme aliasing block) | ~50 LOC removed |
| 3.2 | WebSocket plumbing consolidated | `lib/ws-client.ts`, `lib/ws.ts`, new `lib/sessionWire.ts`, `hooks/useReconnectingSocket.ts` | `createReconnectingSocket` lost the dead `onMessage` arg; `ws.ts` is now pure types; wire-conversion moved out |
| 3.3 | Tiny single-use files inlined | `utils/format.ts` → `[runId].tsx`; `utils/` removed | 1 fewer indirection |
| 3.4 | `FloatingPill` primitive extracted | `Primitives.tsx`, `app/index.tsx`, `app/two.tsx` | 3 duplicated 30-line pressables → 1 component |
| 3.5 | Session modal wrappers merged | `SessionActionsModal.tsx` exports `PromptModal` + `ConfirmModal`; `SessionsDrawer.tsx` consumes them inline | 3 thin wrappers collapsed |
| 3.6 | `useChat` split into focused hooks | New: `useReconnectingSocket`, `useKeyboard`, `useSlashAndAt`, `useAgents`, `useSessionsStore`, `useSubAgentRuns` | Orchestrator: 751 → 413 LOC |
| 3.7 | Markdown renderer replaced | New `MessageMarkdown.tsx`; removed `InlineMarkdown.tsx` + `MarkdownTable.tsx` + `parseCodeBlocks.ts` | 669 LOC → 203 LOC. `fence` rule delegates to themed `CodeBlock`. Streaming-fence handled by `closeOpenFence` helper |
| 3.8 | ~~Replace `react-syntax-highlighter`~~ | — | **Skipped.** RN-native fork peer-depends on v6; v16 path layout differs. Downgrade was off-limits |

### Net LOC

- `src/`: **6,205 → 6,356** (+151 net)
- The total went up because the split-hooks pattern adds ~40 LOC of interface tax per file. But the largest single file went **751 → 413**, and no file is over 700 LOC anymore.
- Cognitive surface area is materially smaller per file, but global indirection went up (refs exported, cooperative dispatch chain). See Section 4.2.

---

## 4. What's still expensive (app-wide complexity audit)

### 4.1 Three independent WebSocket connections 🔴

```
hooks/useReconnectingSocket.ts:5     const WS_KEY = "arya-companion-ws"
app/sub-agent/[runId].tsx:29         const WS_KEY = "arya-companion-ws"
app/two.tsx:19                       const WS_STORAGE_KEY = "arya-companion-ws"
```

- The chat screen opens a socket. The sub-agent detail screen opens a **second** socket to the same backend to receive live `sub_agent_event` pushes. Settings reads/writes the same storage key under a third local name.
- Reconnect/error/log code lives in `useReconnectingSocket` but the detail screen reimplements connection setup with less robust handling (no `commands`/`agents` bootstrap, no error logging).
- Renaming the storage key requires editing 3 files.

**This is the single biggest source of indirection in the app.**

### 4.2 The chat-hook split introduced new cross-file invariants 🟡

The refactor's net effect on indirection is mixed:

| Indirection | Source |
|---|---|
| Sub-hooks expose **refs** (`activeAgentIdRef`, `currentSessionIdRef`) as part of their public API; orchestrator reads them to keep same-tick callers (`send`) coherent | `useAgents`, `useSessionsStore`, consumed by `useChat` |
| Cooperative dispatch: `if (handleMessage(msg)) return` chain — no type-system enforcement of "remember to return true" | `useChat.ts:80–81` |
| `subAgents.handleEvent()` returns `{ insertCardId, agentId }` signal so the orchestrator can insert a message — pure indirection because the hook can't see `messages` state | `useSubAgentRuns` |
| The "set ref synchronously before setState" rule (for `currentSessionId`) now lives in `useSessionsStore`, but `useChat`'s `send` bypasses it once (line ~336) | split across 2 files |

**Known bug introduced:** the `useEffect` at `useChat.ts:254` lists `agentsApi, sessionsApi, subAgents` as deps. Those objects are fresh literals on every render → the WS `message` listener re-attaches per keystroke. Lint passed because the deps are *correctly listed*; the problem is they're unstable.

> Fix: either wrap each sub-hook return in `useMemo`, or revert the orchestrator effect's deps to `[socket]` and read everything else through refs. See 5.A.

### 4.3 Half-built design system 🟡

`theme/themes.ts` defines `spacing[0..20]`, `radius[0..12]`, `fontSizes`, `fontWeights` — **but only ~10 callsites use them** (all in `CodeBlock.tsx`). Every other file hardcodes `paddingHorizontal: 16`, `borderRadius: 24`, `fontSize: 14`.

Consequences:
- The monospace font expression `Platform.OS === "ios" ? "Menlo-Regular" : "monospace"` is duplicated in **4 files** (`CodeBlock`, `MessageMarkdown`, `ApprovalMessage`, `two.tsx`).
- The "pill" shape (`height: 44`, `borderRadius: 24`, etc.) lives both in `FloatingPill` and inline in `SessionsDrawer`'s Settings button.
- The `useUnistyles` name is misleading: `react-native-unistyles` is **not installed**. The hook is two lines of `useContext`.
- Components open with 5–10 lines of `theme.colors.X` destructuring boilerplate. `ChatInputBar` was fixed; `[runId].tsx`, `ApprovalMessage`, `ChatMessage`, `ChatMessageList` still do it.

### 4.4 Four files carry 40 % of the app 🟡

| File | LOC | Why heavy |
|---|---:|---|
| `components/SessionActionsModal.tsx` | 630 | Anchored popover (150 LOC of clamp math) + `CenteredModalCard` shell + `PromptModal` + `ConfirmModal` + `ActionRow` |
| `components/SessionsDrawer.tsx` | 610 | Panel JSX + 4 modal coordinators + `groupByDate` (28 LOC) + `formatRelativeTime` (12 LOC) + inline empty state + FAB |
| `app/two.tsx` | 573 | Settings screen + inline `FormGroup` (51) + `TextField` (45) + `HelpStep` (37) |
| `app/sub-agent/[runId].tsx` | 526 | Screen + inline `TimelineItem` (5-case switch) + `Row`, `RowInner`, `CodeBox`, `StreamingTextBubble` + own WS connection |

The `two.tsx` source even contains a comment defending the choice ("Kept inline … so the settings screen is fully self-contained"). That self-containment is what costs every reader 500 lines of scroll.

### 4.5 Cross-screen state via module global 🟡

`lib/subAgentStore.ts` is a 4-line file:

```ts
export const globalSubAgentEvents = new Map<string, SubAgentEvent[]>();
```

- The chat screen captures every `sub_agent_event` and dumps it into this Map.
- The detail screen replays the Map on mount, then subscribes to its own socket for live events.
- It works, but it's a **cross-screen cache outside React** with no eviction, no subscription, no type-system enforcement of "set before read".

### 4.6 Settings screen UX flaw 🟢

`app/two.tsx`'s Save handler currently tells the user *"Restart the app to reconnect with the new settings"*. The app reads WS config once at mount and never re-reads it. This is a real UX bug, separate from code complexity — auto-fixed once an app-level socket owner exists (5.A).

---

## 5. Next steps, ranked by leverage

### 🔴 Priority A — One app-level state owner

**Why this first:** fixes 4.1, 4.5, and 4.6 in one structural change. Largest leverage in the codebase.

**Goal:** eliminate duplicate sockets, the module-level `globalSubAgentEvents` Map, the 3× `WS_KEY` constant, and the "restart the app" settings flow.

**Approach:**
1. Promote `useReconnectingSocket` + the sub-hooks into a Provider mounted at `app/_layout.tsx`.
2. Expose state via Context **or** a small store (Zustand recommended: ~3 kB, no boilerplate, popular in RN).
3. Sub-agent detail screen reads `subAgentRuns[runId]` and the live event stream from the store — no second socket.
4. Settings screen calls a `reconnect()` action exposed by the store.

**Effort:** medium (~400 LOC churn). **Saves:** ~150 LOC of duplicated WS plumbing; removes 3 cross-cutting indirections.

**Open question:** Context, Zustand, or roll our own? Zustand is the lightest path; Context is zero-dep but verbose; rolling our own is what `globalSubAgentEvents` already half-is.

### 🔴 Priority B — Fix the broken `useEffect` deps

**Why:** known bug introduced by 3.6 (see 4.2). Listener re-attaches per keystroke.

**Options:**

- **B.1** — Memoize each sub-hook's return:
  ```ts
  return useMemo(() => ({ commands, agents, … }), [commands, agents, …]);
  ```
  Apply in `useAgents`, `useSessionsStore`, `useSubAgentRuns`. ~6 LOC each.

- **B.2** — Revert orchestrator effect to `[socket]` only; read everything else through a `latestApisRef` mutable ref.

B.1 is cleaner; B.2 is closer to the pre-refactor mental model. **Likely subsumed by Priority A** if we adopt Zustand (no React-dep array on the message handler at all — it'd be a store-level subscription).

### 🟡 Priority C — Realize the design system

**Why:** fixes 4.3. Doesn't remove LOC but kills inconsistency.

**Approach:**
1. Add to the theme: `chrome.pillHeight: 44`, `chrome.pillRadius: 24`, `chrome.cardRadius: 16`, `fonts.mono` (the Platform.OS ternary).
2. Replace top ~30 hardcoded values across the app with theme references.
3. Decide between hand-rolled `useUnistyles`, NativeWind, or the real `react-native-unistyles`.

**Effort:** small (mechanical churn).

**Open question:** keep hand-rolled, or adopt a library? NativeWind is the obvious choice for Expo SDK 54+ and gives a tailwind-like authoring model; `react-native-unistyles` matches the function name we already use.

### 🟡 Priority D — Reconsider `useSubAgentRuns`

**Why:** highest-friction part of the 3.6 split. The hook owns 1 state slot and returns an awkward signal (`{ insertCardId, agentId }`) so the orchestrator can insert a message — pure indirection.

**Options:**
- **D.1** — Inline back into `useChat`. Adds ~70 LOC to the orchestrator (still well under 500); removes 90 LOC of file scaffolding + the signal indirection.
- **D.2** — Keep, but only after Priority A (store owns messages too, sub-agent hook can mutate it directly).

**Probably D.1 short-term**, D.2 if/when Priority A lands.

### 🟡 Priority E — Split the four fat files

**Why:** fixes 4.4. No behaviour change — pure navigation improvement.

- **`SessionActionsModal.tsx`** → split into `SessionPopover.tsx` (anchored, unchanged) + `modals/PromptModal.tsx` + `modals/ConfirmModal.tsx` + `modals/CenteredCard.tsx`. **3 small files instead of one 630-line file.**
- **`SessionsDrawer.tsx`** → extract `SessionRow.tsx`, `SessionList.tsx`, `SessionsHeader.tsx`, `lib/sessionGrouping.ts`. Drawer becomes ~200 LOC of coordination.
- **`app/two.tsx`** → move `FormGroup`/`TextField`/`HelpStep` to `components/forms/`. Settings screen ~250 LOC.
- **`app/sub-agent/[runId].tsx`** → extract `TimelineItem.tsx`, `StreamingTextBubble.tsx`. Combined with Priority A: file drops to ~200 LOC.

### 🟢 Priority F — Dedupe screen "chrome" patterns

After C is in place:
- The `paddingHorizontal: 16` + `paddingVertical: 12` "card padding" → `theme.surfaces.card.padding`.
- The `borderRadius: 16` + `borderWidth: 1` + `borderColor: theme.colors.border` "card surface" appears ~15 times — extract a `<Card>` primitive next to `FloatingPill`.

### 🟢 Priority G — Typed message dispatch

Replace the `if (handleMessage(msg)) return` chain with a `Record<MsgType, Handler>` table keyed by a discriminated union of incoming WS message types. Removes the "remember to return true" trap and gives exhaustiveness checking.

Only worth doing once Priority A lands (the table would naturally live in the store).

---

## 6. What NOT to do

- **Don't extract more sub-hooks from `useChat`.** The marginal hook (≤100 LOC) adds more indirection than it removes — we saw that with `useSubAgentRuns`.
- **Don't unify `useChat` and the sub-agent detail screen's data layer until Priority A lands.** Without an app-level store, "sharing" between screens means passing props through the router, which is worse than the current module global.
- **Don't pre-extract small components.** Components like `Widget` in `ApprovalMessage` or `StreamingTextBubble` in `[runId].tsx` are correctly co-located. Only extract when (a) reused in ≥2 files, or (b) the parent file is over ~300 LOC and the extraction restores cohesion.
- **Don't touch `SessionsLayout`** (user constraint).
- **Don't downgrade `react-syntax-highlighter`** (user constraint).

---

## 7. Quantified complexity reference

### By area

| Area | Files | LOC | Cyclomatic / 100 LOC |
|---|---:|---:|---:|
| Chat data layer (`useChat` + sub-hooks) | 7 | 943 | 5.3 |
| Sessions UI (Layout + Drawer + Modal) | 3 | 1,547 | 3.6 |
| Sub-agent detail screen | 1 | 526 | 5.3 |
| Settings screen | 1 | 573 | 2.4 |
| Markdown + code rendering | 3 | 627 | 3.5 |
| Chat presentational | 6 | 1,395 | 2.2 |
| Shared (theme, primitives, types, lib) | 10 | 745 | 1.3 |

Dense areas (≥5): chat data layer (by design — concentrated logic) and sub-agent detail screen (un-refactored, mixes concerns).

### Top 10 files by LOC (post-refactor)

| LOC | File |
|---:|---|
| 630 | `components/SessionActionsModal.tsx` |
| 610 | `components/SessionsDrawer.tsx` |
| 573 | `app/two.tsx` |
| 526 | `app/sub-agent/[runId].tsx` |
| 413 | `hooks/useChat.ts` *(was 751)* |
| 406 | `components/ChatInputBar.tsx` *(was 460)* |
| 331 | `components/ChatMessageList.tsx` |
| 307 | `components/SessionsLayout.tsx` *(untouched)* |
| 259 | `components/ApprovalMessage.tsx` |
| 252 | `app/index.tsx` *(was 287)* |

---

## 8. Decision log

| Decision | Outcome | Date / context |
|---|---|---|
| Don't touch `SessionsLayout` | Constraint | User direction during round 1 |
| Skip syntax-highlighter swap (no downgrade) | Skipped | RN-native fork needs v6, we have v16 |
| Accept subtle visual diffs from markdown library swap | Accepted | User picked option in round 1 |
| Split `useChat` into focused hooks | Done | Round 1 — introduced known dep-array bug (4.2) |
| Three-WS-connection problem | Open | Identified in app-wide audit; blocked on Priority A direction |

---

## 9. Open questions before round 2

1. **App-level store: Context, Zustand, or roll-our-own?** Choice gates Priority A.
2. **Styling: keep hand-rolled `useUnistyles`, adopt NativeWind, or adopt the real `react-native-unistyles`?** Each is a 1–2 day migration with different code-style implications.
3. **Settings UX: live reconnect on save, or keep the restart flow?** Live reconnect is the right answer but requires Priority A.
4. **Should we do Priority B (memoize sub-hooks) now as a hot-fix, or fold it into Priority A?** B as hot-fix is ~30 LOC; A subsumes it.
5. **Are file-move PRs (Priority E) acceptable** as standalone changes, or should they ride alongside their related logic changes?

Pick a priority and we'll deepen the design before any edits.
