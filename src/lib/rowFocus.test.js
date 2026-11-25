import { describe, it, expect } from "vitest";
import { requestRow, rowRequest, clearRowRequest, subscribeRowRequests, pageOf } from "./rowFocus";
import { weighingToast } from "./opsRoomAlerts";

describe("taking a pop-up to its line", () => {
  it("hands the request to its page only, newest click wins, and is cleared once shown", () => {
    let heard = 0;
    const off = subscribeRowRequests(() => heard++);
    requestRow("gateLog", "f1", "2026-11-25");
    requestRow("weighbridges", "t9");
    expect(rowRequest("gateLog")).toBeNull();
    const r = rowRequest("weighbridges");
    expect(r).toMatchObject({ page: "weighbridges", id: "t9" });
    clearRowRequest({ n: -1 });
    expect(rowRequest("weighbridges")).toBe(r);
    clearRowRequest(r);
    expect(rowRequest("weighbridges")).toBeNull();
    expect(heard).toBe(2);
    off();
  });

  it("finds the pager page of a line", () => {
    expect([pageOf(0, 15), pageOf(14, 15), pageOf(15, 15), pageOf(-1, 15)]).toEqual([0, 0, 1, 0]);
  });

  it("a weighbridge pop-up names its page and ticket", () => {
    expect(weighingToast({ id: "t1:gross", ticketId: "t1", stamp: "gross", at: "2026-11-25T09:00:00Z", plate: "P", tokenNumber: "1" }).data.go)
      .toEqual({ page: "weighbridges", id: "t1" });
  });
});
