import { describe, it, expect } from "vitest";
import { boardDoc, coverageDoc, fitCols, MAX_TABLE_ROWS, roadByYard, spanWords, ticketsDoc, TICKET_UPRIGHT } from "./weighbridgeDocs";
import { buildBoard, roadUnits, FIELDS } from "./weighbridgeBoard";

const NOW = Date.parse("2026-11-18T12:00:00+03:00");
const HEAD = [
  "Date", "Time", "Vehicle", "Driver", "Type", "Token", "Centre",
  "Tare (kg)", "Tare at", "Gross (kg)", "Gross at", "Net (kg)", "Payload (t)",
  "Load time", "Ticket no. today", "Tickets today", "Since previous",
];
const ticket = (date, time, plate = "KTCC 787D") => [
  date, time, plate, "John Otieno", "Delivery", "T-1", "NYAONDO",
  6020, "16/11 23:40", 12180, `${date.slice(0, 5)} 13:10`, 6160, "6.16", "6h 50m", 1, 2, "first",
];
const tables = (doc) => doc.blocks.filter((b) => b.kind === "table");
const heads = (doc) => doc.blocks.filter((b) => b.kind === "h2").map((b) => b.title);

describe("spanWords", () => {
  it("says the days in full", () => {
    expect(spanWords("2026-11-17", "2026-11-17")).toBe("17 Nov 2026");
    expect(spanWords("2026-11-10", "2026-11-17")).toBe("10 Nov 2026 – 17 Nov 2026");
  });
});

describe("fitCols", () => {
  it("sets figures right, gives the flex column the room left, and fits each heading", () => {
    const cols = fitCols(["Unit", "Driver", "Net, t"], [["KTCC 787D", "A very long driver name indeed", "6.16"]], { flex: 1 });
    expect(cols[1]).toEqual({ w: 0, wrap: true });
    expect(cols[2].align).toBe("right");
    expect(cols[0].align).toBeUndefined();
    expect(cols[0].w).toBeGreaterThan(9);
  });

  it("reads a cell given as an object by its text", () => {
    const cols = fitCols(["Past its run"], [[{ text: "Yes", bold: true }], [""]]);
    expect(cols[0].w).toBeGreaterThan(9);
  });
});

describe("ticketsDoc", () => {
  const body = [ticket("17/11/2026", "06:20"), ticket("17/11/2026", "07:00", "KDL 708E"), ticket("18/11/2026", "05:10")];

  it("is a section a day, the date in the heading and out of the table", () => {
    const doc = ticketsDoc({ head: HEAD, body, fleet: "Sukari", orgCode: "SUKARI", bridge: "NYAONDO", span: "17 Nov 2026 – 18 Nov 2026", netKg: 18480, now: NOW });
    expect(heads(doc)).toEqual(["1. Overview", "2. 17/11/2026", "3. 18/11/2026"]);
    const [first, second] = tables(doc);
    expect(first.head[0]).toBe("Time");
    expect(first.rows.map((r) => r[0].text)).toEqual(["06:20", "07:00"]);
    expect(second.rows).toHaveLength(1);
    // The date in the heading, the ticket's number and the day's count as one "1 of 2"
    // One bridge picked: Centre is in the facts, not on every row
    expect(first.head).toHaveLength(HEAD.length - 3);
    expect(first.head).not.toContain("Centre");
    const cell = (h) => first.rows[0][first.head.indexOf(h)].text;
    expect(cell("Today")).toBe("1 of 2");
    expect(first.head).toContain("Net, kg");
    // A weighing on the section's day by its clock; the night before keeps its date
    expect(cell("Gross at")).toBe("13:10");
    expect(cell("Tare at")).toBe("16/11 23:40");
    // A token is read, not added: set left
    expect(first.cols[first.head.indexOf("Token")].align).toBeUndefined();
    expect(first.cols[first.head.indexOf("Net, kg")].align).toBe("right");
    expect(doc.title).toBe("WEIGHBRIDGE TICKETS: NYAONDO");
    expect(doc.reportNo).toMatch(/^WB-SUKARI-20261118-/);
    expect(doc.meta.find((m) => m.label === "Weighbridge").value).toBe("NYAONDO");
    // The Driver column takes the room left
    expect(first.cols[first.head.indexOf("Driver")].w).toBe(0);
  });

  it("keeps what a clerk checks on an upright page", () => {
    const doc = ticketsDoc({ head: HEAD, body, fleet: "Sukari", span: "x", netKg: 0, landscape: false, now: NOW });
    expect(tables(doc)[0].head).toEqual(["Time", "Vehicle", "Driver", "Type", "Token", "Centre", "Tare, kg", "Tare at", "Gross, kg", "Gross at", "Net, kg", "Load time"]);
    expect(tables(doc)[0].rows[0]).toHaveLength(TICKET_UPRIGHT.length);
  });

  it("cuts a day longer than the server's largest table", () => {
    const many = Array.from({ length: MAX_TABLE_ROWS + 3 }, (_, i) => ticket("17/11/2026", String(i)));
    const doc = ticketsDoc({ head: HEAD, body: many, fleet: "Sukari", span: "x", netKg: 0, now: NOW });
    expect(tables(doc).map((t) => t.rows.length)).toEqual([MAX_TABLE_ROWS, 3]);
  });

  it("names the search when there is one", () => {
    const doc = ticketsDoc({ head: HEAD, body, fleet: "Sukari", span: "x", search: " 787 ", netKg: 0, now: NOW });
    expect(doc.meta.find((m) => m.label === "Matching").value).toBe("787");
    expect(ticketsDoc({ head: HEAD, body, fleet: "Sukari", span: "x", netKg: 0, now: NOW }).meta.some((m) => m.label === "Matching")).toBe(false);
  });
});

describe("coverageDoc", () => {
  it("is the overview and the table as on screen", () => {
    const head = ["Unit", "Weighbridges", "Days", "Trips", "Distance, km", "Km per trip"];
    const doc = coverageDoc({
      title: "Weighbridge Coverage at NYAONDO", head, body: [["KTCC 787D", "NYAONDO", 2, 3, "71.8", "23.9"]],
      figures: [{ label: "Units", value: "1" }], fleet: "Sukari", bridge: "NYAONDO", span: "17 Nov 2026", consolidated: true, now: NOW,
    });
    expect(heads(doc)).toEqual(["1. Overview", "2. By unit"]);
    expect(tables(doc)[0].cols[1]).toEqual({ w: 0, wrap: true });
    expect(doc.meta.find((m) => m.label === "Rows").value).toBe("One a unit");
    expect(doc.filename).toBe("Weighbridge Coverage at NYAONDO Sukari 17 Nov 2026");
  });

  it("says so when there are no rows", () => {
    const doc = coverageDoc({ title: "T", head: ["Day", "Unit"], body: [], figures: [], fleet: "S", span: "x", now: NOW });
    expect(doc.blocks.find((b) => b.kind === "none").text).toMatch(/No unit/);
  });
});

describe("boardDoc", () => {
  const DAY = "2026-09-09";
  const at = (hhmm) => `${DAY}T${hhmm}:00+03:00`;
  const rows = [
    { id: 1, category: "CANE_DELIVERY", vehicleNo: "KTCC 849B", vehiclePlate: "KTCC849B", centerCode: 102, centerName: "OPAPO",
      tareAt: at("03:49"), grossAt: at("11:38"), netWeightKg: 6160, factoryGrossAt: null, factoryNetWeightKg: null },
    { id: 2, category: "CANE_TRANSFER", vehicleNo: "KDL 708E", vehiclePlate: "KDL708E", centerCode: 102, centerName: "OPAPO",
      tareAt: at("06:19"), grossAt: at("09:14"), netWeightKg: 26800, factoryGrossAt: null, factoryNetWeightKg: null },
  ];
  const board = buildBoard(rows, { from: DAY, to: DAY, centres: [{ code: 1, name: "SUKARI FACTORY" }, { code: 102, name: "OPAPO" }], now: Date.parse(at("15:00")) });
  const units = roadUnits(board.transit, [], 4 * 3_600_000);

  it("holds the figures, a row a bridge, the vehicles out and the flow", () => {
    const doc = boardDoc(board, units, { fleet: "Sukari", orgCode: "SUKARI", span: "9 Sep 2026", now: NOW });
    expect(heads(doc)).toEqual(["1. Overview", "2. By weighbridge", "3. Vehicles on the road to the mill", "4. Each vehicle out", "5. Cane flow so far"]);
    const figures = doc.blocks.find((b) => b.kind === "figures").items;
    expect(figures.find((f) => f.label === "Received, t").value).toBe("6.2");
    const [sites, yards, out, flow] = tables(doc);
    expect(sites.rows.map((r) => r[0].text)).toEqual(["SUKARI FACTORY", "OPAPO"]);
    expect(yards.rows[0].map((c) => c.text)).toEqual(["OPAPO", "1", "26.8"]);
    expect(out.rows[0][0].text).toBe("KDL 708E");
    expect(out.rows[0][7]).toMatchObject({ text: "Yes", tone: "flag" });
    // Hourly running totals, ending with the hour reached
    expect(flow.rows.at(-1).slice(1).map((c) => c.text)).toEqual(["6.2", "26.8", "0.0"]);
    expect(flow.rows.length).toBeLessThanOrEqual(25);
  });

  it("files farm runs under Fields and gives every yard a line", () => {
    const yards = roadByYard(board.sites, [{ code: FIELDS, plate: "T1", netKg: null }]);
    expect(yards.map((y) => [y.name, y.units.length])).toEqual([["OPAPO", 0], ["Fields", 1]]);
  });
});
