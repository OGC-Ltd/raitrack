import { describe, it, expect } from "vitest";
import {
  buildBoard, fleetDayBounds, fleetRangeBounds, fleetDaysBetween, bucketLabel,
} from "./weighbridgeBoard";

/* The fleet day is Nairobi's, so every fixture stamp below is written with its
   +03:00 offset — the way the server sends them. A stamp written as bare UTC
   would land in the wrong bucket for three hours of every shift, which is the
   bug these tests exist to keep out. */
const DAY = "2026-09-09";
const t = (hhmm) => `${DAY}T${hhmm}:00+03:00`;
/* Late enough in the day that the "still out" figures have something to
   measure against, and fixed so the suite does not drift with the wall clock. */
const NOW = new Date(t("15:00")).getTime();

/** A delivery: cane brought into a site from the fields. */
const delivery = (o = {}) => ({
  id: o.id ?? `d-${Math.random()}`,
  category: "CANE_DELIVERY",
  vehicleNo: o.vehicleNo ?? "KTCC 849B",
  vehiclePlate: (o.vehicleNo ?? "KTCC 849B").replace(/\s/g, ""),
  centerCode: o.centerCode ?? 102,
  centerName: o.centerName ?? "OPAPO",
  tareAt: o.tareAt === undefined ? t("03:49") : o.tareAt,
  tareWeightKg: 6020,
  tareBridgeNo: 2,
  grossAt: o.grossAt === undefined ? t("11:38") : o.grossAt,
  grossBridgeNo: 1,
  netWeightKg: o.netWeightKg === undefined ? 6160 : o.netWeightKg,
  factoryGrossAt: null,
  factoryNetWeightKg: null,
});

/** A transfer: cane leaving an outstation for the mill. */
const transfer = (o = {}) => ({
  id: o.id ?? `x-${Math.random()}`,
  category: "CANE_TRANSFER",
  vehicleNo: o.vehicleNo ?? "KDL 708E",
  vehiclePlate: (o.vehicleNo ?? "KDL 708E").replace(/\s/g, ""),
  centerCode: o.centerCode ?? 102,
  centerName: o.centerName ?? "OPAPO",
  tareAt: o.tareAt === undefined ? t("06:19") : o.tareAt,
  tareWeightKg: 21260,
  tareBridgeNo: 3,
  grossAt: o.grossAt === undefined ? t("14:14") : o.grossAt,
  grossBridgeNo: 3,
  netWeightKg: o.netWeightKg === undefined ? 26800 : o.netWeightKg,
  factoryGrossAt: o.factoryGrossAt === undefined ? null : o.factoryGrossAt,
  factoryNetWeightKg: o.factoryNetWeightKg === undefined ? null : o.factoryNetWeightKg,
});

const build = (rows, now = NOW) => buildBoard(rows, { day: DAY, now });
const siteNamed = (board, name) => board.sites.find(s => s.name === name);

describe("the fleet day is Nairobi's", () => {
  it("opens at 21:00 UTC the evening before", () => {
    const { from, to } = fleetDayBounds(DAY);
    expect(new Date(from).toISOString()).toBe("2026-09-08T21:00:00.000Z");
    expect(to - from).toBe(86_400_000);
  });

  it("labels buckets on the fleet clock, not the reader's", () => {
    expect(bucketLabel(0)).toBe("00:00");
    expect(bucketLabel(13)).toBe("06:30");
    expect(bucketLabel(47)).toBe("23:30");
  });
});

describe("what a ticket says happened", () => {
  it("counts a delivery as received when it came back LOADED, not when the ticket opened", () => {
    const board = build([delivery()]);
    const opapo = siteNamed(board, "OPAPO");
    expect(opapo.receivedKg).toBe(6160);
    expect(opapo.receivedTrips).toBe(1);
    // 11:38 is bucket 23; nothing is credited at 03:49 when it weighed empty.
    expect(board.flow[22].receivedKg).toBe(0);
    expect(board.flow[23].receivedKg).toBe(6160);
  });

  it("counts a transfer's centre gross as a DEPARTURE, and never as cane received", () => {
    const board = build([transfer()]);
    const opapo = siteNamed(board, "OPAPO");
    expect(opapo.dispatchedKg).toBe(26800);
    expect(opapo.receivedKg).toBe(0);
  });

  it("holds a dispatched transfer on the road until the factory weighs it", () => {
    const board = build([transfer()]);
    expect(board.totals.onRoadRuns).toBe(1);
    expect(board.totals.onRoadKg).toBe(26800);
    expect(board.transit).toHaveLength(1);
    // 14:14 → 15:00 is 46 minutes.
    expect(board.transit[0].elapsedMs).toBe(46 * 60_000);
  });

  it("takes it off the road once it has", () => {
    const board = build([transfer({ factoryGrossAt: t("16:41"), factoryNetWeightKg: 26540 })], new Date(t("17:00")).getTime());
    expect(board.totals.onRoadRuns).toBe(0);
    expect(board.transit).toHaveLength(0);
  });

  it("credits the arrival to the MILL, not to the yard the cane left", () => {
    const rows = [
      delivery({ centerCode: 101, centerName: "FACTORY", netWeightKg: 16420 }),
      transfer({ factoryGrossAt: t("16:41"), factoryNetWeightKg: 26540 }),
    ];
    const board = build(rows, new Date(t("17:00")).getTime());
    expect(siteNamed(board, "FACTORY").arrivedKg).toBe(26540);
    expect(siteNamed(board, "FACTORY").arrivedRuns).toBe(1);
    // Opapo loaded it; it did not receive it back.
    expect(siteNamed(board, "OPAPO").arrivedKg).toBe(0);
  });

  it("counts a machine still out on an open ticket, split by what it is", () => {
    const board = build([
      delivery({ grossAt: null, netWeightKg: null }),
      transfer({ grossAt: null, netWeightKg: null }),
    ]);
    const opapo = siteNamed(board, "OPAPO");
    expect(opapo.openDeliveries).toBe(1);
    expect(opapo.openTransfers).toBe(1);
    expect(opapo.receivedKg).toBe(0);
    expect(opapo.dispatchedKg).toBe(0);
  });
});

describe("the book move is a movement, not a stock", () => {
  it("is what came in off the fields less what left for the mill", () => {
    const board = build([delivery(), delivery({ id: "d2", vehicleNo: "KTCC 686C" }), transfer()]);
    const opapo = siteNamed(board, "OPAPO");
    expect(opapo.bookMoveKg).toBe(6160 + 6160 - 26800);
  });

  it("leaves the mill out of the zone figure, so the same cane is not counted twice", () => {
    const board = build([
      delivery({ centerCode: 101, centerName: "FACTORY", netWeightKg: 16420 }),
      delivery(),
    ]);
    expect(board.totals.bookMoveKg).toBe(6160);
  });
});

describe("the flow line", () => {
  it("accumulates and stops at the hour the day has reached", () => {
    const board = build([delivery(), transfer()]);
    expect(board.flow).toHaveLength(31);          // 00:00 … 15:00
    expect(board.flow.at(-1).receivedKg).toBe(6160);
    expect(board.flow.at(-1).dispatchedKg).toBe(26800);
    expect(board.closed).toBe(false);
  });

  it("runs to midnight on a day that has closed", () => {
    const board = build([delivery()], new Date("2026-09-11T09:00:00+03:00").getTime());
    expect(board.flow).toHaveLength(48);
    expect(board.closed).toBe(true);
  });

  it("measures a closed day's stragglers against the day's end, not against now", () => {
    const board = build([transfer()], new Date("2026-09-11T09:00:00+03:00").getTime());
    // 14:14 to midnight — not the two days that have passed since.
    expect(board.transit[0].elapsedMs).toBe((9 * 60 + 46) * 60_000);
  });
});

describe("the activity feed", () => {
  it("is one entry per weighing, newest first, and names what happened", () => {
    const board = build([transfer({ factoryGrossAt: t("16:41"), factoryNetWeightKg: 26540 })], new Date(t("17:00")).getTime());
    expect(board.activity.map(a => a.kind)).toEqual(["arrived", "dispatched", "empty"]);
    expect(board.activity[0].from).toBe("OPAPO");
  });

  it("drops a stamp that belongs to another day rather than folding it into this one", () => {
    // A factory tare from the night before is common on a transfer, and it is
    // the stamp most likely to sit outside the day.
    const board = build([transfer({ tareAt: "2026-09-08T00:28:00+03:00" })]);
    expect(board.activity.some(a => a.kind === "empty")).toBe(false);
    expect(board.activity.some(a => a.kind === "dispatched")).toBe(true);
  });
});

describe("a fleet whose sites are named differently", () => {
  it("still ranks its mill first when it is called a mill", () => {
    const board = build([
      delivery({ centerCode: 7, centerName: "NAITIRI" }),
      delivery({ centerCode: 9, centerName: "WESTERN MILL", netWeightKg: 1 }),
    ]);
    expect(board.sites[0].name).toBe("WESTERN MILL");
    expect(board.sites[0].factory).toBe(true);
  });

  it("treats a site it cannot recognise as an ordinary outstation", () => {
    const board = build([delivery({ centerCode: 7, centerName: "NAITIRI" })]);
    expect(board.sites[0].factory).toBe(false);
  });
});

/* Sukari runs four. The day's rows are not the authority on how many there
   are — a yard that took no cane simply raises no ticket — so the board is
   seeded from the fleet's own centres and every one of them keeps a card. */
const SUKARI = [
  { code: 101, name: "FACTORY" },
  { code: 102, name: "OPAPO" },
  { code: 103, name: "OYANI" },
  { code: 104, name: "NYAONDO" },
];

describe("every bridge the fleet has, not only the ones that worked", () => {
  const board = buildBoard([delivery(), transfer()], { day: DAY, now: NOW, centres: SUKARI });

  it("draws a card for all four, on a day only one of them weighed", () => {
    expect(board.sites.map(s => s.name).sort())
      .toEqual(["FACTORY", "NYAONDO", "OPAPO", "OYANI"]);
  });

  it("marks the silent ones, and only them", () => {
    const silent = board.sites.filter(s => s.silentAllDay).map(s => s.name).sort();
    expect(silent).toEqual(["FACTORY", "NYAONDO", "OYANI"]);
    expect(siteNamed(board, "OPAPO").silentAllDay).toBe(false);
  });

  it("counts how many reported, which is the figure that explains a low total", () => {
    expect(board.totals.bridges).toBe(4);
    expect(board.totals.bridgesReporting).toBe(1);
  });

  it("adds nothing to the zone's tonnage for a bridge that weighed nothing", () => {
    const withoutSeed = build([delivery(), transfer()]);
    expect(board.totals.receivedKg).toBe(withoutSeed.totals.receivedKg);
    expect(board.totals.dispatchedKg).toBe(withoutSeed.totals.dispatchedKg);
    expect(board.totals.bookMoveKg).toBe(withoutSeed.totals.bookMoveKg);
  });

  it("still keeps the mill first once the quiet yards are in the list", () => {
    expect(board.sites[0].name).toBe("FACTORY");
  });

  it("gives a card to a bridge that appears in the day but not in the list", () => {
    const fresh = buildBoard([delivery({ centerCode: 105, centerName: "NEW SITE" })],
      { day: DAY, now: NOW, centres: SUKARI });
    expect(fresh.sites.map(s => s.code)).toContain(105);
    expect(fresh.totals.bridges).toBe(5);
  });

  it("draws the whole yard on a day nothing was weighed anywhere", () => {
    const quiet = buildBoard([], { day: DAY, now: NOW, centres: SUKARI });
    expect(quiet.sites).toHaveLength(4);
    expect(quiet.totals.bridgesReporting).toBe(0);
    expect(quiet.flow.every(p => p.receivedKg === 0)).toBe(true);
  });

  it("does not count a machine still out as a bridge that reported nothing", () => {
    // A ticket opened at Nyaondo and never closed is not silence: the scale
    // weighed that lorry empty, which is a weighing.
    const open = buildBoard([delivery({ centerCode: 104, centerName: "NYAONDO", grossAt: null, netWeightKg: null })],
      { day: DAY, now: NOW, centres: SUKARI });
    expect(siteNamed(open, "NYAONDO").silentAllDay).toBe(false);
    expect(open.totals.bridgesReporting).toBe(1);
  });
});

describe("what one load weighs here today", () => {
  it("is measured over the loads that came back, not over the tickets raised", () => {
    const board = buildBoard([
      delivery({ netWeightKg: 6000 }),
      delivery({ id: "d2", vehicleNo: "KBX 908M", netWeightKg: 10000 }),
      delivery({ id: "d3", vehicleNo: "KAW 512R", grossAt: null, netWeightKg: null }),
    ], { day: DAY, now: NOW });
    const opapo = siteNamed(board, "OPAPO");
    expect(opapo.avgLoadKg).toBe(8000);
    expect(opapo.openTickets).toBe(1);
  });

  it("is null, never zero, at a site where nothing has come back yet", () => {
    const board = buildBoard([delivery({ grossAt: null, netWeightKg: null })], { day: DAY, now: NOW });
    expect(siteNamed(board, "OPAPO").avgLoadKg).toBe(null);
  });
});

/* A range is N fleet days read as one span. The bucket count does not change —
   every card sparkline on the board is drawn from arrays of it — so what a
   bucket MEANS is the thing the span moves, and these pin that. */
describe("a run of days", () => {
  const dayAfter = "2026-09-10";
  const t2 = (hhmm) => `${dayAfter}T${hhmm}:00+03:00`;
  const AFTER = new Date(`${dayAfter}T23:59:00+03:00`).getTime();

  it("counts the days at both ends, inclusively", () => {
    expect(fleetDaysBetween(DAY, dayAfter)).toEqual(["2026-09-09", "2026-09-10"]);
    expect(fleetDaysBetween(DAY, DAY)).toEqual([DAY]);
  });

  it("reads a range given backwards the way it was meant", () => {
    expect(fleetDaysBetween(dayAfter, DAY)).toEqual(["2026-09-09", "2026-09-10"]);
    const a = fleetRangeBounds(DAY, dayAfter);
    const b = fleetRangeBounds(dayAfter, DAY);
    expect(a).toEqual(b);
  });

  it("spans both days, and keeps the same number of buckets", () => {
    const board = buildBoard(
      [delivery(), delivery({ id: "d2", grossAt: t2("09:30"), tareAt: t2("04:00"), netWeightKg: 5000 })],
      { from: DAY, to: dayAfter, now: AFTER },
    );
    expect(board.spanDays).toBe(2);
    expect(board.flow).toHaveLength(48);
    expect(board.bucketMs).toBe(2 * 86_400_000 / 48);
    // Both loads are in, and the second lands in the back half of the span.
    expect(board.totals.receivedKg).toBe(6160 + 5000);
    expect(board.flow[23].receivedKg).toBe(6160);
    expect(board.flow.at(-1).receivedKg).toBe(11160);
  });

  it("labels a day by the clock and a span by the date", () => {
    const oneDay = buildBoard([delivery()], { day: DAY, now: NOW });
    expect(oneDay.axis).toEqual(["06:00", "12:00", "18:00"]);
    expect(oneDay.spanDays).toBe(1);

    const twoDays = buildBoard([delivery()], { from: DAY, to: dayAfter, now: AFTER });
    // "Sep 09", the spelling every other date on the Analytics page uses.
    expect(twoDays.axis.every(a => /^[A-Z][a-z]{2} \d{2}$/.test(a))).toBe(true);
  });

  it("keeps a stamp outside the SPAN out of the feed, not just outside a day", () => {
    const board = buildBoard(
      [delivery({ tareAt: "2026-09-07T22:00:00+03:00" })],
      { from: DAY, to: dayAfter, now: AFTER },
    );
    expect(board.activity.some(a => a.kind === "empty")).toBe(false);
    expect(board.activity.some(a => a.kind === "received")).toBe(true);
  });

  it("still measures a straggler against the END of the span", () => {
    const board = buildBoard([transfer()], { from: DAY, to: dayAfter, now: AFTER });
    // Loaded at 14:14 on the first day, and the span closes a day later.
    expect(board.transit[0].elapsedMs).toBe((24 + 9) * 3_600_000 + 45 * 60_000);
  });
});
