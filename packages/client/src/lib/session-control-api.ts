/**
 * REST wrappers for per-session control ops not covered by the live WS bridge.
 * Currently used by the SessionGraph delete button. See change:
 * add-session-delete-button.
 */
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { getApiBase } from "./api-context.js";
import { fetchJsonResponse } from "./fetch-json.js";

/**
 * Hard-delete a session: kill the pi process (if alive), remove its `.jsonl`
 * history + `.meta.json` sidecar, drop the in-memory entry. The server
 * broadcasts `session_deleted`; callers need only await success — the map
 * update is driven by the wire message handler.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  const { json } = await fetchJsonResponse<ApiResponse>(
    `${getApiBase()}/api/session/${encodeURIComponent(sessionId)}/delete`,
    { method: "POST" },
  );
  if (!json.success) throw new Error(json.error ?? "delete failed");
}