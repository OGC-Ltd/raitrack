// Org-level PDF reports, rendered by the fleet-server template engine
// (server/src/modules/reports) — one canonical report design for every
// organisation and section (analytics | drivers | maintenance), matching the
// "Fleet Analytics Report" sample. The per-entity sub-reports (single driver,
// single vehicle, depot) still come from utils/pdfReport.js, which follows the
// same visual system.

import { resolveOrgId } from './org'
import { apiFetch, apiFetchBlob } from '../services/api'
import { saveFile } from './tripReport'

const BASE = import.meta.env.VITE_API_URL || ''

/**
 * Download a server-rendered report PDF for the active company's org.
 * @param {object} o
 * @param {string} o.companyId fleettrack company slug ("sukari")
 * @param {'analytics'|'drivers'|'maintenance'} o.kind
 * @param {number} [o.days]    trailing window (server clamps to 1..366)
 * @param {string} o.filename  save-as name, e.g. "Sukari-Analytics-Report.pdf"
 */
export async function downloadOrgReportPdf({ companyId, kind, days = 30, filename }) {
  const orgId = await resolveOrgId(companyId)
  if (!orgId) throw new Error('This company has no backend organisation to report on')
  const res = await fetch(`${BASE}/api/v1/organisations/${orgId}/reports/pdf/${kind}?days=${days}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.message ?? `Report download failed (HTTP ${res.status})`)
  }
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * The movement report (fleet-server reports/movement-report) as data: where
 * every unit is now and whether it is heading to or from MORL over the last
 * `hours` (2 or 4), for the Reports page's CPO movements table.
 */
export async function loadMovementReport({ orgId, hours }) {
  if (!orgId) throw new Error('No organisation selected')
  const res = await apiFetch(`/api/v1/organisations/${orgId}/reports/movements?hours=${hours}`)
  return res.data
}

/**
 * The PDF of the movement report as the operator edited it (lib/movementReport
 * pdfRequest): the server draws it on the letterhead; this saves the file.
 */
export async function downloadEditedMovementReport({ orgId, request }) {
  if (!orgId) throw new Error('No organisation selected')
  const { blob, filename } = await apiFetchBlob(`/api/v1/organisations/${orgId}/reports/movements.pdf`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  saveFile(blob, filename ?? `Movement report last ${request.hours} hours.pdf`)
}
