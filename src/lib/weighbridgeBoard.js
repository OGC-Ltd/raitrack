/**
 * The cane-haulage control board, derived from one fleet day of tickets.
 *
 * Pure: rows in, board out. It lives here rather than inside the panel because
 * every figure on that board is a CLAIM about the yard — "26.8 t left Opapo at
 * 14:14 and has not reached the mill" — and a claim of that kind has to be
 * checkable in a test rather than read off a rendered card.
 *
 * ## What a weighbridge ticket can and cannot say
 *
 * This is the whole design, so it is stated before the code.
 *
 * We hold two kinds of ticket and four timestamps. A DELIVERY is cane brought
 * into a site from the fields: the machine weighs empty (`tareAt`), drives out
 * to the cane, and comes back loaded (`grossAt`) — which is why the middle
 * ticket sits 7h 39m between its two weighings, and why `grossAt` rather than
 * the token time is the moment the cane actually arrived. A TRANSFER is cane
 * leaving an outstation for the factory, and it is weighed four times: empty
 * and loaded at the centre, then loaded and empty again at the mill. So its
 * `grossAt` is a DEPARTURE and `factoryGrossAt` is an ARRIVAL, and the gap
 * between them is time on the road.
 *
 * That gives, honestly and without modelling anything:
 *
 *   received      deliveries that came back loaded, at their gross moment
 *   dispatched    transfers loaded and gone, at their centre gross moment
 *   arrived       transfers weighed at the factory
 *   on the road   dispatched, with no factory weighing yet
 *   open tickets  weighed empty, not yet back — the machine is out
 *
 * And it does NOT give three things a board of this kind usually shows, so
 * they are not drawn rather than estimated:
 *
 *   · a PHYSICAL yard count. Nothing weighs the heap on the ground; the only
 *     stock figure here is the book movement — what came in minus what went
 *     out — and it is labelled as such everywhere it appears.
 *   · what is EXPECTED from the fields. There is no harvest or field-dispatch
 *     feed behind these bridges. The one honest "expected" figure is what is
 *     already loaded and on the road, which the mill can genuinely expect.
 *   · whether a machine is standing ON SITE. A ticket open since 04:00 means
 *     the lorry is out at the farm far more often than it means it is parked
 *     at the scale, so that count is named for what it measures.
 *
 * ## Time
 *
 * Buckets are fleet-local (Africa/Nairobi, UTC+3), never the browser's zone:
 * two people opening the same day in Nairobi and in London must see the same
 * curve, and the server's own day boundary is this one.
 */

/** UTC+3, fixed. Kenya keeps no DST, which is why a bare offset is honest here
 *  where it would not be for most zones. Matches `fleetDayKey` in
 *  useFuelEvents and `lib/provider-time` on the server. */
const FLEET_OFFSET_MS = 3 * 3_600_000;

/** Forty-eight buckets across whatever span is being read.
 *
 *  Over one day that is the half hour it has always been — fine enough that a
 *  busy hour has shape, coarse enough that a four-ticket site is not drawn as
 *  noise. Over a week it is three and a half hours, and over a month a little
 *  over half a day. The COUNT is what is fixed, not the duration: every chart
 *  and every card sparkline on this board is drawn from these arrays, and a
 *  bucket count that grew with the range would turn a month into a picture
 *  with 1,488 points in a 300px card. */
export const BUCKETS   = 48;
/** The single-day bucket, which is what `bucketLabel` below reads. */
export const BUCKET_MS = 86_400_000 / BUCKETS;

/** [start, end) of a fleet day, as UTC instants. */
export function fleetDayBounds(dayKey) {
  const start = new Date(`${dayKey}T00:00:00.000Z`).getTime() - FLEET_OFFSET_MS;
  return { from: start, to: start + 86_400_000 };
}

/** [start, end) of a run of fleet days, both ends INCLUSIVE — "08 Sep to 10
 *  Sep" is three days, not two. A range given the wrong way round is read the
 *  way it was meant rather than returned empty: a picker where dragging
 *  backwards silently shows nothing is a control that looks broken. */
export function fleetRangeBounds(fromKey, toKey) {
  const a = fleetDayBounds(fromKey);
  const b = fleetDayBounds(toKey ?? fromKey);
  return a.from <= b.from
    ? { from: a.from, to: b.to }
    : { from: b.from, to: a.to };
}

/** Days in a range, inclusive — the list the screen fetches one by one. */
export function fleetDaysBetween(fromKey, toKey) {
  const { from, to } = fleetRangeBounds(fromKey, toKey);
  const out = [];
  for (let t = from; t < to; t += 86_400_000) {
    out.push(new Date(t + FLEET_OFFSET_MS).toISOString().slice(0, 10));
  }
  return out;
}

/* Fleet-local, for an axis that has to read the same in Nairobi and in
   London. A span of one day is labelled by the clock; anything longer by the
   date, because "14:30" repeated over a fortnight is an axis that says
   nothing about which fortnight. */
const HHMM = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Nairobi",
});
/* en-US, like every other date on the Analytics page. en-GB gives "09 Sept" —
   a four-letter abbreviation for the one month it spells that way, under a
   heading that says "Sep". */
const DAYMON = new Intl.DateTimeFormat("en-US", {
  month: "short", day: "2-digit", timeZone: "Africa/Nairobi",
});

/** Which half-hour of the fleet day an instant falls in, or null when it falls
 *  outside the day entirely — a factory tare taken the night before is common
 *  on a transfer, and it must not be folded into this day's first bucket. */
function bucketOf(at, from, bucketMs) {
  if (at == null) return null;
  const i = Math.floor((at - from) / bucketMs);
  return i >= 0 && i < BUCKETS ? i : null;
}

/** "06:30" for bucket 13 — read off the bucket index, so the axis is the
 *  fleet's clock whatever the viewer's machine is set to. */
export function bucketLabel(i) {
  const mins = i * (BUCKET_MS / 60_000);
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

const at = (iso) => (iso ? new Date(iso).getTime() : null);

/**
 * The mill, by name rather than by code.
 *
 * Sukari's is centre 101 "FACTORY", but that code is the provider's numbering
 * and another fleet's would differ. A site matching nothing here is drawn as
 * an ordinary outstation, which is the harmless direction to be wrong in: it
 * gets a stock line it should not have, rather than the board losing its
 * destination.
 */
const isFactoryName = (name) => /factory|mill/i.test(name ?? "");

function emptySite(code, name) {
  return {
    code,
    name,
    factory: isFactoryName(name),
    receivedKg: 0, receivedTrips: 0,
    dispatchedKg: 0, dispatchedRuns: 0,
    arrivedKg: 0, arrivedRuns: 0,
    onRoadKg: 0, onRoadRuns: 0,
    openDeliveries: 0, openTransfers: 0,
    lorries: new Set(),
    bridges: new Set(),
    lastAt: null,
    received: new Array(BUCKETS).fill(0),
    dispatched: new Array(BUCKETS).fill(0),
  };
}

/**
 * One fleet day of tickets, as the board reads it.
 *
 * @param {Array} rows  every ticket in the day, EVERY centre — a board built
 *                      from one centre's rows would report the mill as having
 *                      received nothing.
 * @param {{day: string, centres?: {code:number,name:string}[], now?: number,
 *          activityLimit?: number}} opts
 *
 * `centres` is the fleet's OWN bridges — the server takes them from the
 * organisation's whole ticket history, not from this day — and every one of
 * them gets a card whether or not it weighed anything. Sukari runs four, and a
 * yard that takes no cane on a Sunday is exactly the card an operator is
 * looking for: building the board from the day's rows alone made a silent
 * bridge DISAPPEAR, which reads as "all is well" when it is the one thing on
 * the board worth knowing.
 */
export function buildBoard(rows, {
  day, from: fromDay, to: toDay,
  centres = [], now = Date.now(), activityLimit = 40,
} = {}) {
  /* One day or a run of them. `day` is kept because most callers read one and
     a range of one is a range: everything below works in instants, and the
     only thing the span changes is how wide a bucket is and how its axis is
     labelled. */
  const first = fromDay ?? day;
  const last  = toDay ?? fromDay ?? day;
  const { from, to } = fleetRangeBounds(first, last);
  const spanDays = Math.round((to - from) / 86_400_000);
  const bucketMs = (to - from) / BUCKETS;
  /* The clock for one day, the date for more. Read off the bucket's own
     instant rather than off its index, so it stays true whatever the span. */
  const labelFor = (i) => {
    const at = from + i * bucketMs;
    return spanDays > 1 ? DAYMON.format(at) : HHMM.format(at);
  };
  /* What "still on the road" is measured against. For today that is the
     clock; for a past day it is the day's end, because a lorry is not eight
     days late — that day simply closed with no factory weighing on the ticket,
     which is a different statement and the panel makes it. */
  const asOf   = Math.min(now, to);
  const closed = now >= to;

  const sites    = new Map();
  const activity = [];
  const transit  = [];
  const flowReceived   = new Array(BUCKETS).fill(0);
  const flowDispatched = new Array(BUCKETS).fill(0);
  const flowArrived    = new Array(BUCKETS).fill(0);
  const lorries = new Set();

  const site = (code, name) => {
    let s = sites.get(code);
    if (!s) { s = emptySite(code, name); sites.set(code, s); }
    // The provider renames a centre occasionally; the latest spelling wins.
    if (name) { s.name = name; s.factory = isFactoryName(name); }
    return s;
  };

  const note = (when, entry) => {
    if (when == null || when < from || when >= to) return;
    activity.push({ at: when, ...entry });
  };

  /* The fleet's bridges first, so the board is the YARD rather than the day:
     a site that weighed nothing still has a card, reading zeroes and "No
     ticket yet", which is a statement. The day's rows then fill them in, and
     a centre that appears only in the rows (a bridge opening today, before it
     is anywhere in the history the list came from) still gets one. */
  for (const c of centres) site(c.code, c.name);

  for (const r of rows) {
    const s = site(r.centerCode, r.centerName);
    const transfer  = r.category === "CANE_TRANSFER";
    const tareAt    = at(r.tareAt);
    const grossAt   = at(r.grossAt);
    const factoryAt = at(r.factoryGrossAt);
    const net = r.netWeightKg ?? null;

    const plate = r.vehiclePlate || r.vehicleNo;
    if (plate) { s.lorries.add(plate); lorries.add(plate); }
    for (const b of [r.tareBridgeNo, r.grossBridgeNo]) if (b != null) s.bridges.add(b);

    // ── empty on the scale: the ticket opens ───────────────────────────────
    if (tareAt != null) {
      note(tareAt, {
        site: s.name, code: r.centerCode, vehicleNo: r.vehicleNo,
        kind: "empty", kg: r.tareWeightKg ?? null, transfer,
      });
      if (grossAt == null) {
        if (transfer) s.openTransfers += 1; else s.openDeliveries += 1;
      }
    }

    if (grossAt != null) {
      const b = bucketOf(grossAt, from, bucketMs);
      if (transfer) {
        // ── loaded and gone: a dispatch OUT of this centre ─────────────────
        s.dispatchedRuns += 1;
        if (net != null) {
          s.dispatchedKg += net;
          if (b != null) { s.dispatched[b] += net; flowDispatched[b] += net; }
        }
        note(grossAt, {
          site: s.name, code: r.centerCode, vehicleNo: r.vehicleNo,
          kind: "dispatched", kg: net, transfer: true,
        });
        if (factoryAt == null) {
          s.onRoadRuns += 1;
          if (net != null) s.onRoadKg += net;
          transit.push({
            id: r.id,
            vehicleNo: r.vehicleNo,
            site: s.name,
            code: r.centerCode,
            netKg: net,
            departedAt: grossAt,
            /* Floored at zero rather than allowed negative. A ticket edited at
               the scale after the fact can carry a gross stamp a few minutes
               ahead of the clock, and "−3m on the road" is not a thing to put
               on a board. */
            elapsedMs: Math.max(0, asOf - grossAt),
          });
        }
      } else {
        // ── back loaded from the fields: cane RECEIVED here ────────────────
        s.receivedTrips += 1;
        if (net != null) {
          s.receivedKg += net;
          if (b != null) { s.received[b] += net; flowReceived[b] += net; }
        }
        note(grossAt, {
          site: s.name, code: r.centerCode, vehicleNo: r.vehicleNo,
          kind: "received", kg: net, transfer: false,
        });
      }
      s.lastAt = Math.max(s.lastAt ?? 0, grossAt);
    }

    // ── weighed at the mill: the transfer lands ───────────────────────────
    if (transfer && factoryAt != null) {
      const fnet = r.factoryNetWeightKg ?? net;
      const b = bucketOf(factoryAt, from, bucketMs);
      if (fnet != null && b != null) flowArrived[b] += fnet;
      note(factoryAt, {
        site: "FACTORY", code: null, vehicleNo: r.vehicleNo,
        kind: "arrived", kg: fnet, transfer: true, from: s.name,
      });
    }
  }

  /* Arrivals are credited to the FACTORY's card in a second pass, not to the
     centre the cane left — the site row is where a transfer was LOADED, and
     counting its arrival against Opapo would have the outstation receiving its
     own cane back. A second pass rather than a lookup inside the loop above
     because the mill's card may not exist yet when the first transfer lands:
     rows arrive in ticket order, not in an order that puts the factory first.
     When a fleet's mill weighs nothing at all there is no card to credit, and
     the arrival still shows in the flow line and the activity feed — which is
     where it would be missed. */
  const mill = [...sites.values()].find(x => x.factory);
  if (mill) {
    for (const r of rows) {
      if (r.category !== "CANE_TRANSFER" || !r.factoryGrossAt) continue;
      const fnet = r.factoryNetWeightKg ?? r.netWeightKg;
      mill.arrivedRuns += 1;
      if (fnet != null) mill.arrivedKg += fnet;
      mill.lastAt = Math.max(mill.lastAt ?? 0, at(r.factoryGrossAt));
    }
  }

  const list = [...sites.values()]
    .map(s => ({
      ...s,
      lorries: s.lorries.size,
      bridges: [...s.bridges].sort((a, b) => a - b),
      /* Book MOVEMENT, not a stock level: what came in off the fields minus
         what left for the mill, over this day alone. Whatever was on the
         ground at dawn is not in it, because nothing we hold counts a heap. */
      bookMoveKg: s.receivedKg - s.dispatchedKg,
      /* Not one weighing all day. Kept as its own flag rather than left to the
         reader to infer from six zeroes — it is the card's whole message. */
      silentAllDay: s.lastAt == null && s.openDeliveries === 0 && s.openTransfers === 0,
      /* What one load off the fields weighed here TODAY, measured — the card
         uses it to say what an open ticket is likely to be worth when it comes
         back. Null rather than zero when nothing has come back yet: there is
         no average of no loads, and an estimate resting on one would be a
         number invented from a division by nothing. */
      avgLoadKg: s.receivedTrips > 0 ? s.receivedKg / s.receivedTrips : null,
      openTickets: s.openDeliveries + s.openTransfers,
    }))
    // The mill first — it is the destination every other card feeds — then the
    // busiest sites, so a quiet outstation never outranks a working one.
    .sort((a, b) =>
      (b.factory ? 1 : 0) - (a.factory ? 1 : 0) ||
      (b.receivedKg + b.dispatchedKg) - (a.receivedKg + a.dispatchedKg) ||
      a.code - b.code);

  // Only as far as the day has actually got. A line drawn flat to midnight on
  // a day still running reads as a yard that stopped at lunchtime.
  const lastBucket = closed
    ? BUCKETS - 1
    : Math.max(0, Math.min(BUCKETS - 1, Math.floor((asOf - from) / bucketMs)));

  let cr = 0, cd = 0, ca = 0;
  const flow = [];
  for (let i = 0; i <= lastBucket; i += 1) {
    cr += flowReceived[i]; cd += flowDispatched[i]; ca += flowArrived[i];
    flow.push({ i, label: labelFor(i), receivedKg: cr, dispatchedKg: cd, arrivedKg: ca });
  }

  transit.sort((a, b) => a.departedAt - b.departedAt);   // longest out, first
  activity.sort((a, b) => b.at - a.at);                  // newest first

  const sum = (fn) => list.reduce((n, s) => n + fn(s), 0);
  const totals = {
    receivedKg:     sum(s => s.receivedKg),
    receivedTrips:  sum(s => s.receivedTrips),
    dispatchedKg:   sum(s => s.dispatchedKg),
    dispatchedRuns: sum(s => s.dispatchedRuns),
    arrivedKg:      sum(s => s.arrivedKg),
    arrivedRuns:    sum(s => s.arrivedRuns),
    onRoadKg:       sum(s => s.onRoadKg),
    onRoadRuns:     sum(s => s.onRoadRuns),
    openTickets:    sum(s => s.openTickets),
    openDeliveries: sum(s => s.openDeliveries),
    openTransfers:  sum(s => s.openTransfers),
    /* The outstations only. The factory's "book move" is its whole intake,
       and adding it here would count the zone's cane once as received in the
       yards and again as standing at the mill. */
    bookMoveKg:     sum(s => (s.factory ? 0 : s.bookMoveKg)),
    lorries:        lorries.size,
    bridges:        list.length,
    /* Bridges that weighed something. "3 of 4 reporting" is the one figure on
       this board that is about the BOARD rather than about the cane, and it is
       the first thing to check when a total looks low. */
    bridgesReporting: list.filter(s => !s.silentAllDay).length,
  };

  return {
    day: first,
    from: first,
    to: last,
    spanDays,
    bucketMs,
    /* Three marks under each card's line. Quartiles rather than the ends, so a
       day reads 06:00 · 12:00 · 18:00 and a fortnight reads three dates inside
       it — an axis whose first label is the edge of the picture is a label
       nobody can place. */
    axis: [labelFor(12), labelFor(24), labelFor(36)],
    closed,
    asOf,
    sites: list,
    totals,
    flow,
    lastBucket,
    transit,
    activity: activity.slice(0, activityLimit),
    activityTotal: activity.length,
  };
}
