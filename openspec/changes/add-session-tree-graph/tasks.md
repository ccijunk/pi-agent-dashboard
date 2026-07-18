## 1. Add `parentSessionId` to shared types

- [ ] Add `parentSessionId?: string` field to `DashboardSession` in `packages/shared/src/types.ts`
- [ ] Add `parentSessionId?: string` to the `session_register` message type in `packages/shared/src/protocol.ts` (if separate)
- [ ] Run TypeScript check: `npx tsc --noEmit`

## 2. Bridge: resolve and forward parentSession

- [ ] In `packages/extension/src/command-handler.ts`: extract session ID from `parentSessionPath` by reading parent JSONL header → extract `id` field
- [ ] Fallback: if parent file missing, parse session ID from filename (`{ts}_{uuid}.jsonl`)
- [ ] In `packages/extension/src/bridge.ts`: include `parentSessionId` in `session_register` message
- [ ] Test: spawn a fork → verify bridge sends `parentSessionId` in `session_register`
- [ ] Reload: `npm run reload`

## 3. Server: accept, persist, expose

- [ ] In `packages/server/src/event-wiring.ts`: accept `parentSessionId` on `session_register` and store in sessionManager
- [ ] In session manager: persist `parentSessionId` to `.meta.json` on update
- [ ] In session scanner: read `parentSessionId` from `.meta.json` on cold start
- [ ] Verify `GET /api/sessions` response includes `parentSessionId` for forked sessions
- [ ] Restart: `curl -X POST http://localhost:8000/api/restart`

## 4. Workspace hierarchy (server or client)

- [ ] Add `buildWorkspaceTree(cwds: string[]): Map<string, string | null>` utility
- [ ] Client: compute from session cwd list on graph build
- [ ] (Server alternative: expose `workspaceParent` in API — decide in implementation)

## 5. Install cytoscape.js dependency

- [ ] Add `cytoscape` and `cytoscape-dagre` to `packages/client/package.json`
- [ ] Run `npm install`

## 6. Graph builder utility

- [ ] Create `packages/client/src/lib/session-graph-builder.ts`
- [ ] Export `buildGraph(sessions, workspaceTree): cytoscape.ElementDefinition[]`
- [ ] Handle: session nodes, workspace nodes, contains edges, fork edges, ghost nodes
- [ ] Unit tests: normal graph, fork chain, ghost node, cross-workspace fork, empty sessions list

## 7. SessionGraph component

- [ ] Create `packages/client/src/components/SessionGraph.tsx`
- [ ] cytoscape instance lifecycle (useRef, mount → init, unmount → destroy)
- [ ] Props: `sessions: DashboardSession[]`, `workspaceTree`, `onSessionClick`
- [ ] Register cytoscape styles (background, nodes, edges, status colors)
- [ ] Apply dagre layout
- [ ] Debounce graph rebuild: 500ms on `sessions` prop change — avoids thrashing during streaming
- [ ] Streaming pulse: CSS-class-driven cytoscape style rule, updated on `status` change without full rebuild
- [ ] Handle: window resize → fit
- [ ] Theme-aware: read `--accent-*` and `--text-*` CSS vars via `getComputedStyle`, apply to cytoscape style objects
- [ ] Theme-change listener: `MutationObserver` on `data-theme` → re-read CSS vars → reapply styles

## 8. GraphControls component

- [ ] Create `packages/client/src/components/GraphControls.tsx`
- [ ] Buttons: zoom in, zoom out, fit to screen, fullscreen toggle
- [ ] Fullscreen: overlay with graph filling viewport, Escape/close to dismiss
- [ ] Props: `cyRef: React.MutableRefObject<cytoscape.Core | null>`, `onFullscreen`

## 9. LayoutModeSwitch + SessionList integration

- [ ] Create `packages/client/src/components/LayoutModeSwitch.tsx`
- [ ] Two-state toggle: list (≡) / graph (◉)
- [ ] Persist choice to `localStorage` key `dashboard:layout-mode`
- [ ] In `SessionList.tsx`: conditionally render `<SessionList />` or `<SessionGraph />` based on mode
- [ ] Graph mode: same container, same props as list
- [ ] Empty state: "No sessions" message in both modes

## 10. Tests

- [ ] Unit: `session-graph-builder.ts` (ghost node logic, workspace tree, edge cases)
- [ ] Unit: `buildWorkspaceTree` (nested folders, flat, single folder)
- [ ] Integration: `GET /api/sessions` returns `parentSessionId`
- [ ] E2E (Playwright): toggle list → graph → fullscreen → close → list
- [ ] E2E: fork a session in pi → graph shows fork edge

## 11. Full rebuild and verification

- [ ] `npm run build`
- [ ] `curl -X POST http://localhost:8000/api/restart`
- [ ] `npm run reload`
- [ ] Manual smoke: open dashboard, toggle graph, verify sessions appear, fork edge renders
