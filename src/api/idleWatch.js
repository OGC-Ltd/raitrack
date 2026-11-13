// The idle alerts kept by the server (fleet-server modules/idle-watch,
// idle_episodes), for the Alerts page's Idle units › History.

import { resolveOrgId } from "./org";
import { apiFetch } from "../services/api";

const ORG = "menengai";

/**
 * Idle stops that overlap the days from..to (YYYY-MM-DD, Nairobi days, both
 * included), newest first. Returns { rows, meta: { from, to, more, limit, rule } }.
 */
export async function fetchIdleHistory({ from, to, q } = {}) {
  const orgId = await resolveOrgId(ORG);
  if (!orgId) throw new Error("Menengai is not on this account");
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  if (q?.trim()) qs.set("q", q.trim());
  const res = await apiFetch(`/api/v1/organisations/${orgId}/idle-watch/history?${qs}`);
  return { rows: res.data ?? [], meta: res.meta ?? {} };
}
