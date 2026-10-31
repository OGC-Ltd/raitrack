// Gathers what lib/weighbridgeTonnage needs to credit weighbridge tonnes to
// drivers: the organisation's weighbridge tickets day by day, and its trips,
// both over the Drivers page's 90 days. Routes the dashboard already reads:
//   GET /organisations/:orgId/weighments?day=   (weighbridge:read)
//   GET /organisations/:orgId/trips?from=&to=   (trip:read)
//
// A settled day's tickets do not change, so each is kept in this browser
// (localStorage, compact) and asked for once; the last few days are read again. Trips
// are read once per visit. Without weighbridge rights the result is empty and
// the page shows the server's tonnes as before; without trip rights tickets
// are matched by the driver's name alone.

import { apiFetch } from "../services/api";
import { getWeighmentDay } from "./weighments";
import { fleetToday } from "./notifications";
import { creditTonnage } from "../lib/weighbridgeTonnage";

const DAY_MS = 86_400_000;
const AT_ONCE = 6;
const CACHE = "ft-wb-day2:";
const held = new Map();

/** `YYYY-MM-DD` fleet days, oldest first, ending today. */
export function fleetDays(count, today = fleetToday()) {
  const end = Date.parse(`${today}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

// Only what the matching reads, as a short tuple with times in seconds, so
// ninety days fit in the browser's storage.
const sec = (iso) => (iso ? Math.round(Date.parse(iso) / 1000) : 0);
const iso = (s) => (s ? new Date(s * 1000).toISOString() : null);
const pack = (w) => [String(w.id ?? w.token).slice(0, 12), sec(w.tokenAt), sec(w.tareAt), sec(w.grossAt), sec(w.factoryGrossAt), sec(w.factoryTareAt),
  w.vehicleId ?? 0, w.vehiclePlate ?? "", w.driverName ?? "", w.netWeightKg ?? 0, w.factoryNetWeightKg ?? 0, w.centerName ?? ""];
const unpack = (a) => ({
  id: a[0], tokenAt: iso(a[1]), tareAt: iso(a[2]), grossAt: iso(a[3]), factoryGrossAt: iso(a[4]), factoryTareAt: iso(a[5]),
  vehicleId: a[6] || null, vehiclePlate: a[7], driverName: a[8], netWeightKg: a[9] || null, factoryNetWeightKg: a[10] || null, centerName: a[11] || null,
});

function readCache(orgId, day) {
  try { const raw = localStorage.getItem(`${CACHE}${orgId}:${day}`); return raw ? JSON.parse(raw).map(unpack) : null; } catch { return null; }
}
function writeCache(orgId, day, rows) {
  try { localStorage.setItem(`${CACHE}${orgId}:${day}`, JSON.stringify(rows.map(pack))); } catch { /* full or off: asked again next time */ }
}

/**
 * A day is settled once SETTLE_DAYS have passed: by then the mill has weighed
 * in every load the outstations sent, so its tickets no longer change and can
 * be kept. Fresher days are read again on every visit.
 */
const SETTLE_DAYS = 3;
const settled = (day, today) => Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`) > SETTLE_DAYS * DAY_MS;

async function ticketsOfDay(orgId, day, today) {
  const key = `${orgId}|${day}`;
  const keep = settled(day, today);
  if (keep) {
    if (held.has(key)) return held.get(key);
    const c = readCache(orgId, day);
    if (c) { held.set(key, c); return c; }
  }
  const res = await getWeighmentDay({ orgId, day });
  const rows = (res?.rows ?? []).map(pack).map(unpack);
  if (keep) { held.set(key, rows); writeCache(orgId, day, rows); }
  return rows;
}

async function inBatches(items, n, fn) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

/** Every weighbridge ticket over the days. Throws on the first refusal (no rights). */
export async function loadTickets(orgId, days, onProgress) {
  const today = fleetToday();
  const out = [];
  let done = 0;
  await inBatches(days, AT_ONCE, async (day) => {
    const rows = await ticketsOfDay(orgId, day, today);
    out.push(...rows);
    onProgress?.(++done, days.length);
  });
  return out;
}

/** The organisation's trips that began between the two instants (ms), every page. */
async function tripsBetween(orgId, from, to) {
  const out = [];
  let cursor = null;
  for (let page = 0; page < 100; page++) {
    const q = new URLSearchParams({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), limit: "200", ...(cursor ? { cursor } : {}) });
    const res = await apiFetch(`/api/v1/organisations/${orgId}/trips?${q}`);
    for (const t of res?.data ?? []) {
      out.push({
        id: t.id, driverId: t.driverId ?? t.driver?.id ?? null, vehicleId: t.vehicleId ?? t.vehicle?.id ?? null,
        plate: t.vehicle?.registrationPlate ?? null, from: Date.parse(t.beganAt), to: Date.parse(t.endedAt ?? t.beganAt),
      });
    }
    cursor = res?.meta?.hasNextPage ? res.meta.cursor : null;
    if (!cursor) break;
  }
  return out;
}

const TRIP_SPAN_DAYS = 3;
const tripHeld = new Map();   // `${org}|${from}` → Promise of the span's trips, for this visit

/**
 * The organisation's trips over the window, read as spans of TRIP_SPAN_DAYS
 * side by side: one long paged list took minutes on a fleet of 600 units.
 */
export async function loadTrips(orgId, from, to, onProgress) {
  const spans = [];
  for (let t = from; t < to; t += TRIP_SPAN_DAYS * DAY_MS) spans.push([t, Math.min(to, t + TRIP_SPAN_DAYS * DAY_MS - 1)]);
  const out = [];
  let done = 0;
  const recent = Date.now() - (SETTLE_DAYS + 1) * DAY_MS;
  await inBatches(spans, AT_ONCE, async ([a, b]) => {
    const key = `${orgId}|${a}`;
    const p = b < recent && tripHeld.has(key) ? tripHeld.get(key) : tripsBetween(orgId, a, b);
    if (b < recent) tripHeld.set(key, p);
    try { out.push(...await p); } catch (err) { tripHeld.delete(key); throw err; }
    onProgress?.(++done, spans.length);
  });
  return out;
}

/**
 * Weighbridge tonnes per driver over the last `days` fleet days.
 *
 * `onProgress({ step, done, total })` reports the tickets, then the trips.
 * `onPartial(credit)` hands over the tickets matched by name alone as soon as
 * the tickets are in, so the page has figures while the trips are read.
 * @returns {Promise<ReturnType<typeof creditTonnage> & {days: number, tripsRead: boolean}>}
 */
export async function loadWeighbridgeCredit({ orgId, drivers, days = 90, onProgress, onPartial }) {
  const list = fleetDays(days);
  const from = Date.parse(`${list[0]}T00:00:00+03:00`) - DAY_MS;
  const to = Date.now();
  let ticketsDone = false;
  const ticketsP = loadTickets(orgId, list, (done, total) => onProgress?.({ step: "tickets", done, total }))
    .then((t) => {
      ticketsDone = true;
      onPartial?.({ ...creditTonnage({ tickets: t, trips: [], drivers }), days, tripsRead: false, partial: true });
      return t;
    });
  const tripsP = loadTrips(orgId, from, to, (done, total) => { if (ticketsDone) onProgress?.({ step: "trips", done, total }); })
    .catch(() => null);
  const [tickets, trips] = await Promise.all([ticketsP, tripsP]);
  return { ...creditTonnage({ tickets, trips: trips ?? [], drivers }), days, tripsRead: trips != null };
}
