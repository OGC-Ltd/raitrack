// Live vehicle count for the header brand logo — the size of the fleet entry
// useFleetLive keeps in the query cache (same queries, same keys), so it never
// fetches the snapshot a second time and switches company with everything else.
// Returns null until known (and for companies with no backend org), so the
// caller can fall back to the companyData count.

import { useQuery } from '@tanstack/react-query'
import { orgIdQuery, vehiclesQuery } from './useFleetLive'

export function useFleetCount(companyId) {
  const { data: orgId } = useQuery(orgIdQuery(companyId))
  const { data } = useQuery({
    ...vehiclesQuery(companyId, orgId ?? null),
    select: (list) => (Array.isArray(list) ? list.length : null),
  })
  return orgId ? (data ?? null) : null
}
