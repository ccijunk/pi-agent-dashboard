# session-parent-lineage — delta

## ADDED Requirements

### Requirement: Session carries parent fork identity
`DashboardSession` SHALL include an optional `parentSessionId` field. When a pi session was
forked from another session (`parentSession` in JSONL header), the bridge SHALL resolve the
parent path to its session ID and include it in `session_register`. When the session was not
forked, the field SHALL be absent.

#### Scenario: Forked session reports parent
- **WHEN** a pi session is forked from session `019f5521-...`
- **THEN** `GET /api/sessions` SHALL include `parentSessionId: "019f5521-..."` on the forked session

#### Scenario: Root session has no parent
- **WHEN** a pi session is started fresh (not forked)
- **THEN** `GET /api/sessions` SHALL NOT include `parentSessionId` on that session

### Requirement: Parent ID survives cold start
The server SHALL persist `parentSessionId` to `.meta.json` and restore it via
`sessionFromMeta` on cold start, so fork lineage survives server restarts.

#### Scenario: Fork lineage persists across restart
- **WHEN** a forked session has `parentSessionId` persisted in `.meta.json`
- **AND** the server restarts
- **THEN** the session SHALL still report `parentSessionId` in `GET /api/sessions`

### Requirement: Parent ID resolution is robust
The bridge SHALL resolve `parentSessionPath` to a session ID by reading the parent JSONL
header (primary) or parsing the filename (fallback). If the parent file is missing or
unreadable, the bridge SHALL send `parentSessionId: undefined` and SHALL NOT throw.

#### Scenario: Parent file is missing
- **WHEN** a session references a parent JSONL file that has been deleted
- **THEN** the bridge SHALL send `parentSessionId` as `undefined`
- **AND** SHALL NOT throw or crash

#### Scenario: Parent file is readable
- **WHEN** a session references a parent JSONL file that exists
- **THEN** the bridge SHALL extract the `id` field from the parent header and send it as `parentSessionId`
