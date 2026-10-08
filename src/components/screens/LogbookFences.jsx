/**
 * Fences on the Logbook map, and a tool to draw them (operator, 2026-10-09).
 *
 * The Logbook is going to say WHERE inside a site a unit spent its time —
 * "Sukari Industries · Weighbridge (work area)", not just "at work". That needs
 * the areas inside a site as fences, and the provider's zones rarely have them
 * (three organisations have no zones at all). So they are drawn here, on the
 * map that shows where the unit actually stood.
 *
 *   · The organisation's site fences (areas up to MAX_SITE_HA — the ones the
 *     Logbook counts as work areas) are outlined over the route, named.
 *   · Draw: click the corners, click the first corner (or Finish) to close.
 *     A fence drawn wholly inside another starts with that one's name —
 *     "Sukari Industries · " — so the inside area reads as part of its site.
 *   · A fence drawn here can be renamed or removed. One from Wialon is shown
 *     but not edited: the next sync would put it back as it was.
 *
 * Saved fences are ordinary geofences (no vehicles bound, so they never raise
 * a violation); the live map and its arrivals feed see them at once. The
 * Logbook's own figures need a recount, which is offered after each change.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { maps as mapsNs } from "../../lib/mapEngine";
import { useEstateZones, reloadEstateZones } from "../../hooks/useEstateZones";
import { usePermissions } from "../../hooks/usePermissions";
import { createFence, renameFence, deleteFence } from "../../api/geofences";
import {
  isSiteFence, outlineOf, boxOf, boxesMeet, parentFence, suggestName,
  selfCrosses, ringAreaHa, featureAreaHa, areaText, MAX_SITE_HA,
} from "../../lib/fenceDraw";
import { PlaceNames } from "./logbookPlaces";

const SHOW_KEY = "ft-logbook-fences";
/** How close (px) a click must land to the first corner to close the ring. */
const CLOSE_PX = 12;
/** Fences this far (degrees, ~2 km) outside the route still get drawn. */
const MARGIN = 0.02;

const readShow = () => { try { return localStorage.getItem(SHOW_KEY) !== "0"; } catch { return true; } };

/** Screen distance between two points at the map's zoom, from the world projection. */
function pxApart(map, a, b) {
  const proj = map.getProjection();
  const k = 2 ** map.getZoom();
  const p = proj.fromLatLngToPoint(a), q = proj.fromLatLngToPoint(b);
  return Math.hypot((p.x - q.x) * k, (p.y - q.y) * k);
}

const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;

/**
 * @param {{ map: object|null, orgId: string|null, area: number[]|null,
 *           color: string, onRecount?: () => void }} p
 *   `area` is the route's [south, west, north, east]; only fences near it are
 *   drawn. `onRecount` builds the logbook again so a changed fence counts.
 * @returns {{ toolbar: JSX.Element|null, overlay: JSX.Element|null, drawing: boolean }}
 */
export function useLogbookFences({ map, orgId, area, color, onRecount }) {
  const { zones } = useEstateZones(orgId);
  const { can } = usePermissions();
  const [show, setShow] = useState(readShow);
  // idle → drawing → naming; `pts` are the corners placed so far.
  const [mode, setMode] = useState("idle");
  const [pts, setPts] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [name, setName] = useState("");
  const [picked, setPicked] = useState(null);
  const [hover, setHover] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(null);
  const [changed, setChanged] = useState(false);
  const drawing = mode === "drawing";

  const sites = useMemo(() => (zones?.features ?? []).filter(isSiteFence), [zones]);
  const near = useMemo(() => {
    if (!area) return sites;
    const box = [area[0] - MARGIN, area[1] - MARGIN, area[2] + MARGIN, area[3] + MARGIN];
    return sites.filter((f) => boxesMeet(boxOf(outlineOf(f)), box));
  }, [sites, area]);
  const pickedF = picked ? sites.find((f) => f.properties.id === picked) ?? null : null;

  const toggleShow = () => {
    const v = !show;
    setShow(v);
    if (!v) setPicked(null);
    try { localStorage.setItem(SHOW_KEY, v ? "1" : "0"); } catch { /* a remembered choice only */ }
  };

  // ── the fences, outlined ──
  const shapes = useRef([]);
  const labels = useRef(null);
  useEffect(() => {
    if (!map) return undefined;
    labels.current = new PlaceNames();
    labels.current.setMap(map);
    return () => { labels.current?.setMap(null); labels.current = null; };
  }, [map]);
  useEffect(() => {
    shapes.current.forEach((s) => s.setMap(null));
    shapes.current = [];
    labels.current?.set([]);
    if (!map || !show) return;
    shapes.current = near.map((f) => {
      const on = f.properties.id === picked;
      const mine = f.properties.source === "app";
      const shape = new mapsNs.Polygon({
        map, paths: outlineOf(f), clickable: !drawing, zIndex: on ? 1 : 0,
        strokeColor: color, strokeOpacity: on ? 1 : 0.8, strokeWeight: on ? 3 : mine ? 2 : 1.5,
        fillColor: color, fillOpacity: on ? 0.16 : mine ? 0.08 : 0.05,
      });
      // No listeners while drawing: a shape with any listener takes the
      // pointer, and a corner placed inside a fence must reach the map.
      if (drawing) return shape;
      shape.addListener("click", () => { setPicked((p) => (p === f.properties.id ? null : f.properties.id)); setConfirmDel(false); setRenaming(null); setErr(null); });
      shape.addListener("mouseover", () => setHover(f.properties.id));
      shape.addListener("mouseout", () => setHover((h) => (h === f.properties.id ? null : h)));
      return shape;
    });
    // Names at the fence's top-left corner area: the centre is where a place
    // circle usually sits, and the place's own name is the one to keep there.
    labels.current?.set(near.map((f, i) => {
      const ring = outlineOf(f);
      const [s, w, n] = boxOf(ring);
      return { id: 1000 + i, lat: n - (n - s) * 0.08, lng: w, text: f.properties.name, gap: 6, dim: picked != null && f.properties.id !== picked, strong: f.properties.id === picked };
    }));
  }, [map, show, near, picked, color, drawing]);
  useEffect(() => () => shapes.current.forEach((s) => s.setMap(null)), []);

  // ── drawing ──
  const finish = () => {
    if (pts.length < 3) return;
    if (selfCrosses(pts)) { setErr("The edges cross. Undo a corner or start again."); return; }
    setErr(null);
    setName(suggestName(parentFence(pts, sites)));
    setMode("naming");
  };
  const cancel = () => { setMode("idle"); setPts([]); setCursor(null); setErr(null); };
  const undo = () => { setPts((p) => p.slice(0, -1)); setErr(null); };
  const start = () => { setPicked(null); setPts([]); setErr(null); setMode("drawing"); if (!show) toggleShow(); };

  // Latest values for the map's listeners, which are bound once per mode.
  const live = useRef({});
  live.current = { pts, finish };
  useEffect(() => {
    if (!map || !drawing) return undefined;
    map.setOptions({ disableDoubleClickZoom: true });
    const click = map.addListener("click", (ev) => {
      const ll = ev.latLng && { lat: ev.latLng.lat(), lng: ev.latLng.lng() };
      if (!ll) return;
      const { pts: cur, finish: done } = live.current;
      if (cur.length >= 3 && pxApart(map, cur[0], ll) <= CLOSE_PX) { done(); return; }
      setPts([...cur, ll]);
      setErr(null);
    });
    const move = map.addListener("mousemove", (ev) => ev.latLng && setCursor({ lat: ev.latLng.lat(), lng: ev.latLng.lng() }));
    const out = map.addListener("mouseout", () => setCursor(null));
    const key = (e) => {
      if (typing(e)) return;
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
      else if (e.key === "Backspace" || (e.key === "z" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); undo(); }
      else if (e.key === "Enter") { e.preventDefault(); live.current.finish(); }
    };
    window.addEventListener("keydown", key);
    return () => {
      click.remove(); move.remove(); out.remove();
      window.removeEventListener("keydown", key);
      map.setOptions({ disableDoubleClickZoom: false });
    };
  }, [map, drawing]);

  // The ring being drawn: corners, the edges, the rubber band to the pointer.
  const sketch = useRef([]);
  useEffect(() => {
    sketch.current.forEach((s) => s.setMap(null));
    sketch.current = [];
    if (!map || mode === "idle") return;
    const out = [];
    if (pts.length >= 3) out.push(new mapsNs.Polygon({ map, paths: pts, strokeOpacity: 0, strokeWeight: 0, fillColor: color, fillOpacity: 0.18, zIndex: 5 }));
    const path = drawing && cursor ? [...pts, cursor] : mode === "naming" ? [...pts, pts[0]] : pts;
    if (path.length >= 2) out.push(new mapsNs.Polyline({ map, path, strokeColor: color, strokeOpacity: 1, strokeWeight: 2.5, zIndex: 6 }));
    pts.forEach((p, i) => {
      const first = i === 0 && drawing && pts.length >= 3;
      out.push(new mapsNs.Marker({
        map, position: p, clickable: false, zIndex: 300,
        icon: { path: mapsNs.SymbolPath.CIRCLE, scale: first ? 7 : 4.5, fillColor: first ? color : "#ffffff", fillOpacity: 1, strokeColor: color, strokeWeight: 2 },
      }));
    });
    sketch.current = out;
  }, [map, mode, drawing, pts, cursor, color]);
  useEffect(() => () => sketch.current.forEach((s) => s.setMap(null)), []);

  // ── saving ──
  const afterChange = async () => {
    await reloadEstateZones(orgId).catch(() => {});
    setChanged(true);
  };
  const save = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true); setErr(null);
    try {
      const f = await createFence(orgId, { name: n, points: pts });
      await afterChange();
      setMode("idle"); setPts([]); setCursor(null);
      setPicked(f?.id ?? null);
    } catch (e) { setErr(e.message || "The fence could not be saved."); }
    finally { setBusy(false); }
  };
  const rename = async () => {
    const n = renaming?.trim();
    if (!n || !pickedF || busy) return;
    setBusy(true); setErr(null);
    try { await renameFence(orgId, pickedF.properties.id, n); await afterChange(); setRenaming(null); }
    catch (e) { setErr(e.message || "The fence could not be renamed."); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!pickedF || busy) return;
    setBusy(true); setErr(null);
    try { await deleteFence(orgId, pickedF.properties.id); await afterChange(); setPicked(null); setConfirmDel(false); }
    catch (e) { setErr(e.message || "The fence could not be removed."); }
    finally { setBusy(false); }
  };

  // A different organisation, or a fence that went away: nothing stays picked.
  useEffect(() => { cancel(); setPicked(null); setChanged(false); }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (picked && zones && !pickedF) setPicked(null); }, [picked, zones, pickedF]);

  if (!orgId) return { toolbar: null, overlay: null, drawing: false };

  const canDraw = can("geofence:create");
  const toolbar = (
    <div className="urv-fence-bar" role="group" aria-label="Fences">
      <button type="button" className={show ? "is-on" : ""} aria-pressed={show} onClick={toggleShow}
              title={show ? "Hide the site fences" : "Show the site fences"}>
        <i className="ti ti-fence" aria-hidden="true" /> Fences{sites.length ? ` ${near.length}` : ""}
      </button>
      {canDraw && (
        <button type="button" className={mode !== "idle" ? "is-on" : ""} aria-pressed={mode !== "idle"}
                onClick={mode === "idle" ? start : cancel}
                title={mode === "idle" ? "Draw a fence: an area inside a site, or a new site" : "Stop drawing"}>
          <i className={`ti ti-${mode === "idle" ? "polygon" : "x"}`} aria-hidden="true" /> {mode === "idle" ? "Draw" : "Cancel"}
        </button>
      )}
    </div>
  );

  const drawnHa = ringAreaHa(pts);
  const parent = mode === "naming" ? parentFence(pts, sites) : null;
  let panel = null;
  if (drawing) {
    panel = (
      <div className="urv-fence-draw" role="status">
        <span>
          {pts.length === 0 ? "Click the map to place the first corner."
            : pts.length < 3 ? `Corner ${pts.length} placed. Keep clicking round the area.`
            : <>Click the first corner or <b>Finish</b> to close · {areaText(drawnHa)}</>}
        </span>
        <span className="urv-fence-draw__keys">Backspace undoes · Esc cancels</span>
        {err && <span className="urv-fence__err">{err}</span>}
        <div className="urv-fence-draw__acts">
          <button type="button" onClick={undo} disabled={!pts.length}>Undo</button>
          <button type="button" className="is-primary" onClick={finish} disabled={pts.length < 3}>Finish</button>
        </div>
      </div>
    );
  } else if (mode === "naming") {
    panel = (
      <form className="urv-fence-card" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <b>Name the fence</b>
        <span>{areaText(drawnHa)}{parent ? <> · inside <em>{parent.properties.name}</em></> : " · not inside another fence"}</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={120}
               placeholder={parent ? "e.g. Weighbridge" : "e.g. Sukari Industries"} aria-label="Fence name" />
        {drawnHa > MAX_SITE_HA && (
          <span className="urv-fence__warn">Over {MAX_SITE_HA.toLocaleString("en-GB")} ha. The Logbook treats a fence this big as a region, not a work area.</span>
        )}
        {err && <span className="urv-fence__err">{err}</span>}
        <div className="urv-fence-card__acts">
          <button type="button" onClick={() => { setMode("drawing"); setErr(null); }} disabled={busy}>Back</button>
          <button type="button" onClick={cancel} disabled={busy}>Discard</button>
          <button type="submit" className="is-primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save fence"}</button>
        </div>
      </form>
    );
  } else if (pickedF) {
    const p = pickedF.properties;
    const mine = p.source === "app";
    const inside = parentFence(outlineOf(pickedF), sites, p.id);
    panel = (
      <div className="urv-fence-card">
        <div className="urv-fence-card__head">
          {renaming != null ? (
            <form onSubmit={(e) => { e.preventDefault(); rename(); }} className="urv-fence-card__rename">
              <input autoFocus value={renaming} onChange={(e) => setRenaming(e.target.value)} maxLength={120} aria-label="Fence name" />
              <button type="submit" className="is-primary" disabled={busy || !renaming.trim()}>Save</button>
              <button type="button" onClick={() => setRenaming(null)} disabled={busy}>Cancel</button>
            </form>
          ) : <b>{p.name}</b>}
          <button type="button" className="urv-fence-card__x" aria-label="Close" title="Close" onClick={() => setPicked(null)}>
            <i className="ti ti-x" aria-hidden="true" />
          </button>
        </div>
        <span>
          {areaText(featureAreaHa(pickedF))}
          {inside ? <> · inside <em>{inside.properties.name}</em></> : null}
        </span>
        <span className="urv-fence-card__src">{mine ? "Drawn in the app" : "From Wialon. Change it there; the next sync would undo an edit here."}</span>
        {err && <span className="urv-fence__err">{err}</span>}
        {mine && renaming == null && (can("geofence:update") || can("geofence:delete")) && (
          <div className="urv-fence-card__acts">
            {confirmDel ? (
              <>
                <span className="urv-fence__warn">Remove this fence?</span>
                <button type="button" onClick={() => setConfirmDel(false)} disabled={busy}>Keep</button>
                <button type="button" className="is-danger" onClick={remove} disabled={busy}>{busy ? "Removing…" : "Remove"}</button>
              </>
            ) : (
              <>
                {can("geofence:update") && <button type="button" onClick={() => setRenaming(p.name)}>Rename</button>}
                {can("geofence:delete") && <button type="button" onClick={() => setConfirmDel(true)}>Remove</button>}
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  const hovered = !drawing && hover && hover !== picked ? sites.find((f) => f.properties.id === hover) : null;
  const overlay = (
    <>
      {panel}
      {hovered && !panel && <div className="urv-fence-hint">{hovered.properties.name} · click for details</div>}
      {changed && mode === "idle" && onRecount && (
        <div className="urv-fence-recount">
          <span>Fences changed. The figures above still use the old ones.</span>
          <button type="button" className="is-primary" onClick={() => { setChanged(false); onRecount(); }}>Recount</button>
          <button type="button" aria-label="Dismiss" title="Dismiss" onClick={() => setChanged(false)}><i className="ti ti-x" aria-hidden="true" /></button>
        </div>
      )}
    </>
  );
  return { toolbar, overlay, drawing };
}
