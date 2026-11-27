// A page asks the left menu (layout/SidePanel) to fold out of the way while it
// shows a side panel beside its table, and lets it back when the panel closes
// (operator, 2026-11-27, Maintenance: as Samad's Safety Compliance page). The
// menu folds only if it was open, and opens again only if it was this that
// folded it.
//
// The page makes room for the panel too: while one is open the body carries
// `dsb-room` (and `dsb-room--wide` for the wide panel), which the page's own
// stylesheet reads to stop its content short of the panel.

export const MENU_ROOM_EVENT = "raitrack:menu-room";

let open = 0;
let wideOpen = 0;

/** need: true while a side panel that wants room is open, false once it closes. */
export function askMenuRoom(need, { wide = false } = {}) {
  if (typeof window === "undefined") return;
  open = Math.max(0, open + (need ? 1 : -1));
  if (wide) wideOpen = Math.max(0, wideOpen + (need ? 1 : -1));
  document.body.classList.toggle("dsb-room", open > 0);
  document.body.classList.toggle("dsb-room--wide", wideOpen > 0);
  window.dispatchEvent(new CustomEvent(MENU_ROOM_EVENT, { detail: { need: open > 0 } }));
}
