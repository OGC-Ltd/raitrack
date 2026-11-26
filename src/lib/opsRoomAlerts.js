// The Ops Room Operator's pop-ups (operator, 2026-11-25): a pop-up in the
// corner for every weighing (the gate's were taken out the same day), and one that stays until
// acknowledged when a unit gets its second (or later) ticket of the day.
//
// For the Ops Room Operator only: people with the Gate log and no live feed
// (`gate_log:read` without `notification:read`). Everyone else hears the live
// stream's pop-ups as before. Read every 30 s (components/shared/OpsRoomAlerts);
// no sound. Acknowledgements are kept in this browser only.
//
// Pure apart from storage, which is wrapped so a blocked store never breaks the page.


export const CHECK_MS = 30_000;

/**
 * Older than this when it reaches us, an event does not pop up (operator,
 * 2026-11-25: "why is it bringing me old weighbridge notifications?").
 * FactorySuite sends a weighbridge ticket only once it is complete, so a
 * ticket weighed empty at 05:11 and loaded at 11:44 first reached us at 11:53.
 * Those stay on the Weighbridges page and the Gate log; the corner is for now.
 */
export const MAX_AGE_MS = 60 * 60_000;

/** Whether an event at `at` (ISO) is recent enough to pop up. */
export const isRecent = (at, now = Date.now(), maxAge = MAX_AGE_MS) => {
  const t = Date.parse(at);
  return Number.isFinite(t) && now - t <= maxAge;
};

const CLOCK = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false });
/** " at 11:44", or nothing when the time is unreadable. */
const atClock = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? ` at ${CLOCK.format(t)}` : ""; };

/** Whether this person gets these pop-ups. `can` is usePermissions' can. */
export const wantsOpsRoomAlerts = (can) => Boolean(can("gate_log:read") && !can("notification:read"));

const kg = (n) => (Number.isFinite(n) ? `${Math.round(n).toLocaleString("en-GB")} kg` : null);

const STAMP_WORDS = {
  gross: "weighed loaded",
  tare: "weighed empty",
  factoryGross: "weighed loaded at the factory",
  factoryTare: "weighed empty at the factory",
};

/** A weighing (server weighments/recent) → a toast for lib/toasts. */
export function weighingToast(w) {
  const where = [w.centerName, w.bridgeNo ? `bridge ${w.bridgeNo}` : null].filter(Boolean).join(", ");
  const bits = [where, kg(w.kg), w.driverName ? w.driverName : null].filter(Boolean);
  return {
    id: `wb:${w.id}`,
    kind: "weighbridge",
    level: "info",
    title: `${w.vehicleNo || w.plate}: ${STAMP_WORDS[w.stamp] ?? "weighed"}${atClock(w.at)}`,
    body: `Ticket ${w.tokenNumber}${bits.length ? ` · ${bits.join(" · ")}` : ""}`,
    at: w.at,
    // A click opens the Weighbridges page on this ticket (lib/rowFocus).
    data: { icon: "ti-scale", go: { page: "weighbridges", id: w.ticketId } },
  };
}

/**
 * The tickets that need acknowledging: a unit's second or later ticket today,
 * one alert per ticket (not per weighing), oldest first.
 */
export function secondTickets(weighings) {
  const byTicket = new Map();
  for (const w of weighings ?? []) {
    if (!(w.nthToday >= 2)) continue;
    const prev = byTicket.get(w.ticketId);
    if (!prev || Date.parse(w.at) < Date.parse(prev.at)) byTicket.set(w.ticketId, w);
  }
  return [...byTicket.values()]
    .map((w) => ({
      id: `wb2:${w.ticketId}`,
      ticketId: w.ticketId,
      at: w.at,
      title: `${w.vehicleNo || w.plate}: ticket ${w.nthToday} today`,
      body: `Ticket ${w.tokenNumber} at ${w.centerName}${w.driverName ? `, ${w.driverName}` : ""}. This unit was weighed on ${w.nthToday - 1 === 1 ? "another ticket" : `${w.nthToday - 1} other tickets`} today.`,
    }))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Items not seen before, oldest first; `seen` is updated. */
export function fresh(items, seen) {
  const out = [];
  for (const it of items ?? []) {
    if (seen.has(it.id)) continue;
    seen.add(it.id);
    out.push(it);
  }
  return out.sort((a, b) => Date.parse(a.at ?? a.ts) - Date.parse(b.at ?? b.ts));
}

// ── acknowledgements, this browser only ──────────────────────────────────────

const ACK_KEY = "ft-ops-room-acks";
/** Kept a few days, then dropped: a ticket's alert only matters on its day. */
const ACK_KEEP_MS = 3 * 86_400_000;

export function readAcks(store = globalThis.localStorage, now = Date.now()) {
  try {
    const raw = JSON.parse(store?.getItem(ACK_KEY) ?? "{}");
    return Object.fromEntries(Object.entries(raw).filter(([, at]) => Number.isFinite(at) && now - at < ACK_KEEP_MS));
  } catch {
    return {};
  }
}

export function writeAck(id, store = globalThis.localStorage, now = Date.now()) {
  const acks = { ...readAcks(store, now), [id]: now };
  try { store?.setItem(ACK_KEY, JSON.stringify(acks)); } catch { /* kept for this visit only */ }
  return acks;
}
