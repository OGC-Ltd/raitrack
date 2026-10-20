/**
 * One side panel at a time (operator, 2026-10-20: "whenever we select the
 * notification it override the current side panel ... no cards or modal are
 * to be stacked over the other").
 *
 * The notifications feed, every page's detail sidebar (DetailSidebar), the
 * Drivers panel and the map's own cards and windows all live on or over the
 * right of the screen, and each was opened and closed on its own, so the
 * feed could open on top of an alert's sidebar and the other way round.
 *
 * Whatever opens CLAIMS the space with its own name, and everything else that
 * is open hears the claim and closes. The newest thing asked for wins; nothing
 * is stacked under it. A window event rather than shared state, because the
 * owners are far apart (the header, a page, the map) and each already closes
 * itself; this only tells them when.
 */

const EVENT = "ft-side-panel-claim";

/** Say that `owner` is opening, so everything else closes. */
export function claimSidePanel(owner) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { owner } }));
}

/**
 * Call `close` whenever something other than `owner` claims the space.
 * Returns the unsubscribe, for an effect's cleanup.
 */
export function onSidePanelClaim(owner, close) {
  if (typeof window === "undefined") return () => {};
  const on = (e) => { if (e.detail?.owner !== owner) close(); };
  window.addEventListener(EVENT, on);
  return () => window.removeEventListener(EVENT, on);
}
