/**
 * SessionGraph — workspace-grouped fork tree view of sessions.
 *
 * Renders each workspace (cwd) as a separate section; within each, sessions
 * form a fork tree (├─/└─ indent) matching pi-agent's own session-selector
 * lineage model. Replaces the list view when the SessionViewToggle is set to
 * "graph". Supports fullscreen (viewport overlay).
 *
 * Data: DashboardSession.parentSessionId is resolved server-side from pi's
 * JSONL `parentSession` header (matched by file path). See change:
 * add-session-tree-graph.
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiFullscreen, mdiFullscreenExit, mdiTrashCanOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useMemo, useState } from "react";
import { buildTreePrefix, buildWorkspaceGroupedTree, type SessionTreeNode } from "../lib/session-graph-builder.js";
import { deleteSession } from "../lib/session-control-api.js";

interface SessionGraphProps {
  sessions: DashboardSession[];
  selectedId?: string;
  onSessionClick: (sessionId: string) => void;
}

const STATUS_COLOR: Record<string, string> = {
  streaming: "#22c55e",
  active: "#f59e0b",
  idle: "#6b7280",
  ended: "#475569",
};

function sessionLabel(s: DashboardSession): string {
  return s.name || s.firstMessage?.slice(0, 50) || s.id.slice(0, 8);
}

const TreeNode: React.FC<{
  node: SessionTreeNode;
  selectedId?: string;
  onClick: (sessionId: string) => void;
}> = ({ node, selectedId, onClick }) => {
  const { session } = node;
  const prefix = buildTreePrefix(node);
  const color = STATUS_COLOR[session.status] ?? "#6b7280";
  const ended = session.status === "ended";
  const selected = selectedId === session.id;
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const label = sessionLabel(session);
    if (!window.confirm(`Delete session "${label}"?\n\nThis kills the pi process (if running) and permanently removes its history file. This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await deleteSession(session.id);
      // Server broadcasts `session_deleted` → map drops the entry → re-render.
    } catch (err) {
      setDeleting(false);
      window.alert(err instanceof Error ? err.message : "Failed to delete session");
    }
  };

  return (
    <div
      className={`flex items-center gap-1.5 px-2 py-1 cursor-pointer rounded text-xs leading-5 ${
        selected ? "bg-[var(--bg-surface)]" : "hover:bg-[var(--bg-surface)]"
      }`}
      onClick={() => onClick(session.id)}
      data-session-id={session.id}
    >
      <span className="font-mono text-[var(--text-muted)] whitespace-pre select-none">{prefix}</span>
      <span
        className="w-2 h-2 rounded-full border flex-shrink-0"
        style={{
          backgroundColor: ended ? "transparent" : color,
          borderColor: color,
          opacity: ended ? 0.5 : 1,
        }}
      />
      <span
        className="flex-1 min-w-0 truncate"
        style={{ opacity: ended ? 0.6 : 1 }}
        title={sessionLabel(session)}
      >
        {sessionLabel(session)}
      </span>
      <span className="text-[10px] text-[var(--text-muted)] flex-shrink-0">{session.status}</span>
      <button
        type="button"
        onClick={handleDelete}
        disabled={deleting}
        className="p-1 rounded text-[var(--text-muted)] hover:text-red-500 hover:bg-[var(--bg-primary)] disabled:opacity-50 disabled:cursor-progress flex-shrink-0"
        title={deleting ? "Deleting…" : "Delete session"}
        aria-label="Delete session"
      >
        <Icon path={mdiTrashCanOutline} size={0.45} />
      </button>
    </div>
  );
};

export const SessionGraph: React.FC<SessionGraphProps> = ({ sessions, selectedId, onSessionClick }) => {
  const [isFullscreen, setIsFullscreen] = useState(false);

  const sections = useMemo(() => buildWorkspaceGroupedTree(sessions), [sessions]);

  const content = (
    <div className="w-full h-full overflow-y-auto p-2">
      {sections.length === 0 ? (
        <div className="p-4 text-sm text-[var(--text-tertiary)]">No sessions</div>
      ) : (
        sections.map((ws) => (
          <div key={ws.cwd} className="mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-semibold text-[var(--text-secondary)] border-b border-[var(--border-subtle)]">
              <span>▸</span>
              <span className="truncate" title={ws.cwd}>{ws.label}</span>
            </div>
            <div className="py-1">
              {ws.flat.map((node) => (
                <TreeNode
                  key={node.session.id}
                  node={node}
                  selectedId={selectedId}
                  onClick={onSessionClick}
                />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );

  if (isFullscreen) {
    return (
      <div className="fixed inset-0 z-50 bg-[var(--bg-card)] flex flex-col">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
          <span className="text-sm font-semibold text-[var(--text-primary)]">Session Fork Tree</span>
          <button
            type="button"
            onClick={() => setIsFullscreen(false)}
            className="p-1.5 rounded hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            title="Exit fullscreen"
            aria-label="Exit fullscreen"
          >
            <Icon path={mdiFullscreenExit} size={0.6} />
          </button>
        </div>
        <div className="flex-1 min-h-0">{content}</div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full min-h-0">
      {content}
      <button
        type="button"
        onClick={() => setIsFullscreen(true)}
        className="absolute bottom-3 right-3 p-1.5 rounded bg-[var(--bg-card)] border border-[var(--border-default)] text-[var(--text-muted)] hover:text-[var(--text-primary)] shadow-lg z-10"
        title="Fullscreen"
        aria-label="Fullscreen"
      >
        <Icon path={mdiFullscreen} size={0.6} />
      </button>
    </div>
  );
};
