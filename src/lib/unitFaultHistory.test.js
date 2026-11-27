import { describe, it, expect } from "vitest";
import { faultMessages, WIALON_RUN_GAP_MS } from "./unitFaultHistory";

const T = Date.parse("2026-11-26T09:14:00+03:00");
const H = 3_600_000;

describe("a unit's fault history as messages", () => {
  it("words the tracker's probe fault with its reason, and its recovery", () => {
    const rows = faultMessages([{
      id: "e1", kind: "fuel_probe_fault", detail: "Fuel probe: Lost Contact with Tubes Error - Needs Replacement",
      startedAt: new Date(T).toISOString(), recoveredAt: new Date(T + 5 * H).toISOString(),
    }], [], T + 10 * H);
    expect(rows.map((r) => r.text)).toEqual(["Fuel probe reading again", "Fuel probe: Lost Contact with Tubes Error - Needs Replacement"]);
    expect(rows[0]).toMatchObject({ ok: true, durationMs: 5 * H, source: "Wialon/System" });
  });

  it("leaves an open fault open, with no recovery line", () => {
    const rows = faultMessages([{ id: "e2", kind: "signal_lost", startedAt: new Date(T).toISOString(), recoveredAt: null }], [], T + H);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "Tracker silent", ok: false, open: true });
  });

  it("turns Wialon's alerts into disconnected and reconnected", () => {
    const rows = faultMessages([], [{ at: T, to: T + 20 * 60_000, alerts: 21 }], T + 2 * H);
    expect(rows.map((r) => [r.text, r.source])).toEqual([["Probe reconnected", "Wialon"], ["Probe disconnected", "Wialon"]]);
    expect(rows[0].durationMs).toBe(20 * 60_000);
  });

  it("keeps a disconnection open while Wialon is still alerting", () => {
    const rows = faultMessages([], [{ at: T, to: T + H, alerts: 60 }], T + H + WIALON_RUN_GAP_MS - 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ text: "Probe disconnected", open: true });
  });

  it("orders both sources together, newest first", () => {
    const rows = faultMessages(
      [{ id: "e3", kind: "gps_not_reporting", startedAt: new Date(T - 2 * H).toISOString(), recoveredAt: new Date(T + 3 * H).toISOString() }],
      [{ at: T, to: T + H, alerts: 30 }],
      T + 10 * H,
    );
    expect(rows.map((r) => r.text)).toEqual(["GPS reporting again", "Probe reconnected", "Probe disconnected", "GPS stopped reporting"]);
  });

  it("words the tracker's status codes, and their recoveries", () => {
    const rows = faultMessages([
      { id: "s", kind: "fuel_probe_status", detail: "Fuel probe: Status Error", startedAt: new Date(T).toISOString(), recoveredAt: new Date(T + H).toISOString() },
      { id: "g", kind: "gnss_fault", detail: "GPS: On without Fix", startedAt: new Date(T + 2 * H).toISOString(), recoveredAt: null },
      { id: "b", kind: "fuel_probe_battery", detail: "Fuel probe battery: Needs Replacement (3.10 V)", startedAt: new Date(T - H).toISOString(), recoveredAt: null },
    ], [], T + 3 * H);
    expect(rows.map((r) => r.text)).toEqual(["GPS: On without Fix", "Fuel probe status normal", "Fuel probe: Status Error", "Fuel probe battery: Needs Replacement (3.10 V)"]);
    expect(rows.map((r) => r.source)).toEqual(["Wialon", "Wialon", "Wialon", "Wialon"]);
  });

  it("marks each record System, Wialon or both", () => {
    const at = new Date(T).toISOString();
    const src = (kind) => faultMessages([{ id: kind, kind, detail: "x", startedAt: at, recoveredAt: null }], [], T + H)[0].source;
    expect(src("signal_lost")).toBe("System");
    expect(src("fuel_probe_dead")).toBe("System");
    expect(src("fuel_probe_fault")).toBe("Wialon/System");
    expect(src("gnss_fault")).toBe("Wialon");
  });

  it("skips rows with no usable time", () => {
    expect(faultMessages([{ id: "x", kind: "signal_lost", startedAt: null }], [{ at: null }])).toEqual([]);
  });
});
