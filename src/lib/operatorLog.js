// Incidents an operator saw on a live camera with no alarm behind them
// (operator, 1 Nov 2026: "operator watched it live, it was not in alarms"),
// logged by hand and counted in the Driver Behaviour Report.
//
// ## Kept in this browser, for now
//
// There is no table for these yet, so they live in this browser's storage,
// one list per organisation: another computer does not see them, and clearing
// the browser loses them. Export and Import move them between computers until
// the database takes over; when it does, only load/save here change.

export const OPERATOR_KINDS = [
  { key: 'phone', label: 'On phone' },
  { key: 'seatbelt', label: 'No seatbelt' },
  { key: 'covered', label: 'Camera covered' },
  { key: 'other', label: 'Other' },
];
export const KIND_LABEL = Object.fromEntries(OPERATOR_KINDS.map((k) => [k.key, k.label]));

/** An entry and a camera alarm of the same kind this close on one vehicle are one incident. */
export const SAME_INCIDENT_MS = 5 * 60_000;

const keyFor = (orgId) => `ft-operator-incidents:${orgId}`;

function newId() {
  try { return crypto.randomUUID(); } catch { return `oi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`; }
}

/** Only well-formed entries survive a read or an import. */
export function clean(e) {
  if (!e || typeof e !== 'object') return null;
  const at = Number(e.at);
  if (!KIND_LABEL[e.kind] || !Number.isFinite(at) || !(e.vehicleId || e.plate)) return null;
  const s = (v, max = 500) => String(v ?? '').trim().slice(0, max);
  return {
    id: s(e.id, 80) || newId(),
    kind: e.kind,
    other: e.kind === 'other' ? s(e.other, 120) : '',
    at,
    vehicleId: s(e.vehicleId, 80) || null,
    plate: s(e.plate, 40),
    driver: s(e.driver, 120),
    location: s(e.location, 200),
    status: e.status === 'Offline' ? 'Offline' : 'Online',
    details: s(e.details, 1000),
    by: s(e.by, 120),
    loggedAt: Number.isFinite(Number(e.loggedAt)) ? Number(e.loggedAt) : Date.now(),
  };
}

export function loadEntries(orgId) {
  if (!orgId) return [];
  try {
    const list = JSON.parse(localStorage.getItem(keyFor(orgId)) ?? '[]');
    return (Array.isArray(list) ? list : []).map(clean).filter(Boolean).sort((a, b) => b.at - a.at);
  } catch { return []; }
}

/** Saves the list; false when the browser will not keep it (private window, storage full). */
export function saveEntries(orgId, list) {
  try { localStorage.setItem(keyFor(orgId), JSON.stringify(list)); return true; } catch { return false; }
}

/** Add or replace by id. Returns the new list. */
export function upsert(list, entry) {
  const e = clean({ ...entry, id: entry.id || newId() });
  if (!e) return list;
  return [e, ...list.filter((x) => x.id !== e.id)].sort((a, b) => b.at - a.at);
}

export const remove = (list, id) => list.filter((x) => x.id !== id);

/** The file Export writes: plain JSON, so a later database import can read it too. */
export function exportJson(list, orgCode) {
  return JSON.stringify({ kind: 'operator-incidents', org: orgCode ?? null, exportedAt: new Date().toISOString(), entries: list }, null, 1);
}

/** Merge an exported file into the list; an entry already held (same id) is kept once. */
export function importJson(list, text) {
  const data = JSON.parse(text);
  const incoming = (Array.isArray(data) ? data : data?.entries ?? []).map(clean).filter(Boolean);
  let next = list;
  let added = 0;
  for (const e of incoming) {
    if (!next.some((x) => x.id === e.id)) added += 1;
    next = upsert(next, e);
  }
  return { list: next, added };
}
