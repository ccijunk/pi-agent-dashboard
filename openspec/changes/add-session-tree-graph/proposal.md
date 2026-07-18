## Why

The dashboard currently shows sessions as a flat list grouped by workspace folder. But pi already tracks session lineage — every forked session stores a `parentSession` path in its JSONL header. The dashboard reads this into `PiSessionInfo.parentSessionPath` but never propagates it to `DashboardSession` or the UI. Users can't see:

- Which session was forked from which (parent/child fork chain)
- Workspace hierarchy (nested folders like `.../workflow/extensions/pi-web-ui` is a child of `.../workflow`)
- How sessions relate to each other across workspaces (a fork spawns a new cwd)

The session list also has no alternative view — no graph, no tree, no visual of session relationships.

## What Changes

### Data layer — propagate existing pi metadata

1. **`DashboardSession`** gains `parentSessionId?: string` — resolved from pi's JSONL `parentSession` field (path → session id)
2. **Bridge `session_register`** includes `parentSessionId` — extracted from the session file header
3. **Server** persists `parentSessionId` to `.meta.json` and exposes it in `GET /api/sessions`
4. **Workspace hierarchy** — inferred from cwd paths. `/a/b/c` is a child of `/a/b`. Computed server-side, no new metadata needed.

### Client UI — graph view with list/graph toggle

5. **`SessionGraph.tsx`** — new interactive graph component using cytoscape.js (already in node_modules via mermaid)
6. **`LayoutModeSwitch`** toggle — switches the session sidebar between list mode (existing) and graph mode (new)
7. **Fullscreen** — graph can expand to full viewport (same pattern as existing overlays)
8. **Nodes**: workspace folders (folder icon) → session dots (status-colored)
9. **Edges**: 
   - Fork lineage (solid, session→session)
   - Workspace containment (dashed, workspace→workspace)
10. **Status colors**: streaming = green pulse, active = amber, idle = gray, ended = dimmed/hollow

### Deletion policy — orphan with ghost node

When a session with children is deleted:
- Child sessions keep their `parentSessionId` reference
- Graph renders a **ghost node** (dashed outline, "deleted" label) where the parent was
- Ghost nodes auto-clean when all children are also deleted
- No cascade delete, no re-parenting

## Discipline Skills

- `doubt-driven-review` on proposal.md + design.md before authoring tasks
- `review-code` on implementation diff
- `code-quality` gate at completion

## Non-Goals

- In-session message tree navigation (covered by archived `session-tree-navigation`)
- Editing/reordering the graph (read-only visualization)
- Persisting graph layout state across page reloads (initial scope)
