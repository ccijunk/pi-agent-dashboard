/**
 * SessionViewToggle — toggle between list and graph view of sessions.
 * Persists choice to localStorage. Separate from LayoutModeSwitch (chat/split/editor).
 */

import { mdiGraph, mdiViewList } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useState } from "react";

export type SessionViewMode = "list" | "graph";

const STORAGE_KEY = "dashboard:session-view-mode";

function readStored(): SessionViewMode {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "graph") return "graph";
  } catch { /* ignore */ }
  return "list";
}

function writeStored(mode: SessionViewMode) {
  try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* ignore */ }
}

interface SessionViewToggleProps {
  mode: SessionViewMode;
  onChange: (mode: SessionViewMode) => void;
}

export const SessionViewToggle: React.FC<SessionViewToggleProps> = ({ mode, onChange }) => {
  const isList = mode === "list";

  return (
    <div className="flex rounded bg-[var(--bg-primary)] border border-[var(--border-subtle)] p-0.5">
      <button
        type="button"
        onClick={() => onChange("list")}
        className={`p-1 rounded ${isList ? "bg-[var(--bg-surface)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"} transition-colors`}
        title="List view"
        aria-label="List view"
        aria-pressed={isList}
      >
        <Icon path={mdiViewList} size={0.55} />
      </button>
      <button
        type="button"
        onClick={() => onChange("graph")}
        className={`p-1 rounded ${!isList ? "bg-[var(--bg-surface)] text-[var(--text-primary)]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"} transition-colors`}
        title="Graph view"
        aria-label="Graph view"
        aria-pressed={!isList}
      >
        <Icon path={mdiGraph} size={0.55} />
      </button>
    </div>
  );
};

export function useSessionViewMode(): [SessionViewMode, (mode: SessionViewMode) => void] {
  const [mode, setMode] = useState<SessionViewMode>(readStored);

  const setAndPersist = useCallback((m: SessionViewMode) => {
    setMode(m);
    writeStored(m);
  }, []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && (e.newValue === "list" || e.newValue === "graph")) {
        setMode(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return [mode, setAndPersist];
}
