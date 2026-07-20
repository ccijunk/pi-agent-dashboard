# Tasks: /tree navigator modal

Sequence is dependency-ordered. Each task is independently verifiable.

## 1. Shared types + builder

- [ ] 1.1 Add `SessionEntryRole`, `SessionTreeNode`, `SessionTreeResultBrowserMessage`
      (`session_tree_result`), `RequestSessionTreeBrowserMessage`,
      `NavigateTreeBrowserMessage` to `packages/shared/src/browser-protocol.ts`.
      Add to `BrowserToServerMessage` union.
  - verify: `tsc --noEmit` passes; union membership test green.
- [ ] 1.2 Add `NavigateTreeExtensionMessage`, `NavigateTreeResultExtensionMessage`
      to `packages/shared/src/protocol.ts`; add to `ServerToExtensionMessage` and
      `ExtensionToServerMessage` unions.
  - verify: `tsc --noEmit` passes.
- [ ] 1.3 Create `packages/shared/src/session-tree.ts` with
      `buildSessionTreeFromFlat(flat)` returning `{ tree, activeLeafId }`.
  - verify: new `session-tree.test.ts` covers linear, abandoned-branch,
      root-only-reset, and active-leaf derivation.

## 2. Server

- [ ] 2.1 Extract `readSessionTreeFlat(sessionFile)` from the existing fork read
      loop in `packages/server/src/session-file-reader.ts`. Behavior-preserving
      for `createBranchedSessionFile` (re-route it through the new fn).
  - verify: existing `session-file-reader` fork tests unchanged; new test
      asserts flat shape `{ id, parentId, role, preview, label? }`.
- [ ] 2.2 Add `handleRequestSessionTree` + `handleNavigateTree` to
      `packages/server/src/browser-handlers/session-action-handler.ts`.
      `handleNavigateTree` forwards via `piGateway.sendToSession`; on no
      bridge → `navigate_tree_result { success:false,
      code:"navigate.session_not_active" }`.
  - verify: handler unit tests (session missing, no session file, no bridge).
- [ ] 2.3 Register `request_session_tree` + `navigate_tree` in the browser
      router in `packages/server/src/browser-gateway.ts`.
  - verify: gateway dispatch test routes both types; `tsc --noEmit` green.

## 3. Bridge

- [ ] 3.1 Add `navigate_tree` dispatch to `packages/extension/src/bridge.ts`
      `onMessage`: streaming guard → `navigate.streaming`; no ctx/navigateTree →
      `navigate.not_supported`; else `ctx.navigateTree(entryId, {...})` →
      `navigate_tree_result { success, cancelled }`; try/catch → failure reply.
  - verify: bridge handler test (4 cases: streaming, not_supported, success,
      vetoed-cancelled, thrown).

## 4. Client

- [ ] 4.1 Create `packages/client/src/components/SessionTreeModal.tsx`:
      request on mount, render tree, ↑/↓/←/Enter/Esc/click, disable while
      streaming, `onConfirm(entry)`.
  - verify: `SessionTreeModal.test.tsx` (render, nav, Enter, Esc, streaming).
- [ ] 4.2 `App.tsx`: add `/tree` to `BUILTIN_SLASH_COMMANDS`; intercept in
      `wrappedHandleSend` → open modal for `selectedId`.
- [ ] 4.3 `App.tsx`: per-session `pendingTreeTarget`; composer-on-Esc clears it
      (revert); composer-submit sends `navigate_tree` then, on success,
      `send_prompt`; ended-session code falls through to normal send (auto-resume).
  - verify: App interaction test (or integration via manual) — `/tree` opens;
      Esc after prefill sends nothing; submit sends navigate then prompt.
- [ ] 4.4 Wire `session_tree_result` handling in the client message reducer
      (modal subscribe) and confirm `event_forward`-of-`session_tree` already
      flows (pass-through) — no new reducer work expected.
  - verify: grep shows `session_tree` in pass-through list; manual confirms chat
      re-renders after navigate.

## 5. Polish + docs

- [ ] 5.1 i18n keys `session.tree.*`.
- [ ] 5.2 Add per-directory `AGENTS.md` rows for new files
      (`session-tree.ts`, `SessionTreeModal.tsx`) per the Documentation Update
      Protocol. Root `AGENTS.md` gets NO per-file rows.
- [ ] 5.3 Full rebuild + manual smoke: `npm run build && curl -X POST
      http://localhost:8000/api/restart && npm run reload`; `/tree` in the
      dashboard; revert a message; confirm new branch + chat re-renders; Esc
      path sends nothing; ended-session path resumes-on-send.
  - verify: manual checklist passes; `npm run quality:changed` green.