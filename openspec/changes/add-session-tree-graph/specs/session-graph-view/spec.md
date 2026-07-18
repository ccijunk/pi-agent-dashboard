# session-graph-view — delta

## ADDED Requirements

### Requirement: Graph toggle in session sidebar
The session sidebar SHALL include a `LayoutModeSwitch` that toggles between list view
(existing) and graph view (new). The choice SHALL be persisted to `localStorage` under
`dashboard:layout-mode`. The default SHALL be `"list"`.

#### Scenario: Default is list view
- **WHEN** a user opens the dashboard for the first time
- **THEN** the session sidebar SHALL display in list mode

#### Scenario: Toggle persists across reload
- **WHEN** a user switches to graph view and refreshes the page
- **THEN** the session sidebar SHALL render in graph mode

### Requirement: Interactive session graph
The graph view SHALL render an interactive graph using cytoscape.js with dagre layout.
Workspace folders SHALL appear as container nodes. Sessions SHALL appear as child nodes
colored by status: green (streaming), amber (active), gray (idle), hollow (ended).
Fork relationships SHALL be rendered as solid directed edges from parent to child session.

#### Scenario: Graph renders sessions with status colors
- **WHEN** the dashboard has sessions in streaming, active, idle, and ended states
- **THEN** each session node SHALL be colored according to its status

#### Scenario: Fork edges link parent to child
- **WHEN** session B has `parentSessionId` pointing to session A
- **THEN** the graph SHALL render a directed edge from session A to session B

### Requirement: Ghost nodes for deleted parents
When a session's `parentSessionId` references a session not in the current session list,
the graph SHALL render a ghost node (dashed outline, dimmed, "(deleted)" label) in the
parent's position. Ghost nodes SHALL auto-clean when no live session references them.

#### Scenario: Deleted parent becomes ghost
- **WHEN** session A is deleted but session B lists A as its `parentSessionId`
- **THEN** the graph SHALL render a ghost node for A connected to B via a dashed edge

#### Scenario: Ghost is cleaned up
- **WHEN** session B (the last child of ghost A) is also deleted
- **THEN** the ghost node for A SHALL disappear from the graph

### Requirement: Workspace hierarchy
Workspace folders SHALL be arranged hierarchically by cwd path. `/a/b/c` SHALL be rendered
as a child of `/a/b` when both are present. Workspace containment SHALL be rendered as
dashed edges between workspace nodes.

#### Scenario: Nested workspace hierarchy
- **WHEN** sessions exist in `/a` and `/a/b`
- **THEN** the graph SHALL render a parent-child edge from `/a` to `/a/b`

### Requirement: Fullscreen graph
The graph SHALL support fullscreen mode via a button in `GraphControls`. Fullscreen SHALL
render the graph as a viewport-filling overlay. Pressing Escape or clicking the close button
SHALL return to the sidebar-embedded view.

#### Scenario: Fullscreen toggle
- **WHEN** a user clicks the fullscreen button in GraphControls
- **THEN** the graph SHALL expand to fill the viewport
- **WHEN** the user presses Escape
- **THEN** the graph SHALL return to the sidebar

### Requirement: Graph handles streaming updates efficiently
The graph SHALL debounce full rebuilds at 500ms to avoid thrashing during streaming sessions.
Status transitions (streaming → active → ...) SHALL update the affected node's style without
a full graph rebuild.

#### Scenario: Streaming session updates node style
- **WHEN** a session transitions from active to streaming
- **THEN** only that session's node style SHALL update
- **AND** the full graph SHALL NOT rebuild

### Requirement: Session node click navigates to session
Clicking or tapping a session node SHALL navigate to the session detail view (same behavior
as clicking a session card in list mode).

#### Scenario: Click session node
- **WHEN** a user clicks a session node in the graph
- **THEN** the UI SHALL navigate to that session's detail page
