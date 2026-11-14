// FactorySuite work plans for the Live Map: fleet-server planner/work-plans.
// One day's plans, each line joined to our vehicle and its work location's
// geofence. `{ factory: null }` for an organisation that keeps none.

import { apiFetch } from '../services/api'

export async function fetchWorkPlans(orgId, day, { signal } = {}) {
  const q = day ? `?day=${encodeURIComponent(day)}` : ''
  const res = await apiFetch(`/api/v1/organisations/${orgId}/planner/work-plans${q}`, { signal })
  return res.data
}

/*
 * A plan changed in FactorySuite (approved, sent back, a change asked for or
 * decided, released). The server hears it on the work plan webhook and sends
 * `work_plans_changed` (hooks/useFleetLive), which says so here, and
 * useWorkPlans re-reads. The layer does not poll: this is how it updates.
 */
export const WORK_PLANS_CHANGED = 'ft-work-plans-changed'
export function workPlansChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(WORK_PLANS_CHANGED))
}
