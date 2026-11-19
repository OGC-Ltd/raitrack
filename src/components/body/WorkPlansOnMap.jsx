/**
 * FactorySuite work plans on the Live Map — the rail's Work plans switch.
 *
 * A plan-against-the-ground board. The map gets each planned work location's
 * geofence (or, without one, its area in Kasulu's estate drawing), with a
 * label carrying how many of its machines are on it, and a
 * tag under every planned machine's live marker, coloured by where it is now
 * (lib/workPlanMap: here, elsewhere on shift, off shift, not reporting, no
 * geofence to judge against). The tags move with the units' live stream; the
 * plans themselves are re-read when FactorySuite's work plan webhook says one
 * changed (hooks/useWorkPlans).
 *
 * Tabs under the head pick a department (or all of them); the whole card and
 * the map follow it: plans, counts, locations and machines.
 *
 * The card reads top-down: the day's plans, one bar of every machine split by
 * state, the work locations (here of planned), and the machines by department.
 * Two filters narrow the map and the list together: a state, picked from the
 * bar's key, and a work location, picked from its row or its label on the
 * map, which also takes the map to it. A machine row shows only that unit on
 * the map, zoomed in, without opening its side panel; the same row again, or
 * the map's "Showing X only" band, brings the fleet and the earlier view back.
 * Esc inside the card clears the filters.
 *
 * Where it sits (operator, 2026-11-14): the right-hand side panel, in the unit
 * panel's own column and styles, while no unit is open there (`docked`, a
 * portal into App's #wpm-dock). While a unit's panel is open the card is not
 * shown at all, and it comes back, as it was left, when that panel closes
 * (operator 2026-11-14); the plan's tags stay on the map meanwhile. Where it
 * cannot dock (a narrow screen, the fuel alerts open) it floats on the map
 * and can be dragged by its head (or moved with the arrow keys on its grip).
 * On a phone it is a card along the top of the map.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import { workPlanView, scopeView, fitDepartments, drawingAreas, WP_LABEL, WP_ORDER, WP_PLACE_COLOR, shiftText } from "../../lib/workPlanMap";
import { pathOf, middleOfPath } from "../../lib/planOverlay";
import { useNowTick } from "../../hooks/useNowTick";
import "./WorkPlansOnMap.css";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Below this zoom the estate's locations sit too close for names: counts only. */
const NAME_ZOOM = 13;
/** Below this the whole estate is a few pixels across: outlines only, no labels. */
const LABEL_ZOOM = 11;
/** The key's labels, cut to fit a machine row */
const ROW_STATE = { here: "At location", away: "Elsewhere", pending: "Pending", offshift: "Off shift", silent: "Not reporting", unplaced: "No geofence" };
/** Tags that need a look sit above the rest where they overlap. */
const TAG_Z = { away: 950, pending: 949, silent: 948, unplaced: 947, here: 946, offshift: 945 };

const placeHtml = (p, { compact, on, hide }) => hide && !on ? "<div class=\"wpm-place--hidden\"></div>" :
  `<div class="wpm-place${compact && !on ? " wpm-place--compact" : ""}${on ? " wpm-place--on" : ""}" ` +
  `title="${esc(p.name)}: ${p.here} of ${p.planned} planned machines here${p.drawn ? " (shape from the estate drawing)" : ""}">` +
  `<span class="wpm-place__name">${esc(p.name)}</span><b>${p.here}/${p.planned}</b></div>`;

const unitHtml = (u) =>
  `<div class="wpm-unit" data-tone="${u.tone}" ` +
  `title="${esc(`${u.machine}: ${u.line.activity} at ${u.line.workLocation ?? "no location"}. ${WP_LABEL[u.tone]}`)}">${esc(u.machine)}</div>`;

function dayLabel(day) {
  if (!day) return "";
  const d = new Date(`${day}T12:00:00+03:00`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Dar_es_Salaam" });
}

/** FactorySuite sends departments in capitals; the card sets them in title case. */
const titleCase = (s) => String(s ?? "").toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The department tabs. As many as fit the strip are tabs; the rest sit under
 * a "More" button at its end (operator 2026-11-14, for days that plan more
 * departments than fit). The picked department always keeps its tab. Widths
 * come from a hidden copy of every tab, measured again when the strip resizes.
 */
function DeptTabs({ departments, total, current, onPick }) {
  const wrapRef = useRef(null);
  const stripRef = useRef(null);
  const measureRef = useRef(null);
  const moreRef = useRef(null);
  const listRef = useRef(null);
  const [width, setWidth] = useState(0);
  const [open, setOpen] = useState(false);
  const [shownIdx, setShownIdx] = useState(null); // null until measured: every tab

  useLayoutEffect(() => {
    const el = stripRef.current;
    if (!el) return undefined;
    const read = () => setWidth(el.clientWidth);
    read();
    if (typeof ResizeObserver === "function") {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  const currentIdx = departments.findIndex((d) => d.name === current);
  useLayoutEffect(() => {
    const strip = stripRef.current;
    const m = measureRef.current;
    if (!strip || !m || !width) return;
    const cs = getComputedStyle(strip);
    const avail = strip.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const w = [...m.children].map((c) => c.getBoundingClientRect().width);
    setShownIdx(fitDepartments({
      all: w[0], depts: w.slice(1, -1), more: w[w.length - 1],
      gap: parseFloat(cs.columnGap) || 0, avail, current: currentIdx,
    }));
  }, [departments, width, currentIdx]);

  const shown = shownIdx ? shownIdx.map((i) => departments[i]) : departments;
  const hidden = shownIdx ? departments.filter((_, i) => !shownIdx.includes(i)) : [];
  useEffect(() => { if (!hidden.length) setOpen(false); }, [hidden.length]);

  // Open: focus the first department; a press outside closes it
  useEffect(() => {
    if (!open) return undefined;
    listRef.current?.querySelector("button")?.focus();
    const away = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  const pick = (name) => { setOpen(false); onPick(name); };
  const close = () => { setOpen(false); moreRef.current?.focus(); };

  const onStripKey = (e) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step) return;
    const tabs = [...e.currentTarget.querySelectorAll("button")];
    const at = tabs.indexOf(document.activeElement);
    if (at < 0) return;
    e.preventDefault();
    tabs[(at + step + tabs.length) % tabs.length].focus();
  };
  const onListKey = (e) => {
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); }
      close();
      return;
    }
    const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
    if (!step) return;
    const items = [...e.currentTarget.querySelectorAll("button")];
    const at = items.indexOf(document.activeElement);
    e.preventDefault();
    items[(at + step + items.length) % items.length].focus();
  };

  // The number on a tab is plan lines, as FactorySuite counts them; machines
  // (one machine can run two shifts) are in the title.
  const title = (d) => `${titleCase(d.name)}: ${plural(d.lines, "plan line")}${d.pending ? ` (${d.pending} pending approval)` : ""} on ${plural(d.units, "machine")}. Only these, here and on the map`;
  const hiddenLines = hidden.reduce((n, d) => n + d.lines, 0);

  return (
    <div ref={wrapRef} className="wpm-depts-wrap">
      <div ref={stripRef} className="wpm-depts" role="group" aria-label="Department" onKeyDown={onStripKey}>
        <button type="button" className="wpm-dept" aria-pressed={!current} onClick={() => pick(null)}>
          All <span className="wpm-dept__n">{total}</span>
        </button>
        {shown.map((d) => (
          <button type="button" key={d.name} className="wpm-dept" aria-pressed={current === d.name} onClick={() => pick(d.name)} title={title(d)}>
            {titleCase(d.name)} <span className="wpm-dept__n">{d.lines}</span>
          </button>
        ))}
        {hidden.length > 0 && (
          <button
            ref={moreRef} type="button" className="wpm-dept wpm-dept--more"
            aria-expanded={open} aria-controls="wpm-more" onClick={() => setOpen((v) => !v)}
            title={`${plural(hidden.length, "more department")}, ${plural(hiddenLines, "plan line")}`}
          >
            More <span className="wpm-dept__n">{hidden.length}</span>
            <i className="ti ti-chevron-down wpm-dept__chev" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Every tab at its widest, unseen, so the strip knows what fits */}
      <div ref={measureRef} className="wpm-depts wpm-depts--measure" aria-hidden="true">
        <span className="wpm-dept">All <span className="wpm-dept__n">{total}</span></span>
        {departments.map((d) => (
          <span key={d.name} className="wpm-dept">{titleCase(d.name)} <span className="wpm-dept__n">{d.lines}</span></span>
        ))}
        <span className="wpm-dept">More <span className="wpm-dept__n">{departments.length}</span><i className="ti ti-chevron-down wpm-dept__chev" /></span>
      </div>

      {open && (
        <div ref={listRef} id="wpm-more" className="wpm-more" role="group" aria-label="More departments" onKeyDown={onListKey}>
          {hidden.map((d) => (
            <button type="button" key={d.name} className="wpm-more__item" onClick={() => pick(d.name)} title={title(d)}>
              <span>{titleCase(d.name)}</span>
              <span className="wpm-dept__n">{d.lines}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** The estate drawing's areas, for work locations with no geofence. Read once
 *  per page (the file is ~470 KB) and only while the layer is on; a failed read
 *  is tried again next time. */
const NO_AREAS = [];
const drawingReads = new Map();
function useDrawingAreas(url) {
  const [areas, setAreas] = useState(NO_AREAS);
  useEffect(() => {
    if (!url) { setAreas(NO_AREAS); return undefined; }
    let live = true;
    if (!drawingReads.has(url)) {
      const read = fetch(url)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
        .then(drawingAreas);
      read.catch(() => drawingReads.delete(url));
      drawingReads.set(url, read);
    }
    drawingReads.get(url).then((a) => { if (live) setAreas(a); }, () => {});
    return () => { live = false; };
  }, [url]);
  return areas;
}

/** Where the floating card was left, per browser. A convenience: lost, it
 *  goes back to its corner. */
const POS_KEY = "ft-wpm-float-pos";
function readPos() {
  try {
    const p = JSON.parse(localStorage.getItem(POS_KEY) ?? "null");
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  } catch { return null; }
}
function savePos(p) {
  try { if (p) localStorage.setItem(POS_KEY, JSON.stringify(p)); else localStorage.removeItem(POS_KEY); } catch { /* private window */ }
}
/** The unit panel where it lies over the map (laptops, tablets), else null. */
const unitPanelRect = () => {
  const el = typeof document !== "undefined" ? document.querySelector(".vdp--open") : null;
  const r = el?.getBoundingClientRect();
  return r && r.width > 0 ? r : null;
};

export default function WorkPlansOnMap({ map, maps, DomMarker, data, loading, error, vehicles, zones, drawingUrl, onPickVehicle, onShowVehicle, onReleaseVehicle, isolatedVehicleId, docked: dockWanted, unitOpen, onClose }) {
  const now = useNowTick(30_000);
  const drawing = useDrawingAreas(drawingUrl);
  const allView = useMemo(() => workPlanView(data, vehicles, zones?.features, now, drawing), [data, vehicles, zones, now, drawing]);
  // The department tab: the card and the map show only its machines
  const [dept, setDept] = useState(null);
  const view = useMemo(() => scopeView(allView, dept), [allView, dept]);
  const deptOn = view && view !== allView ? dept : null;

  // Open on a desk, folded to its head on a phone, where it would cover the
  // top third of the map. The machine list starts closed either way: open, it
  // runs the card down the map's right side over the estate's eastern blocks.
  const [open, setOpen] = useState(() => !(typeof window !== "undefined" && window.matchMedia?.("(max-width: 600px)").matches));
  const [listOpen, setListOpen] = useState(Boolean(dockWanted));
  const [tone, setTone] = useState(null);     // one of WP_ORDER, or null for all
  const [placeKey, setPlaceKey] = useState(null); // "f:<fenceId>" | "n:<location name>" | null

  // Follow the zoom, so labels can drop their names when the map is wide
  const [zoom, setZoom] = useState(() => map?.getZoom?.() ?? NAME_ZOOM);
  useEffect(() => {
    if (!map) return undefined;
    setZoom(map.getZoom());
    const h = map.addListener("zoom_changed", () => setZoom(map.getZoom()));
    return () => h?.remove?.();
  }, [map]);

  // Every location the day plans for: those with a geofence (drawn, judged),
  // then those without one (listed, not judged), most machines first.
  const locations = useMemo(() => {
    if (!view) return [];
    const placed = view.places.map((p) => ({ ...p, key: `f:${p.fenceId}`, placed: true }));
    const bare = view.unplacedLocations.map((name) => ({
      key: `n:${name}`, name, placed: false, here: 0,
      planned: view.units.filter((u) => !u.fenceId && u.line.workLocation === name).length,
    }));
    const byPlanned = (a, b) => b.planned - a.planned || a.name.localeCompare(b.name, undefined, { numeric: true });
    return [...placed.sort(byPlanned), ...bare.sort(byPlanned)];
  }, [view]);
  const place = locations.find((l) => l.key === placeKey) ?? null;

  const matches = useCallback((u) => {
    if (tone && u.tone !== tone) return false;
    if (!place) return true;
    return place.placed ? u.fenceId === place.fenceId : !u.fenceId && u.line.workLocation === place.name;
  }, [tone, place]);
  const shown = useMemo(() => (view?.units ?? []).filter(matches), [view, matches]);
  const filtered = Boolean(tone || place);

  const cardRef = useRef(null);
  const headRef = useRef(null);
  const dockEl = dockWanted && typeof document !== "undefined" ? document.getElementById("wpm-dock") : null;
  const docked = Boolean(dockEl);
  const phone = useMediaQuery("(max-width: 767px)");
  const draggable = !docked && !phone;
  const bodyOpen = docked || open;

  /** True where the card spans the map (phones) rather than sitting beside it. */
  const isWide = useCallback(() => {
    const card = cardRef.current, div = map?.getDiv?.();
    return Boolean(!docked && card && div && card.offsetWidth >= div.offsetWidth * 0.7);
  }, [map, docked]);
  /**
   * What covers the map, as px off each side, so a camera move lands in the
   * part left open: nothing when the card is a column beside the map; beside
   * a floating card (and a unit panel lying over the map); below one that
   * spans the map. `folded` measures a spanning card by its head alone, for a
   * move that folds it first.
   */
  const cardInset = useCallback((edge, folded = false) => {
    const pad = { top: edge, left: edge, bottom: edge, right: edge };
    const card = cardRef.current, div = map?.getDiv?.();
    if (docked || !card || !div) return pad;
    const cr = card.getBoundingClientRect(), dr = div.getBoundingClientRect();
    if (isWide()) {
      const h = folded ? (headRef.current?.offsetHeight ?? cr.height) : cr.height;
      pad.top = Math.min(cr.top - dr.top + h + 16, dr.height * 0.55);
      return pad;
    }
    if (cr.left + cr.width / 2 > dr.left + dr.width / 2) pad.right = Math.max(edge, dr.right - cr.left + 16);
    else pad.left = Math.max(edge, cr.right - dr.left + 16);
    const vr = unitPanelRect();
    if (vr && vr.left < dr.right && vr.right > dr.left) pad.right = Math.max(pad.right, dr.right - vr.left + edge);
    return pad;
  }, [map, docked, isWide]);
  const fitPlace = useCallback((p) => {
    const path = p?.feature && pathOf(p.feature);
    if (!map || !maps || !path?.length) return;
    const b = new maps.LatLngBounds();
    path.forEach((pt) => b.extend(pt));
    // Frame it in the part of the map the card leaves clear
    map.fitBounds(b, cardInset(60));
  }, [map, maps, cardInset]);

  /* A machine row: only its unit on the map, zoomed in and ringed; no side
     panel, which opens from a click on the unit itself (operator,
     2026-11-14). The same row again brings the fleet back. On a phone the
     card spans the map, so it folds to its head first, leaving the unit in
     view and free to tap. */
  const showUnit = (u) => {
    if (!u.vehicleId) return;
    if (isolatedVehicleId === u.vehicleId) { onReleaseVehicle?.(); return; }
    const wide = isWide();
    if (wide) setOpen(false);
    onShowVehicle?.(u.vehicleId, cardInset(48, wide));
  };
  const isolated = isolatedVehicleId ? allView?.units.find((u) => u.vehicleId === isolatedVehicleId) ?? null : null;

  // ── Floating: dragged by its head, kept inside the map and off a unit
  //    panel lying over it ────────────────────────────────────────────────
  const [pos, setPos] = useState(readPos);
  const clampPos = useCallback((p) => {
    const card = cardRef.current, host = card?.offsetParent;
    if (!p || !card || !host) return p;
    const hr = host.getBoundingClientRect();
    let right = hr.width;
    const vr = unitPanelRect();
    if (vr && vr.left < hr.right && vr.right > hr.left) right = Math.min(right, vr.left - hr.left);
    const maxX = Math.max(8, right - card.offsetWidth - 8);
    const maxY = Math.max(8, hr.height - (headRef.current?.offsetHeight ?? 48) - 8);
    return { x: Math.round(Math.min(Math.max(p.x, 8), maxX)), y: Math.round(Math.min(Math.max(p.y, 8), maxY)) };
  }, []);
  const here = () => {
    const card = cardRef.current, host = card?.offsetParent;
    if (!card || !host) return null;
    const cr = card.getBoundingClientRect(), hr = host.getBoundingClientRect();
    return { x: cr.left - hr.left, y: cr.top - hr.top };
  };
  const drag = useRef(null);
  const onHeadDown = (e) => {
    if (!draggable || e.button !== 0 || e.target.closest("button")) return;
    const at = here();
    if (!at) return;
    drag.current = { px: e.clientX, py: e.clientY, ...at };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    cardRef.current.dataset.dragging = "";
  };
  const onHeadMove = (e) => {
    const d = drag.current;
    if (!d) return;
    setPos(clampPos({ x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }));
  };
  const onHeadUp = () => {
    if (!drag.current) return;
    drag.current = null;
    delete cardRef.current?.dataset.dragging;
    setPos((p) => { savePos(p); return p; });
  };
  const onGripKey = (e) => {
    if (e.key === "Home") { e.preventDefault(); setPos(null); savePos(null); return; }
    const step = e.shiftKey ? 64 : 16;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const at = pos ?? here();
    if (!at) return;
    const next = clampPos({ x: at.x + d[0], y: at.y + d[1] });
    setPos(next);
    savePos(next);
  };
  // Back inside when the map narrows, or a unit panel slides over it (its
  // width animates for 260ms, so measure after).
  useEffect(() => {
    if (!draggable) return undefined;
    const again = () => setPos((p) => clampPos(p));
    const t = setTimeout(again, 320);
    window.addEventListener("resize", again);
    return () => { clearTimeout(t); window.removeEventListener("resize", again); };
  }, [draggable, unitOpen, clampPos]);
  const floatStyle = draggable && pos
    ? { left: 0, top: 0, right: "auto", transform: `translate(${pos.x}px, ${pos.y}px)`, maxHeight: `calc(100% - ${pos.y + 16}px)` }
    : undefined;

  const pickPlace = useCallback((key) => {
    const next = key === placeKey ? null : key;
    setPlaceKey(next);
    if (next) {
      setListOpen(true);
      fitPlace(locations.find((l) => l.key === next));
    }
  }, [placeKey, locations, fitPlace]);
  const pickTone = (t) => {
    const next = t === tone ? null : t;
    setTone(next);
    if (next) setListOpen(true);
  };
  const clear = () => { setTone(null); setPlaceKey(null); };
  // A location belongs to the department picked before; a unit shown alone
  // from another department goes back with the fleet.
  const pickDept = (d) => {
    setDept(d);
    setPlaceKey(null);
    if (d && isolated && isolated.line.department !== d) onReleaseVehicle?.();
  };

  // Labels are built once per set of places; their clicks read the latest handler
  const pickPlaceRef = useRef(pickPlace);
  pickPlaceRef.current = pickPlace;

  // The work locations: fence outline + a label carrying its count
  const placeShapes = useRef(new Map());
  const placeSetKey = (view?.places ?? []).map((p) => p.fenceId).join(",");
  useEffect(() => {
    if (!map || !maps || !view) return undefined;
    const drawn = [];
    const shapes = new Map();
    for (const p of view.places) {
      const path = pathOf(p.feature);
      if (!path) continue;
      const poly = new maps.Polygon({ map, paths: path, strokeColor: WP_PLACE_COLOR, strokeWeight: 2, strokeOpacity: 0.9, fillColor: WP_PLACE_COLOR, fillOpacity: 0.08, zIndex: 38, clickable: false });
      drawn.push(poly);
      const at = middleOfPath(p.feature, path);
      let label = null;
      if (at && DomMarker) {
        const key = `f:${p.fenceId}`;
        label = new DomMarker({ position: at, anchor: "center", zIndex: 940, html: "", onClick: () => pickPlaceRef.current(key) });
        label.setMap(map);
        drawn.push(label);
      }
      shapes.set(p.fenceId, { poly, label, html: "" });
    }
    placeShapes.current = shapes;
    return () => { drawn.forEach((d) => d.setMap(null)); placeShapes.current = new Map(); };
    // Rebuilt only when the set of places changes; counts and focus update below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, maps, DomMarker, placeSetKey]);
  useEffect(() => {
    const compact = zoom < NAME_ZOOM;
    for (const p of view?.places ?? []) {
      const s = placeShapes.current.get(p.fenceId);
      if (!s) continue;
      const on = place?.fenceId === p.fenceId;
      const quiet = Boolean(place) && !on;
      s.poly.setOptions({ strokeWeight: on ? 3.5 : 2, strokeOpacity: quiet ? 0.45 : 0.9, fillOpacity: on ? 0.16 : quiet ? 0.03 : 0.08 });
      const html = placeHtml(p, { compact, on, hide: zoom < LABEL_ZOOM });
      if (s.label && s.html !== html) { s.label.setHtml(html); s.html = html; }
    }
  }, [view, zoom, place, placeSetKey]);

  // The machines: a tag under each live marker, moved as the unit moves.
  // Only the machines the filters keep are tagged, and only the one unit
  // while a row has isolated it: every other unit is off the map then.
  const unitTags = useRef(new Map());
  const tagged = useMemo(() => (isolated ? [isolated] : shown), [isolated, shown]);
  useEffect(() => {
    if (!map || !DomMarker) return;
    const seen = new Set();
    for (const u of tagged) {
      if (!u.position) continue;
      seen.add(u.key);
      const html = unitHtml(u);
      const have = unitTags.current.get(u.key);
      if (have) {
        have.marker.setPosition(u.position);
        if (have.html !== html) { have.marker.setHtml(html); have.html = html; }
        if (have.z !== TAG_Z[u.tone]) { have.marker.setZIndex?.(TAG_Z[u.tone]); have.z = TAG_Z[u.tone]; }
      } else {
        const marker = new DomMarker({
          position: u.position, anchor: "top", zIndex: TAG_Z[u.tone], html,
          onClick: u.vehicleId ? () => onPickVehicle?.(u.vehicleId) : undefined,
        });
        marker.setMap(map);
        unitTags.current.set(u.key, { marker, html, z: TAG_Z[u.tone] });
      }
    }
    for (const [k, t] of unitTags.current) {
      if (!seen.has(k)) { t.marker.setMap(null); unitTags.current.delete(k); }
    }
  }, [map, DomMarker, tagged, onPickVehicle]);
  useEffect(() => () => {
    for (const t of unitTags.current.values()) t.marker.setMap(null);
    unitTags.current.clear();
  }, [map]);

  const groups = useMemo(() => {
    const out = new Map();
    for (const u of shown) {
      const d = u.line.department;
      if (!out.has(d)) out.set(d, []);
      out.get(d).push(u);
    }
    return [...out.entries()];
  }, [shown]);

  const c = view?.counts;
  const full = Boolean(view && c.units > 0);
  const departments = allView?.departments ?? [];
  const statusText = view
    ? Object.entries(view.statuses).map(([s, n]) => `${n} ${s.toLowerCase()}`).join(", ")
    : "";
  const filterText = [tone && WP_LABEL[tone], place && `at ${place.name}`].filter(Boolean).join(" ");

  const panel = (
    <section
      ref={cardRef} className="wpm-card" data-mode={docked ? "docked" : "float"}
      data-open={bodyOpen ? "" : undefined} data-beside-unit={!docked && unitOpen ? "" : undefined}
      data-moved={floatStyle ? "" : undefined} style={floatStyle}
      aria-label="Work plans on the map"
      onKeyDown={(e) => { if (e.key === "Escape" && filtered) { e.stopPropagation(); clear(); } }}
    >
      <header
        ref={headRef} className="wpm-head" data-drag={draggable ? "" : undefined}
        onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}
      >
        <div className="wpm-head__top">
          <h2 className="wpm-name">Work plans</h2>
          <div className="wpm-tools">
            {draggable && (
              <button
                type="button" className="wpm-icon wpm-grip" onKeyDown={onGripKey}
                aria-label="Move the work plans card: arrow keys, Home puts it back" title="Drag the head to move the card"
              >
                <i className="ti ti-grip-vertical" aria-hidden="true" />
              </button>
            )}
            {!docked && (
              <button
                type="button" className="wpm-icon" aria-expanded={open} aria-controls="wpm-body"
                aria-label={open ? "Fold the work plans card" : "Open the work plans card"} onClick={() => setOpen((v) => !v)}
              >
                <i className="ti ti-chevron-down wpm-icon__chev" aria-hidden="true" />
              </button>
            )}
            <button type="button" className="wpm-icon" aria-label="Hide work plans" title="Hide work plans" onClick={onClose}>
              <i className="ti ti-x" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="wpm-meta">
          {view?.day && <span className="wpm-fact"><i className="ti ti-calendar" aria-hidden="true" />{dayLabel(view.day)}</span>}
          {full && (filtered
            ? <span className="wpm-chip wpm-chip--filter"><b>{shown.length}</b> {[tone && ROW_STATE[tone].toLowerCase(), place && `at ${place.name}`].filter(Boolean).join(" ")}</span>
            : <span className="wpm-chip" title={`${c.here} of the ${c.approvedUnits} machines on an approved plan are at the work location their plan assigns them now (${c.lines} plan lines)`}><b>{c.here}</b> of {c.approvedUnits} approved machines at their assigned place</span>)}
        </div>
      </header>

      {bodyOpen && full && departments.length > 1 && (
        <DeptTabs departments={departments} total={allView.counts.lines} current={deptOn} onPick={pickDept} />
      )}

      <div id="wpm-body" className="wpm-body" hidden={!bodyOpen}>
        {!view && loading && !error && (
          <div className="wpm-block">
            <div className="wpm-skel" aria-busy="true" aria-label="Reading today's plans from FactorySuite">
              <span className="wpm-skel__line wpm-skel__line--short" />
              <span className="wpm-skel__bar" />
              <span className="wpm-skel__line" />
              <span className="wpm-skel__line" />
            </div>
          </div>
        )}
        {!view && error && (
          <p className="wpm-block wpm-msg wpm-msg--error" role="status">
            FactorySuite could not be reached. Trying again each minute.
          </p>
        )}
        {((!view && !loading && !error) || (view && c.units === 0)) && (
          <p className="wpm-block wpm-msg">No work plans for today.</p>
        )}

        {full && (
          <>
            <section className="wpm-block" aria-labelledby="wpm-h-today">
              <div className="wpm-block__head">
                <h3 id="wpm-h-today" className="wpm-title">Today</h3>
                <span className="wpm-block__meta">{plural(c.plans, "plan")}{statusText ? `, ${statusText}` : ""}</span>
              </div>
              <p className="wpm-plans">
                {plural(c.lines, "plan line")} on {plural(c.units, "machine")}
                {c.pendingLines ? `, ${c.pendingLines} pending approval` : ""}. {c.onShift} on shift now.
              </p>
              <div className="wpm-bar" aria-hidden="true">
                {WP_ORDER.map((t) => c[t] > 0 && <span key={t} data-tone={t} style={{ flexGrow: c[t] }} />)}
              </div>
              <div className="wpm-keys" role="group" aria-label="Show only machines that are">
                {WP_ORDER.map((t) => (c[t] > 0 || t === "here" || t === "away") && (
                  <button
                    type="button" key={t} className="wpm-key" data-tone={t}
                    aria-pressed={tone === t} disabled={c[t] === 0}
                    onClick={() => pickTone(t)}
                  >
                    <span className="wpm-key__swatch" aria-hidden="true" />
                    <span className="wpm-key__label">{WP_LABEL[t]}</span>
                    <span className="wpm-key__n">{c[t]}</span>
                  </button>
                ))}
              </div>
              {filtered && (
                <p className="wpm-filter" role="status">
                  Showing {shown.length} of {c.units}: {filterText}.{" "}
                  <button type="button" className="wpm-link" onClick={clear}>Show all</button>
                </p>
              )}
            </section>

            <section className="wpm-block" aria-labelledby="wpm-h-places">
              <div className="wpm-block__head">
                <h3 id="wpm-h-places" className="wpm-title">Work locations</h3>
                <span className="wpm-block__meta">here of planned</span>
              </div>
              <ul className="wpm-places">
                {locations.filter((l) => l.placed).map((l) => (
                  <li key={l.key}>
                    <button
                      type="button" className="wpm-loc" aria-pressed={placeKey === l.key}
                      data-placed="" onClick={() => pickPlace(l.key)}
                      title={l.drawn ? `Show ${l.name} on the map. It has no geofence; its shape is from the estate drawing.` : `Show ${l.name} on the map`}
                    >
                      <span className="wpm-loc__name">{l.name}</span>
                      <span className="wpm-loc__n"><b>{l.here}</b> of {l.planned}</span>
                      <span className="wpm-meter" aria-hidden="true">
                        <i style={{ transform: `scaleX(${l.planned ? l.here / l.planned : 0})` }} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {locations.some((l) => !l.placed) && (
                <>
                  <p className="wpm-sub">No geofence yet, so not judged</p>
                  <ul className="wpm-places">
                    {locations.filter((l) => !l.placed).map((l) => (
                      <li key={l.key}>
                        <button
                          type="button" className="wpm-loc" aria-pressed={placeKey === l.key}
                          onClick={() => pickPlace(l.key)}
                          title={`${l.name} has no geofence. Draw one on the map with the same name and it is picked up.`}
                        >
                          <span className="wpm-loc__name">{l.name}</span>
                          <span className="wpm-loc__n wpm-loc__n--bare">{l.planned} planned</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>

            <section className="wpm-block wpm-block--list" aria-labelledby="wpm-h-machines">
              <button type="button" className="wpm-fold" aria-expanded={listOpen} aria-controls="wpm-list" onClick={() => setListOpen((v) => !v)}>
                <h3 id="wpm-h-machines" className="wpm-title">{deptOn ? `${titleCase(deptOn)} machines` : "Machines"}</h3>
                <span className="wpm-block__meta">{filtered ? `${shown.length} of ${c.units}` : c.units}</span>
                <i className="ti ti-chevron-down wpm-fold__chev" aria-hidden="true" />
              </button>
              {isolated && (
                <p className="wpm-only" role="status">
                  Only <b>{isolated.machine}</b> is on the map.{" "}
                  <button type="button" className="wpm-link" onClick={() => onReleaseVehicle?.()}>Show all units</button>
                </p>
              )}
              <div id="wpm-list" className="wpm-list" hidden={!listOpen}>
                {groups.length === 0 && <p className="wpm-msg">No machine matches. <button type="button" className="wpm-link" onClick={clear}>Show all</button></p>}
                {groups.map(([group, units]) => (
                  <div key={group} className="wpm-group" role="group" aria-label={titleCase(group)}>
                    {!deptOn && (
                      <button
                        type="button" className="wpm-group__head" onClick={() => pickDept(group)}
                        title={`Only ${titleCase(group)}, here and on the map`}
                      >
                        <span className="wpm-group__name">{titleCase(group)}</span>
                        <span className="wpm-group__n">{units.length}</span>
                        <span className="wpm-group__meta">{units.filter((u) => u.tone === "here").length} at location</span>
                      </button>
                    )}
                    {units.map((u) => {
                      const on = isolatedVehicleId != null && u.vehicleId === isolatedVehicleId;
                      return (
                        <button
                          type="button" key={u.key} className="wpm-row" data-tone={u.tone} aria-pressed={on}
                          disabled={!u.vehicleId || !u.position}
                          onClick={() => showUnit(u)}
                          title={!u.vehicleId ? `${u.machine} has no GPS unit of ours` : on ? "Show every unit again" : `Show only ${u.machine} on the map`}
                        >
                          <span className="wpm-row__main">
                            <span className="wpm-row__name">
                              <span className="wpm-row__code">{u.machine}</span>
                              {u.machineName ? <em>{u.machineName}</em> : null}
                            </span>
                            <span className="wpm-row__detail">
                              {u.line.activity} at {u.line.workLocation ?? "no location"}
                            </span>
                          </span>
                          <span className="wpm-row__when">
                            <span className="wpm-row__shift">
                              {shiftText(u.line)}{u.lines.length > 1 ? `, +${plural(u.lines.length - 1, "shift")}` : ""}
                            </span>
                            <span className="wpm-row__state" title={WP_LABEL[u.tone]}>{ROW_STATE[u.tone]}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </section>

            {view.noGps.length > 0 && (
              <p className="wpm-block wpm-foot">No GPS unit: {view.noGps.join(", ")}</p>
            )}
          </>
        )}
      </div>
    </section>
  );

  // A unit's panel is open: it has the side, and the card waits for it to
  // close. Only the card goes; the hooks above keep the tags on the map and
  // the card's tab, filters and list as they were.
  if (unitOpen) return null;
  return docked ? createPortal(panel, dockEl) : panel;
}
