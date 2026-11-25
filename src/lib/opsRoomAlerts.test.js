import { describe, it, expect } from "vitest";
import { wantsOpsRoomAlerts, weighingToast, secondTickets, fresh, readAcks, writeAck, isRecent } from "./opsRoomAlerts";

const memStore = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const w = (id, stamp, at, nthToday = 1, extra = {}) => ({ id: `${id}:${stamp}`, ticketId: id, stamp, at, kg: 30120.4, bridgeNo: 2, plate: "KDA001A", vehicleNo: "KDA 001A", driverName: "J. Otieno", centerName: "Ndhiwa", tokenNumber: "5501", nthToday, ...extra });

describe("the Ops Room Operator's pop-ups", () => {
  it("are for people with the Gate log and no live feed only", () => {
    const has = (...p) => (x) => p.includes(x);
    expect(wantsOpsRoomAlerts(has("gate_log:read", "weighbridge:read"))).toBe(true);
    expect(wantsOpsRoomAlerts(has("gate_log:read", "notification:read"))).toBe(false);
    expect(wantsOpsRoomAlerts(has("weighbridge:read"))).toBe(false);
  });

  it("word a weighing with its bridge, weight and ticket", () => {
    expect(weighingToast(w("t1", "gross", "2026-11-25T09:00:00Z"))).toMatchObject({
      id: "wb:t1:gross", title: "KDA 001A: weighed loaded at 12:00", body: "Ticket 5501 · Ndhiwa, bridge 2 · 30,120 kg · J. Otieno",
    });
    expect(weighingToast(w("t1", "tare", "2026-11-25T09:30:00Z")).title).toBe("KDA 001A: weighed empty at 12:30");
  });

  it("let only events of the last hour pop up: a ticket that reaches us late stays on the pages", () => {
    const now = Date.parse("2026-11-25T09:00:00Z");
    expect(isRecent("2026-11-25T08:15:00Z", now)).toBe(true);
    expect(isRecent("2026-11-25T07:44:00Z", now)).toBe(false);
    expect(isRecent("not a time", now)).toBe(false);
  });

  it("raise one alert per second-or-later ticket, not per weighing", () => {
    const out = secondTickets([
      w("t1", "gross", "2026-11-25T05:00:00Z", 1),
      w("t2", "tare", "2026-11-25T11:00:00Z", 2),
      w("t2", "gross", "2026-11-25T10:00:00Z", 2),
      w("t3", "gross", "2026-11-25T12:00:00Z", 3),
    ]);
    expect(out.map((a) => a.id)).toEqual(["wb2:t2", "wb2:t3"]);
    expect(out[0]).toMatchObject({ at: "2026-11-25T10:00:00Z", title: "KDA 001A: ticket 2 today" });
    expect(out[1].body).toMatch(/2 other tickets today/);
  });

  it("let through only what was not seen, oldest first", () => {
    const seen = new Set(["a"]);
    expect(fresh([{ id: "c", at: "2026-11-25T10:00:00Z" }, { id: "a", at: "x" }, { id: "b", at: "2026-11-25T09:00:00Z" }], seen).map((i) => i.id)).toEqual(["b", "c"]);
    expect(fresh([{ id: "b", at: "x" }], seen)).toEqual([]);
  });

  it("keep acknowledgements in the browser for a few days, and survive a broken store", () => {
    const store = memStore();
    writeAck("wb2:t2", store, 1_000);
    expect(readAcks(store, 2_000)).toEqual({ "wb2:t2": 1_000 });
    expect(readAcks(store, 1_000 + 4 * 86_400_000)).toEqual({});
    const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(readAcks(broken)).toEqual({});
    expect(writeAck("x", broken)).toEqual({ x: expect.any(Number) });
  });
});
