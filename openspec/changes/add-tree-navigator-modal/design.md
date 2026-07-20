# Design: /tree navigator modal

## Operation model

This change adds pi-TUI-equivalent `/tree` to the dashboard. Two operations,
two data paths:

| Operation | Direction | Source |
|---|---|---|
| Render the tree (all branches) | server reads session JSONL | `session-file-reader.ts` `parentId` parse |
| Navigate in-place to an entry | browser → server → bridge → `ctx.navigateTree` | extension API only (not in RPC) |

`navigateTree` is on `ExtensionCommandContext`, not in RPC, so navigation must
go through the bridge. Tree **data** is read server-side from the file so the
modal renders even for ended sessions (no bridge needed for display).

## Verified pi `navigateTree` semantics (source: `agent-session.js:2267`)

`ctx.navigateTree(targetId, { summarize?, customInstructions?, label? })` returns
`{ editorText?, cancelled }`:

- **target = user message** → leaf moves to `targetEntry.parentId`
  (null = root); `editorText` = the message's text. Submitting a new prompt
  after this creates a new branch from that point.
- **target = custom message** → same as user message.
- **target = non-user (assistant/tool/compaction/other)** → leaf moves to
  `targetId`; no `editorText`. "Continue from here."
- Fires `session_before_tree` (extensions can `cancel`) then `session_tree`
  (already in bridge's pass-through list → re-renders chat).
- No-op if `targetId === currentLeafId`.

The TUI flow (`interactive-mode.js:3864`): `navigateTree` → on success puts
`editorText` in the editor → user edits → presses Enter → new prompt → branch.
The dashboard mirrors this exactly.

## Two-step client flow (cancel = true revert)

Key correctness decision: **`navigate_tree` is NOT called at selection time.**
Selection only prefills the composer client-side. `navigate_tree` fires only at
submit. Therefore cancelling never touched pi — a clean revert.

```
1. type /tree ─────────────────► open SessionTreeModal (request_session_tree)
2. click / ↑↓+Enter  ─────────► modal closes; composer prefilled with msg text;
                                 per-session pendingTreeTarget = { entryId }
                                 banner: "Editing from /tree — Esc to cancel"
3. edit text in composer (optional)
4a. Esc (cancel) ──────────────► clear pendingTreeTarget + composer; nothing sent
                                  ← CLEAN REVERT, leaf unchanged
4b. Enter (submit) ────────────► navigate_tree(entryId) → on success:
                                  send_prompt(editedText) → new branch
                                  (ended session: send_prompt auto-resumes via
                                   existing auto-resume path)
```

For a **non-user** node selection (step 2): modal closes, `navigate_tree` fires
immediately (leaf moves to it, composer stays empty — "continue from here"),
no composer-edit step. This matches the TUI's "select assistant → continue".
It's the navigate-only path; the cancel/submit split above is the user-message
path.

## Protocol

### Shared (`packages/shared/src/`)

`browser-protocol.ts` — browser→server:

```ts
export interface RequestSessionTreeBrowserMessage {
  type: "request_session_tree";
  sessionId: string;
}

export interface NavigateTreeBrowserMessage {
  type: "navigate_tree";
  sessionId: string;
  entryId: string;
  summarize?: boolean;   // default false
  label?: string;
}
```

server→browser (result):

```ts
export interface SessionTreeBrowserMessage {
  type: "session_tree";          // NOTE: collides? see Collision note below
  sessionId: string;
  tree: SessionTreeNode[];       // roots (typically one)
  activeLeafId?: string;
}
export interface SessionTreeNode {
  entryId: string;
  parentId: string | null;
  role: SessionEntryRole;        // "user" | "assistant" | "tool" | "compaction" | "custom" | "other"
  preview: string;               // ~120 chars for the list row
  label?: string;
  children: SessionTreeNode[];
}
```

**Collision note:** `session_tree` is ALSO the name of a pi **event** type that
the bridge forwards as `event_forward` (pass-through). That event lives inside
`event_forward.event.eventType`, never as a top-level `BrowserToServerMessage`,
so reusing the name for a top-level result is unambiguous on the wire — but the
server→browser result type should be named `session_tree_result` to avoid reader
confusion. **Decision: name the result `session_tree_result`.**

`protocol.ts` — server→extension (forward):

```ts
export interface NavigateTreeExtensionMessage {
  type: "navigate_tree";
  sessionId: string;        // echoed (bridge matches its own)
  entryId: string;
  summarize?: boolean;
  label?: string;
}
```

extension→server (reply):

```ts
export interface NavigateTreeResultExtensionMessage {
  type: "navigate_tree_result";
  sessionId: string;
  success: boolean;
  cancelled?: boolean;
  editorText?: string;      // for client cross-check (already prefilled)
  message?: string;
  code?: "navigate.not_supported" | "navigate.streaming" | "navigate.session_not_active";
}
```

### `SessionTreeNode` builder (`packages/shared/src/session-tree.ts`, new)

Pure function, fully unit-tested in isolation:

```ts
export function buildSessionTreeFromFlat(flat: FlatEntry[]): {
  tree: SessionTreeNode[];
  activeLeafId?: string;
};
```

`FlatEntry` mirrors what the JSONL reader returns (`{ id, parentId, role,
preview, label? }`).

**Active-leaf derivation (from file only):** the JSONL doesn't tag which leaf
is active. Derive: the active leaf is the last entry (highest append index)
that has no later entry claiming it as its `parentId`. Pi's session manager is
append-only and the active path is the most recently extended, so the last
unclaimed entry is the active leaf. This is the one assumption worth flagging
(has tests: linear session, forked-then-abandoned branch, root-only reset).

### Server (`packages/server/src/`)

**`session-file-reader.ts`** — extract `readSessionTreeFlat(sessionFile)`:
returns the flat append-order array with `{ id, parentId, role, preview,
label? }`. This is the existing JSONL read loop from
`createBranchedSessionFile` factored out (no behavior change to fork).

**`browser-handlers/session-action-handler.ts`** — two handlers:

- `handleRequestSessionTree`: look up session → `sessionFile` →
  `readSessionTreeFlat` → `buildSessionTreeFromFlat` → `sendTo(ws,
  { type:"session_tree_result", sessionId, tree, activeLeafId })`. If no
  sessionFile → `{ ... success:false, code:"navigate.session_file_unknown" }`
  (mirror `resume_result` failure shape).
- `handleNavigateTree`: `piGateway.sendToSession(sessionId, {...})`. If no
  bridge (ended session) → respond
  `{ type:"navigate_tree_result", success:false, code:"navigate.session_not_active" }`
  so the client can route the submit through the existing resume-on-send path.

**`browser-gateway.ts`** — add `case "request_session_tree"` and
`case "navigate_tree"` to the browser-message router (the switch near
`resume_session`).

### Bridge (`packages/extension/src/bridge.ts`)

In the `onMessage` dispatch (near `shutdown`/`stop_after_turn`), add:

```ts
if (msg.type === "navigate_tree") {
  const ctx = cachedCtx;
  if (getBridgeState().isAgentStreaming) {
    connection.send({ type:"navigate_tree_result", sessionId, success:false, code:"navigate.streaming" });
    return;
  }
  if (!ctx?.navigateTree) {
    connection.send({ type:"navigate_tree_result", sessionId, success:false, code:"navigate.not_supported" });
    return;
  }
  try {
    const result = await ctx.navigateTree(msg.entryId, {
      summarize: msg.summarize ?? false,
      ...(msg.label ? { label: msg.label } : {}),
    });
    connection.send({
      type:"navigate_tree_result", sessionId, success:true,
      cancelled: result.cancelled,
      // editorText comes from navigateTree on user-message targets; client
      // already prefilled, but included so a v2 can reconcile.
    });
  } catch (err) {
    connection.send({ type:"navigate_tree_result", sessionId, success:false, message: String(err?.message ?? err) });
  }
  return;
}
```

No new event listener: `session_tree` fires from pi after navigate and is
already in the pass-through list (`bridge.ts:1447`), so the chat re-renders.

### Client (`packages/client/src/`)

**`App.tsx`** — three changes:

1. Add `/tree` to `BUILTIN_SLASH_COMMANDS`.
2. In `wrappedHandleSend`, when `trimmed === "/tree"` and `selectedId` → open
   `SessionTreeModal` for `selectedId`, clear the input, return (do NOT
   send to pi). If no `selectedId` / no sessionFile → toast.
3. New per-session state `pendingTreeTarget: Map<sessionId, { entryId; role }>`
   combined with the composer. While set:
   - Show a banner row above the composer: "Editing from /tree — Esc to cancel".
   - **Esc** in the composer (when `pendingTreeTarget` is set): clear the
     pending target + composer. No server traffic. Revert.
   - **Submit** (Enter): if `pendingTreeTarget` is for a user/custom message →
     send `navigate_tree`, on `success && !cancelled` send `send_prompt(text)`,
     then clear the pending target. If `success:false && code:"navigate.session_not_active"` → fall through to the normal send path which auto-resumes (existing behavior: sending a prompt to an ended session resumes it). If `cancelled` → toast "Navigation cancelled by extension", keep the pending text for re-edit.
   - If `pendingTreeTarget.role` is non-user → action already fired at
     selection (navigate-only), no composer-edit state.

**`components/SessionTreeModal.tsx`** (new):

- Props: `{ sessionId, activeLeafId?, onClose, onConfirm(entry) }`.
- On mount: send `request_session_tree`; show spinner.
- Render tree recursively: indented `├─`/`└─` connectors, role-colored rows
  (user = blue accent, assistant = neutral, tool = muted, compaction = grey),
  preview text (~120 chars), label pill if present, active-leaf highlighted
  with a marker.
- Keyboard: ↑/↓ move selection (flat visible-order traversal), ← un/fold
  branch, Enter confirms, Esc closes (cancel). Mouse click = select + another
  click/Enter = confirm.
- Disabled while `state.isStreaming` (server refuses anyway).
- Two confirm paths via `onConfirm(entry)`:
  - `entry.role === "user" | "custom"` → close modal; set `pendingTreeTarget`;
    prefill composer with `entry.preview` (full text, not truncated — modal
    receives full text; the `preview` field is display-only, a separate
    `fullText` is carried for prefill).
  - `entry.role` non-user → close modal; fire `navigate_tree` immediately and
    reset `pendingTreeTarget` first.

**i18n** — add `session.tree.*` keys modelled on `session.forkFromHere`.

## Active-leaf file-read caveat (and why it's fine)

`agent-session.js` keeps `leafId` in memory (`sessionManager.getLeafId()`); the
JSONL on disk has no explicit active-flag. The derived rule — "last append-order
entry with no later entry pointing at it" — holds because pi is append-only and
the active path is always the latest-extended. Tested cases:

1. linear session (no branches) → last entry is active. ✓
2. forked-then-abandoned branch → abandoned branch's entries are append-order
   earlier and have a later sibling continuation → active = the continuation's
   last entry. ✓
3. navigate-to-root (leaf = null) → derive returns undefined/first-root; modal
   highlights the root. ✓ (modal treats undefined activeLeafId as
   "highlight root".)

Server could instead ask the bridge for `getLeafId()` for live sessions, but
that adds a round-trip and breaks for ended sessions. The derive is good
enough for display (highlight only); even a wrong highlight is non-fatal.

## Edge cases

- **Mid-stream.** Bridge refuses with `navigate.streaming`; modal disables
  confirm while `state.isStreaming`. The compose-edit step is also disabled
  (`send_prompt` to a streaming session would queue/steer anyway).
- **Ended session.** `navigate_tree` returns `session_not_active`. For the
  user-message path, submit falls through to the normal send path → existing
  auto-resume (`useSessionActions` handleSendPrompt → ended-session branch)
  resumes the session from its file and delivers the prompt. This is **not a
  true in-place navigate** (the ended session's leaf is whatever it was when it
  ended), but it's the best available and matches "send a prompt to a resumed
  session." A v2 can refuse and require resume-first if that's surprising.
- **Extension vetoes** (`session_before_tree` returns `cancel`). Bridge reply
  `cancelled:true` → client toast "Navigation cancelled by extension", keep
  the prefilled text so the user can re-submit a fork instead.
- **No-op navigate** (`targetId === currentLeafId`). pi returns
  `{ cancelled:false }` immediately. Client still sends the prompt → appends to
  the current leaf. Harmless.
- **Modal open while another modal/interactive-ui is open.** Tree modal is
  independent; pi is not consulted on open, so no conflict.

## TDD / verification

1. `session-tree.test.ts` — `buildSessionTreeFromFlat`: linear, abandoned
   branch, root-only, active-leaf derivation for each.
2. `session-file-reader.test.ts` — `readSessionTreeFlat`: existing fork tests
   unchanged (refactor is behavior-preserving); new test asserts flat shape
   with `parentId`.
3. `protocol` type test — both new messages members of their unions; server
   router (`browser-gateway`) accepts `request_session_tree` + `navigate_tree`.
4. `bridge` handler test (vitest) — `navigate_tree` dispatch:
   no-ctx → `not_supported`; streaming → `streaming`; success → result
   `{success,cancelled:false}`; vetoed → `cancelled:true`; thrown →
   `{success:false,message}`.
5. `SessionTreeModal.test.tsx` — renders tree from `session_tree_result`;
   ↑/↓ + Enter confirms; Esc closes without `onConfirm`; click confirms;
   disabled while streaming.
6. `App.tsx` interaction — `/tree` opens modal; pendingTreeTarget Esc reverts
   (no navigate/send); submit calls navigate then send_prompt.
7. Manual: `npm run build && curl /api/restart && npm run reload`; open
   dashboard; `/tree`; revert a message; observe new branch + chat re-renders.

## Files

- `packages/shared/src/browser-protocol.ts` (+ `__tests__`): new messages,
  union membership.
- `packages/shared/src/protocol.ts`: `NavigateTreeExtensionMessage`,
  `NavigateTreeResultExtensionMessage`, union membership.
- `packages/shared/src/session-tree.ts` (new, + test): `SessionTreeNode`,
  `buildSessionTreeFromFlat()`.
- `packages/server/src/session-file-reader.ts`: extract `readSessionTreeFlat()`
  (behavior-preserving refactor of fork's read).
- `packages/server/src/browser-handlers/session-action-handler.ts`:
  `handleRequestSessionTree`, `handleNavigateTree`.
- `packages/server/src/browser-gateway.ts`: router cases.
- `packages/extension/src/bridge.ts`: `navigate_tree` dispatch (~20 lines).
- `packages/client/src/App.tsx`: `/tree` intercept + `pendingTreeTarget` +
  composer Esc/Submit hooks + modal mount.
- `packages/client/src/components/SessionTreeModal.tsx` (new, + test).
- Per-directory `AGENTS.md` rows (new files) per the Documentation Update
  Protocol.