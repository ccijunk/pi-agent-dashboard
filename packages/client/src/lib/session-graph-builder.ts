/**
 * Builds a workspace-grouped session fork tree matching pi-agent's own
 * session-selector model.
 *
 * Mirrors pi's `buildSessionTree` (session-selector.js):
 * - Link child → parent via `parentSessionId` (server-resolved from JSONL
 *   `parentSession`, matched by FILE PATH against the session set).
 * - A session is a ROOT if its parent is missing OR not in the session set
 *   (pi's rule — missing parent → root, NOT a ghost).
 * - Children sorted by lastActivityAt desc (pi uses modified date desc).
 *
 * Workspaces (cwd) are separate sections; within each, sessions form a fork
 * tree. Cross-workspace forks (parent in a different cwd) link to the parent
 * only if the parent is in the SAME workspace section — otherwise the child
 * becomes a root in its own workspace (matches the dashboard sidebar grouping).
 */

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export interface SessionTreeNode {
  session: DashboardSession;
  children: SessionTreeNode[];
  depth: number;
  isLast: boolean;
  ancestorContinues: boolean[];
}

export interface WorkspaceSection {
  cwd: string;
  label: string;
  roots: SessionTreeNode[];
  flat: SessionTreeNode[];
}

/**
 * Build a fork tree from a set of sessions (within one workspace).
 * Mirrors pi's buildSessionTree. Parent must be in the session set.
 */
function buildForkTree(sessions: DashboardSession[]): SessionTreeNode[] {
  const byId = new Map(sessions.map(s => [s.id, s]));
  const nodesById = new Map<string, SessionTreeNode & { children: SessionTreeNode[] }>();

  for (const s of sessions) {
    nodesById.set(s.id, { session: s, children: [], depth: 0, isLast: false, ancestorContinues: [] });
  }

  const roots: SessionTreeNode[] = [];
  for (const s of sessions) {
    const node = nodesById.get(s.id)!;
    const parentId = s.parentSessionId;
    if (parentId && byId.has(parentId)) {
      nodesById.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  // Sort by lastActivityAt desc (pi uses modified date desc)
  const sortNodes = (nodes: SessionTreeNode[]) => {
    nodes.sort((a, b) => {
      const ta = a.session.lastActivityAt ?? a.session.startedAt ?? 0;
      const tb = b.session.lastActivityAt ?? b.session.startedAt ?? 0;
      return tb - ta;
    });
    for (const n of nodes) sortNodes(n.children as SessionTreeNode[]);
  };
  sortNodes(roots);

  // Flatten with depth/isLast/ancestorContinues (pi's flattenSessionTree)
  const walk = (node: SessionTreeNode, depth: number, ancestorContinues: boolean[], isLast: boolean) => {
    node.depth = depth;
    node.isLast = isLast;
    node.ancestorContinues = ancestorContinues;
    const kids = node.children as SessionTreeNode[];
    for (let i = 0; i < kids.length; i++) {
      const childIsLast = i === kids.length - 1;
      const continues = depth > 0 ? !isLast : false;
      walk(kids[i], depth + 1, [...ancestorContinues, continues], childIsLast);
    }
  };
  for (let i = 0; i < roots.length; i++) {
    walk(roots[i], 0, [], i === roots.length - 1);
  }

  return roots;
}

/**
 * Build workspace-grouped fork trees. Each cwd is a separate section; within
 * each, sessions form a fork tree. Cross-workspace parents make the child a
 * root in its own workspace (so the sidebar grouping stays clean).
 */
export function buildWorkspaceGroupedTree(sessions: DashboardSession[]): WorkspaceSection[] {
  const byCwd = new Map<string, DashboardSession[]>();
  for (const s of sessions) {
    if (!byCwd.has(s.cwd)) byCwd.set(s.cwd, []);
    byCwd.get(s.cwd)!.push(s);
  }

  const sections: WorkspaceSection[] = [];
  for (const [cwd, wsSessions] of byCwd) {
    const roots = buildForkTree(wsSessions);
    const flat: SessionTreeNode[] = [];
    const collect = (nodes: SessionTreeNode[]) => {
      for (const n of nodes) {
        flat.push(n);
        collect(n.children as SessionTreeNode[]);
      }
    };
    collect(roots);
    sections.push({
      cwd,
      label: cwd.split("/").pop() || cwd,
      roots,
      flat,
    });
  }

  // Sort workspaces: most-recent-activity first
  sections.sort((a, b) => {
    const ta = Math.max(...a.flat.map(n => n.session.lastActivityAt ?? n.session.startedAt ?? 0));
    const tb = Math.max(...b.flat.map(n => n.session.lastActivityAt ?? n.session.startedAt ?? 0));
    return tb - ta;
  });

  return sections;
}

/**
 * Build a tree-prefix string (├─ / └─ / │) for a node, matching pi's
 * buildTreePrefix. Used for ASCII tree rendering.
 */
export function buildTreePrefix(node: SessionTreeNode): string {
  const parts: string[] = [];
  for (const continues of node.ancestorContinues) {
    parts.push(continues ? "│  " : "   ");
  }
  parts.push(node.isLast ? "└─ " : "├─ ");
  return parts.join("");
}
