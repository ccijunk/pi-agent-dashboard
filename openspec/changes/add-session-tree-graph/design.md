## Data flow

```
pi JSONL header                         PiSessionInfo            DashboardSession          Graph UI
┌──────────────────┐    pi session      ┌──────────────────┐    ┌──────────────────┐    ┌──────────────┐
│ "parentSession":  │ ──manager.list()─→ │ parentSessionPath│    │                  │    │              │
│  "/path/to/..."   │                   │ (already exists) │    │                  │    │              │
└──────────────────┘                   └────────┬─────────┘    │                  │    │              │
                                                │              │                  │    │              │
                                         bridge resolves       │                  │    │              │
                                         to session ID        │                  │    │              │
                                         (read parent file    │                  │    │              │
                                         header, or parse     │                  │    │              │
                                         filename)            │                  │    │              │
                                                │              │                  │    │              │
                                         session_register     │                  │    │              │
                                         +parentSessionId ───→│ parentSessionId  │    │              │
                                                              │ (NEW field)      │    │              │
                                                              │                  │    │              │
                                                              │ GET /api/        │    │              │
                                                              │ sessions ───────→│ cytoscape.js   │
                                                              │                  │    │ nodes+edges   │
                                                              └──────────────────┘    └──────────────┘
```

### Resolving parentSession path → ID

**Primary: read parent file header.** Open the parent JSONL, read first line, parse JSON, extract `id` field. Authoritative — always correct. One `readFileSync` of <1 KB, negligible I/O.

**Fallback: parse filename.** If the parent file doesn't exist or is unreadable, extract the UUID from the filename (`{timestamp}_{uuid}.jsonl` → take portion after last `_`, or basename without `.jsonl`). This handles cases where the parent has been deleted but children still reference it.

### Workspace hierarchy

Computed server-side, no new metadata:

```typescript
function buildWorkspaceTree(cwds: string[]): Map<string, string | null> {
  // key = cwd, value = parent cwd or null
  const sorted = [...cwds].sort((a, b) => a.length - b.length);
  const parents = new Map<string, string | null>();
  for (const cwd of sorted) {
    const parent = sorted
      .filter(p => p !== cwd && cwd.startsWith(p + "/"))
      .sort((a, b) => b.length - a.length)[0];  // longest prefix = direct parent
    parents.set(cwd, parent || null);
  }
  return parents;
}
```

Exposed via `GET /api/sessions` as `workspaceParent?: string` on each session, or computed client-side from the cwd list.

---

## Graph UI component

### Component tree

```
SessionGraph.tsx
├── Cytoscape instance (useRef, mount/unmount lifecycle)
│   ├── Nodes: WorkspaceNode, SessionNode
│   └── Edges: contains (workspace→session), fork (session→session), parent (workspace→workspace)
├── GraphControls.tsx (zoom in/out, fit-to-screen, reset)
├── SessionNode popover (on tap/click: session name, status, model, fork info)
└── GhostNode (dashed outline, for deleted parent sessions)
```

### cytoscape.js integration

Already in `node_modules` (mermaid dependency). Add as direct dependency to `packages/client/package.json`.

Layout: `dagre` (hierarchical, top-down). Nodes arranged:
- Workspace nodes on the left → right by depth
- Session nodes under their workspace, ordered by fork chain

**Graph rebuild is debounced (500ms).** Streaming sessions emit frequent status updates — each would trigger a full cytoscape element rebuild. Instead, `buildGraph` is called via `useMemo` + a 500ms debounce on the `sessions` array. Streaming green-pulse animation uses a CSS-class-driven cytoscape style rule (updated on `status` change without full rebuild).

```typescript
// graph builder: DashboardSession[] → cytoscape elements
function buildGraph(sessions: DashboardSession[], workspaceTree: Map<string, string | null>) {
  const elements: cytoscape.ElementDefinition[] = [];
  const seenSessions = new Set(sessions.map(s => s.id));

  // Workspace nodes
  for (const [cwd, parent] of workspaceTree) {
    elements.push({ data: { id: `ws:${cwd}`, label: cwd, type: "workspace" } });
    if (parent) {
      elements.push({ data: { id: `ws-edge:${parent}→${cwd}`, source: `ws:${parent}`, target: `ws:${cwd}`, type: "workspace-parent" } });
    }
  }

  // Session nodes
  for (const s of sessions) {
    elements.push({
      data: {
        id: `s:${s.id}`,
        label: s.name || s.firstMessage || s.id.slice(0, 8),
        status: s.status,
        type: "session",
        parent: `ws:${s.cwd}`,
      }
    });
    // Containment edge
    elements.push({ data: { id: `contains:${s.id}`, source: `ws:${s.cwd}`, target: `s:${s.id}`, type: "contains" } });

    // Fork edge
    if (s.parentSessionId) {
      if (seenSessions.has(s.parentSessionId)) {
        elements.push({ data: { id: `fork:${s.parentSessionId}→${s.id}`, source: `s:${s.parentSessionId}`, target: `s:${s.id}`, type: "fork" } });
      } else {
        // Ghost node for deleted parent
        elements.push({ data: { id: `s:${s.parentSessionId}`, label: "(deleted)", status: "ended", type: "ghost" } });
        elements.push({ data: { id: `fork:${s.parentSessionId}→${s.id}`, source: `s:${s.parentSessionId}`, target: `s:${s.id}`, type: "fork-ghost" } });
      }
    }
  }
  return elements;
}
```

### Visual styles

Colors are read from CSS custom properties at mount time (`getComputedStyle`) and applied to cytoscape style objects — canvas rendering means no CSS cascade. On theme change (`data-theme` attribute), styles are re-read and reapplied.

| Element | Style |
|---------|-------|
| Workspace node | Rectangle, muted bg, folder icon, bold label |
| Session node (streaming) | Circle, green fill, pulsing border (CSS `--accent-success`) |
| Session node (active) | Circle, amber fill (`--accent-warning`) |
| Session node (idle) | Circle, gray fill (`--text-muted`) |
| Session node (ended) | Circle, hollow outline, dimmed |
| Ghost node | Dashed circle, opacity 0.4, "(deleted)" label |
| Fork edge | Solid arrow, gray |
| Ghost fork edge | Dashed arrow, gray, opacity 0.4 |
| Workspace parent edge | Dashed line, no arrow |
| Contains edge | Thin solid line, no arrow |

### Interaction

- **Click session node** → navigate to session detail (existing routing)
- **Hover session node** → tooltip: name, status, model, tokens, duration
- **Drag canvas** → pan (default cytoscape behavior)
- **Scroll** → zoom
- **Double-click workspace** → collapse/expand its sessions

---

## LayoutModeSwitch

A toggle in the session sidebar header, next to existing controls:

```
[≡ list] [◉ graph]     ← toggle
```

State stored in `localStorage` keyed `dashboard:layout-mode` (`"list" | "graph"`).

When graph mode:
- Session list container is replaced with `<SessionGraph />`
- Same container dimensions — not a separate panel
- Invoking sidebar from mobile: graph renders in the mobile overlay

### Fullscreen

Button in `GraphControls`: `[⛶]` expands graph to full viewport (z-index overlay). Same pattern as existing fullscreen overlays (e.g., file preview). Escape or close button returns to sidebar-embedded mode.

---

## Deletion — ghost nodes

### Policy

| Action | Result |
|--------|--------|
| Delete session A (no children) | A removed from graph |
| Delete session A (has children B, C) | A → ghost node, B and C remain connected to ghost |
| Delete session B (child of ghost A) | A still orphan ghost → A cleaned up (no more children) |

### Implementation

Ghost nodes are transient — computed during graph build, never persisted:

```typescript
function computeGhostNodes(sessions: DashboardSession[]): Set<string> {
  const live = new Set(sessions.map(s => s.id));
  const referenced = new Set(sessions.map(s => s.parentSessionId).filter(Boolean));
  // Ghost = referenced but not live
  return new Set([...referenced].filter(id => !live.has(id)));
}
```

When no live session references a ghost, it disappears automatically.

---

## Files changed

| File | Change |
|------|--------|
| `packages/shared/src/types.ts` | Add `parentSessionId?: string` to `DashboardSession` |
| `packages/extension/src/bridge.ts` | Send `parentSessionId` in `session_register` |
| `packages/extension/src/command-handler.ts` | Resolve `parentSessionPath` → `parentSessionId` |
| `packages/server/src/event-wiring.ts` | Accept `parentSessionId` on register |
| `packages/server/src/session-manager.ts` | Persist to `.meta.json` |
| `packages/client/package.json` | Add `cytoscape` + `cytoscape-dagre` deps |
| `packages/client/src/components/SessionGraph.tsx` | **NEW** — graph component |
| `packages/client/src/components/GraphControls.tsx` | **NEW** — zoom/fit/fullscreen |
| `packages/client/src/components/LayoutModeSwitch.tsx` | **NEW** — list/graph toggle |
| `packages/client/src/components/SessionList.tsx` | Integrate toggle + graph mode |
| `packages/client/src/lib/session-graph-builder.ts` | **NEW** — sessions → cytoscape elements |

## Edge cases

1. **Cross-workspace fork** — session forked in workspace A, spawn config creates session in workspace B. `parentSessionId` points across workspaces. Graph draws an inter-workspace fork edge.

2. **Cold start** — parent session file still exists but hasn't been scanned yet (not in current session list). Treat as ghost until parent is scanned. If parent is scanned later and appears in session list, ghost is replaced with live node on next graph rebuild.

3. **Parent session renamed** — `parentSessionId` is the ID, not the path. IDs are stable, renaming doesn't affect the edge.

4. **Large graphs (50+ sessions)** — cytoscape.js handles this well. Initial view fits to screen. Zoom/pan for detail. Performance concern only if graph has 200+ nodes — add virtualized culling if needed (later optimization).
