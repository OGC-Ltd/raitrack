import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// No DOM in these tests: a window that dispatches events and a body whose classes are a set.
let classes;
beforeEach(() => {
  classes = new Set();
  globalThis.window = new EventTarget();
  globalThis.document = { body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } };
  vi.resetModules();
});
afterEach(() => { delete globalThis.window; delete globalThis.document; });

describe("a side panel asking for room (Maintenance, 2026-11-27)", () => {
  it("tells the menu while one is open, and marks the body for the page", async () => {
    const { askMenuRoom, MENU_ROOM_EVENT } = await import("./menuRoom");
    const seen = [];
    window.addEventListener(MENU_ROOM_EVENT, (e) => seen.push(e.detail.need));
    askMenuRoom(true);
    expect(classes.has("dsb-room")).toBe(true);
    expect(classes.has("dsb-room--wide")).toBe(false);
    askMenuRoom(false);
    expect(classes.has("dsb-room")).toBe(false);
    expect(seen).toEqual([true, false]);
  });

  it("marks the wide panel, and lets go only when the last panel closes", async () => {
    const { askMenuRoom, MENU_ROOM_EVENT } = await import("./menuRoom");
    const seen = [];
    window.addEventListener(MENU_ROOM_EVENT, (e) => seen.push(e.detail.need));
    askMenuRoom(true, { wide: true });
    askMenuRoom(true);
    expect(classes.has("dsb-room--wide")).toBe(true);
    askMenuRoom(false, { wide: true });
    expect(classes.has("dsb-room--wide")).toBe(false);
    expect(classes.has("dsb-room")).toBe(true);
    askMenuRoom(false);
    expect(seen).toEqual([true, true, true, false]);
    askMenuRoom(false); // an extra close never goes below zero
    expect(classes.has("dsb-room")).toBe(false);
  });
});
