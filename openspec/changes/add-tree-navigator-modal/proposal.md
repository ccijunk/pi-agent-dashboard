# Add interactive /tree navigator modal (mirror pi TUI)

## Why

pi's TUI exposes `/tree` — an interactive session-tree navigator: pick any
past message, edit it in the composer, and submit to branch from that point
in-place (same session file, new branch). The dashboard has no equivalent.
The only branching affordance today is the per-message "Fork from here"
button, which creates a **new session file** — different operation, different
outcome.

Users running pi through the dashboard lose the in-place "revert to an
earlier message and try a different path" workflow that `/tree` provides in
the TUI. This change brings that workflow to the dashboard web client.

Verified enabling facts (current code):

- **`navigateTree` is available to the bridge as an extension API.**
  `ExtensionCommandContext.navigateTree(targetId, { summarize, label })`
  (`node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:267`)
  is in scope in `bridge.ts`'s `onMessage` closure (same scope that already
  dispatches `shutdown`/`abort`/`stop_after_turn`).
- **pi's `navigateTree` semantics are known from source.**
  `agent-session.js:2267` — for a **user** message it moves the leaf to the
  message's `parentId` and returns the message text as `editorText`; for a
  non-user entry it moves the leaf to that entry (no editor text). The TUI
  (`interactive-mode.js:3864`) then drops `editorText` into its editor; the
  user edits, presses Enter → a new user prompt creates a new branch.
- **The full session tree is on disk and already parsed.**
  `packages/server/src/session-file-reader.ts` reads the session JSONL and
  parses `parentId` per entry. The flat append-order array contains abandoned
  branches (pi's session manager is append-only). Used today only for
  `createBranchedSessionFile` (fork); a sibling `readSessionTreeFlat()` gives
  the tree to the modal.
- **`session_tree` event forwarding already exists.** The bridge's pass-through
  event list (`bridge.ts:1447`) includes `session_tree` — pi fires it after
  `navigateTree`, so the chat re-renders from the new leaf automatically, no
  new event wiring needed.
- **`/tree` interception is the same pattern as existing built-ins.**
  `App.tsx`'s `wrappedHandleSend` already intercepts `/compact`, `/reload`,
  `/new`, `/model` (the `BUILTIN_SLASH_COMMANDS` set). Adding `/tree` there is
  a one-line membership bump + modal open.

## What Changes

- **Tree-data path (server, read-only).** A new browser→server message
  `request_session_tree` → server reads the session JSONL via a new
  `readSessionTreeFlat()` in `session-file-reader.ts`, builds a `SessionTreeNode[]`
  tree + `activeLeafId`, returns `session_tree` to the requesting browser.
  Tree data is served from the **file**, not the bridge, so it works for
  ended sessions too (no round-trip).
- **Navigate action path (server→bridge).** A new browser→server message
  `navigate_tree { sessionId, entryId, summarize? }` → server forwards to the
  session's bridge via `piGateway.sendToSession`; bridge invokes
  `ctx.navigateTree(entryId)` and replies `navigate_tree_result { success,
  cancelled?, editorText?, code? }`. Refuses while the agent is streaming
  (same guard `/reload` uses) and when no bridge is connected (ended session).
- **Client flow (two-step, cancel = true revert).**
  1. User types `/tree` in the composer → `App.tsx` intercepts and opens the
     `SessionTreeModal` for the selected session (no prompt sent to pi).
  2. Modal renders the full tree (indented, fold/unfold, role-colored). User
     selects via mouse click or ↑/↓ + Enter; Esc/backdrop cancels and returns
     to normal chat with nothing sent to pi.
  3. On confirm, the modal closes and the selected message's text prefills the
     composer; a per-session `pendingTreeTarget = { entryId }` flag is set. A
     small "Editing from /tree — Esc to cancel" banner shows.
  4. **Esc while in tree-edit mode** → revert: clear `pendingTreeTarget`, clear
     the composer. Nothing ever touched pi. Clean revert.
  5. **Submit (Enter)** → send `navigate_tree`, on success send `send_prompt`
     with the (possibly edited) text → pi creates a new branch. The forwarded
     `session_tree` event rebuilds the chat from the new leaf.
- **No new session file.** Unlike fork, navigate stays in the same session
  file → same `sessionId` → no `session_added` churn. The chat just
  re-renders.

## Out of Scope (v1)

- No "Fork from here" inside the modal — the per-message fork button stays the
  fork affordance. Modal is navigate-only.
- No "summarize abandoned branch" checkbox in the modal UI
  (`navigate_tree.summarize = false` default). The bridge `navigate_tree`
  message carries the optional field so a v2 checkbox plugs in with no protocol
  change.
- No entry labels / Shift+L label UI. The tree node carries `label?` (rendered
  if present) but the modal does not edit labels.

## Discipline Skills

`review-code` (non-trivial multi-package change before commit). No
security/PII/untrusted-input surface (all messages are session-local) →
`security-hardening` not triggered. No latency budget →
`performance-optimization` not triggered.