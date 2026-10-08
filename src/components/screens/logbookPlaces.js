/**
 * The Logbook's places on a map: their names in Title Case, the short label,
 * and the one overlay that lays the labels beside their circles. Shared by
 * the Logbook map (UsageReviewScreen) and its day playback (LogbookPlayback).
 */
import { maps as mapsNs } from "../../lib/mapEngine";

/**
 * A place name in Title Case: OpenStreetMap spells many in lower case ("riat
 * centre, Kanyikela"). Only the name is touched — a trailing "(north-west,
 * 0.9 km)" stays as written — and only first letters are raised, so "KDW" or
 * "C103" are left alone.
 */
export const placeCase = (name) => {
  if (!name) return name;
  const cut = name.indexOf(" (");
  const head = cut >= 0 ? name.slice(0, cut) : name;
  const tail = cut >= 0 ? name.slice(cut) : "";
  return head.replace(/(^|[\s,/–-])(\p{Ll})/gu, (_, sep, ch) => sep + ch.toUpperCase()) + tail;
};
/**
 * The places' names, drawn beside their circles (operator, 2026-10-08). One
 * layer for all of them so the names can give way to each other: a name that
 * would overlap one already placed is left out, the picked place first and
 * then by rank (most hours), so zooming in brings the hidden ones back.
 */
/**
 * A place's name as the map label shows it: the exact name's first part, in
 * full ("Bukembe East, Kanduyi (NE, 1.2 km)" → "Bukembe East"). The ward and
 * the direction that tells two same-named places apart stay in the hover card
 * and the table; on the map the number beside it already does that.
 */
/** The map label: Google's name as it is, OpenStreetMap's shortened. */
export const labelOf = (p, gnames) => gnames?.get(p.id) ?? shortPlace(placeCase(p.name));

const shortPlace = (name) => {
  if (!name) return name;
  const cut = name.indexOf(" (");
  return (cut >= 0 ? name.slice(0, cut) : name).split(",")[0].trim();
};

export class PlaceNames extends mapsNs.OverlayView {
  constructor() { super(); this.items = []; this.div = null; }
  /** items: { id, lat, lng, text, gap (px from the centre), dim, strong } */
  set(items) { this.items = items; this.render(); }
  onAdd() {
    this.div = document.createElement("div");
    this.div.className = "urv-names";
    this.getPanes().overlayLayer.appendChild(this.div);
    this.render();
  }
  onRemove() { this.div?.remove(); this.div = null; }
  render() {
    if (!this.div) return;
    this.div.replaceChildren();
    this.spans = this.items.map((it) => {
      const sp = document.createElement("span");
      sp.className = `urv-name${it.dim ? " is-dim" : ""}${it.strong ? " is-on" : ""}`;
      sp.textContent = it.text;
      this.div.appendChild(sp);
      return { it, sp, w: sp.offsetWidth, h: sp.offsetHeight };
    });
    this.draw();
  }
  draw() {
    const proj = this.getProjection();
    if (!this.div || !proj || !this.spans) return;
    const at = new Map(this.spans.map((s) => [s, proj.fromLatLngToDivPixel({ lat: s.it.lat, lng: s.it.lng })]));
    // The circles are in the way too: a name never covers another place.
    const circles = this.spans.map((s) => {
      const p = at.get(s), r = s.it.gap - 5;
      return { s, x: p.x - r, y: p.y - r, w: 2 * r, h: 2 * r };
    });
    const hits = (box, own) => (k) => k.s !== own && box.x < k.x + k.w + 2 && k.x < box.x + box.w + 2 && box.y < k.y + k.h && k.y < box.y + box.h;
    const kept = [];
    const order = [...this.spans].sort((a, b) => (b.it.strong - a.it.strong) || (a.it.id - b.it.id));
    for (const s of order) {
      const p = at.get(s);
      const y = p.y - s.h / 2;
      // Right of the circle, else left of it, else left out.
      const box = [{ x: p.x + s.it.gap, y, w: s.w, h: s.h }, { x: p.x - s.it.gap - s.w, y, w: s.w, h: s.h }]
        .find((bx) => !kept.some(hits(bx, s)) && !circles.some(hits(bx, s)));
      s.sp.style.display = box ? "" : "none";
      if (!box) continue;
      s.sp.style.transform = `translate(${Math.round(box.x)}px, ${Math.round(box.y)}px)`;
      kept.push({ ...box, s });
    }
  }
}

