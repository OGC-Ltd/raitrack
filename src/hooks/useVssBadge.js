// The Alarms tab badge: today's warning and critical dashcam alarms not yet
// marked reviewed in this browser.
//
// Same query as the Alarms screen on "Today" (api/vssAlarms vssIncidentsQuery),
// so the two never disagree and the backend is asked once. Returns null when
// disabled or not known yet — the caller shows no badge.

import { useQuery } from '@tanstack/react-query'
import { vssIncidentsQuery } from '../api/vssAlarms'
import { needsAttention } from '../lib/dashcamIncidents'
import { useDashcamReviewed } from '../lib/dashcamReviewed'

export function useVssBadge(orgId, companyId, enabled) {
  const [reviewed] = useDashcamReviewed(`vss:${companyId}`)
  const { data } = useQuery({ ...vssIncidentsQuery(orgId, 'today'), enabled: Boolean(enabled && orgId) })
  if (!enabled || !data) return null
  const waiting = needsAttention(data, reviewed)
  return { open: waiting.length, critical: waiting.filter((i) => i.severity === 'critical').length }
}
