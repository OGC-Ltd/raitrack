// One gate event, down the right of the page (operator, 2026-11-26: "when we
// click a row we get a sidepanel with more info and a map that shows where it
// was at that moment and the gate"). The Fuel page's machine panel (.dr-panel),
// with the tracker's fixes ten minutes either side of the event on a small map.
//
// The map (operator, 2026-11-26: "show the geofence of the organization with
// the zoom in effect on the gate and the icon of the unit", then "only display
// one geofence overlay, and the gate to always be there, for the signed out the
// unit icon to show moving out, for the signed in to show unit icon moving
// in"): the premises fence alone, in its map colour; the gate always (see
// lib/gateLog findGate); it opens on the premises and flies in on the gate;
// the unit is the main map's sprite, facing out or in through the gate and
// gliding that way. × or Esc closes the panel;
// another row swaps the event in place. View only.

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useWindowTelemetry } from "../../hooks/useWindowTelemetry";
import { useEstateZones } from "../../hooks/useEstateZones";
import { usePermissions } from "../../hooks/usePermissions";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { claimSidePanel, onSidePanelClaim } from "../../lib/sidePanels";
import { acknowledgeGateEvent } from "../../api/gateLog";
import { GATE_SOURCES, ACK_WORDS, ackNoteOk, durationWords, fixesOf, fixAt, metresBetween, siteFences, planFences, premisesOf, findGate, gateFacing, headingAt } from "../../lib/gateLog";
import { mapFences } from "../../lib/fenceVisibility";
import { SITE_PLANS, NO_PLANS } from "../../lib/sitePlans";
import { useAppFields } from "../../context/AppContext";
import { spriteKind } from "../../lib/vehicleMap";
import { fleetDay } from "../../lib/alertsView";
import { markerIconHtml } from "../body/FleetMap";

/** The fixes read round the event: ten minutes either side. */
const AROUND_MS = 10 * 60_000;
const TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
/** How the key says where the gate came from, when it is not the recorded point (lib/gateLog findGate). */
const GATE_FROM = { track: ", where the track crossed the fence", edge: ", the fence nearest the unit" };
/** Works-site surveys by URL, fetched once per page load (they are static files in public/). */
const planCache = new Map();
const loadPlan = (url) => {
  if (!planCache.has(url)) {
    planCache.set(url, fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => { planCache.delete(url); return null; }));
  }
  return planCache.get(url);
};

/** The open company's site surveys (lib/sitePlans) as [{ id, fc }]; empty until they load, or where it has none. */
function useSitePlans(companyId) {
  const [plans, setPlans] = useState([]);
  useEffect(() => {
    let live = true;
    const list = SITE_PLANS[companyId] ?? NO_PLANS;
    Promise.all(list.map((p) => loadPlan(p.url).then((fc) => (fc ? { id: p.id, fc } : null))))
      .then((got) => { if (live) setPlans(got.filter(Boolean)); });
    return () => { live = false; };
  }, [companyId]);
  return plans;
}

/** The gate's circle where none is recorded. */
const GATE_RADIUS_M = 40;

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
const clockSec = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(ms);
const dayShort = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", weekday: "short", day: "numeric", month: "short" }).format(ms);
const whenText = (ms, day) => (ms == null ? "-" : fleetDay(ms) === day ? clock(ms) : `${dayShort(ms)}, ${clock(ms)}`);
const metresText = (m) => (m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`);
const gapText = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} s` : durationWords(ms));
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export default function GateEventPanel({ row, trip, day, orgId, gate, onClose, canAck = false, onAcked }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    claimSidePanel("gate-log");
    return onSidePanelClaim("gate-log", () => closeRef.current?.());
  }, []);

  const { pings, loading, error } = useWindowTelemetry(row.vehicleId, orgId, row.at - AROUND_MS, row.at + AROUND_MS, 200);
  const fixes = useMemo(() => fixesOf(pings), [pings]);
  const here = useMemo(() => fixAt(fixes, row.at), [fixes, row.at]);

  // The organisation's premises: its site fences, and the gate (the recorded
  // point, else a fence drawn as the gate).
  const { zones } = useEstateZones(orgId);
  const { orgCode } = usePermissions();
  const { activeCompanyId } = useAppFields("activeCompanyId");
  const plans = useSitePlans(activeCompanyId);
  const fences = useMemo(() => [
    ...plans.flatMap((p) => planFences(p.fc, p.id, gate ?? here)),
    ...siteFences(mapFences(zones, orgCode), gate ?? here),
  ], [plans, zones, orgCode, gate, here]);
  const premises = useMemo(() => premisesOf(fences, gate ?? here), [fences, gate, here]);
  const spot = useMemo(() => findGate({ gate, fences, premises, fixes, at: row.at, here }), [gate, fences, premises, fixes, row.at, here]);
  const fromGate = here && spot ? metresBetween(here, spot) : null;
  // Out or in through the gate; the track's own heading where there is no gate.
  const facing = gateFacing(row.way, here, spot, premises, gate?.radiusM ?? GATE_RADIUS_M) ?? headingAt(fixes, here);
  // With no position the unit is drawn at the gate, so it is always on the map.
  const unitAt = here ?? spot;

  const { vehicles = [] } = useFleetLiveShared();
  const vehicle = vehicles.find((v) => v.vehicleId === row.vehicleId) ?? { id: row.plate ?? "", name: row.plate ?? "" };
  const sprite = spriteKind(vehicle);

  const facts = [
    { label: "Time", value: clockSec(row.at) },
    { label: "Source", value: GATE_SOURCES[row.source].label },
    { label: "Out", value: whenText(trip?.outAt ?? (row.way === "out" ? row.at : null), day) },
    { label: "In", value: whenText(trip?.inAt ?? (row.way === "in" ? row.at : null), day) },
    { label: trip?.open ? "Out so far" : "Time out", value: trip ? durationWords(trip.outMs) || "-" : "-" },
  ];

  return (
    <aside className="dr-panel gl-panel" role="dialog" aria-label={`${row.plate ?? "Unit"}, ${row.label}`}>
      <header className="dr-panel__head">
        <div className="dr-panel__ident">
          <span className="dr-panel__name">{row.plate ?? "Unknown unit"}</span>
          <span><span className={`dr-grid__badge gl-event--${row.way}`}>{row.label}</span></span>
        </div>
        <button type="button" className="dr-panel__x" onClick={onClose} aria-label="Close the gate event">×</button>
      </header>

      <div className="dr-panel__body">
        <section className="dr-panel__sec gl-panel__first">
          <p className="gl-panel__text">{row.text || "No details sent with this event."}</p>
          <dl className="gl-panel__facts">
            {facts.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>)}
          </dl>
        </section>

        <GateDecision row={row} orgId={orgId} canAck={canAck} onAcked={onAcked} />

        <section className="dr-panel__sec">
          <h3 className="dr-panel__h">Where it was</h3>
          {/* No position near the event: no line (operator, 2026-11-26); the
              map draws the unit at the gate and the key says so. */}
          {(!row.vehicleId || loading || error || here) && (
          <p className="dr-panel__note gl-panel__where" aria-busy={loading || undefined}>
            {!row.vehicleId ? "This unit is not linked to a tracker, so the map shows the gate only."
              : loading ? `Reading the tracker round ${clock(row.at)}…`
              : error ? `The tracker could not be read: ${error}`
              : <>
                  <b>{fromGate != null ? `${metresText(fromGate)} from the gate` : `At ${clockSec(here.at)}`}</b>
                  {fromGate != null ? ` at ${clockSec(here.at)}` : ""}
                  {here.gapMs >= 1000 ? `, ${gapText(here.gapMs)} ${here.at < row.at ? "before" : "after"} the event` : ""}
                  {here.speedKmh != null ? `, ${Math.round(here.speedKmh)} km/h` : ""}.
                </>}
          </p>
          )}
          <GateEventMap fixes={fixes} here={here} unitAt={unitAt} facing={facing} way={row.way} gate={gate} spot={spot} premises={premises} sprite={sprite} plate={row.plate} />
          <ul className="gl-panel__key">
            {unitAt && <li><span className={`gl-key gl-key--unit lf-truck lf-truck--${sprite}`} aria-hidden="true" />{row.plate ?? "The unit"} {row.way === "out" ? "signing out" : "signing in"}{here ? "" : ", drawn at the gate"}</li>}
            {fixes.length > 1 && <li><span className="gl-key gl-key--track" aria-hidden="true" />Track, 10 min either side</li>}
            {spot && <li><span className="gl-key gl-key--gate" aria-hidden="true" />Gate{GATE_FROM[spot.from] ?? ""}</li>}
            {premises && <li><span className="gl-key gl-key--fence" style={{ "--gl-fence": premises.color }} aria-hidden="true" />{premises.name}</li>}
          </ul>
          {!spot && <p className="dr-panel__note gl-panel__aside">No gate or site fence is recorded for this organisation.</p>}
        </section>
      </div>
    </aside>
  );
}

/**
 * The decision (operator, 2026-11-26: "a decision section for them to either
 * acknowledge it truly left or got into the premises, by that it will update
 * the rows column acknowledged"). Two picks, as the Alerts page's: it did
 * (confirm, a note optional) or it did not (a reason needed). The decision
 * already taken shows above them; a new one replaces it.
 */
function GateDecision({ row, orgId, canAck, onAcked }) {
  const words = ACK_WORDS[row.way] ?? ACK_WORDS.out;
  const [outcome, setOutcome] = useState(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState(null);
  const noteRef = useRef(null);
  useEffect(() => { if (outcome) noteRef.current?.focus(); }, [outcome]);

  const a = row.ack;
  const ok = outcome && ackNoteOk(outcome, note);
  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const ack = await acknowledgeGateEvent({ orgId, eventId: row.key, outcome, note: note.trim() });
      onAcked?.(row.key, ack ?? { outcome, note: note.trim() || null, by: "You", at: new Date().toISOString() });
      setOutcome(null);
      setNote("");
    } catch (err) {
      setFailure(err?.message || "The decision could not be saved. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const at = a ? Date.parse(a.at) : NaN;
  return (
    <section className="dr-panel__sec gl-decide">
      <h3 className="dr-panel__h">Decision</h3>
      {a ? (
        <div className="gl-decide__done">
          <span className={`dr-grid__badge gl-ack--${a.outcome === "DISPUTED" ? "no" : "yes"}`}>{words[a.outcome]?.cell ?? a.outcome}</span>
          <span className="gl-decide__by">{a.by}{Number.isFinite(at) ? `, ${whenText(at, fleetDay())}` : ""}</span>
          {a.note && <p className="gl-decide__note">{a.note}</p>}
        </div>
      ) : (
        <p className="dr-panel__note">{row.ack === undefined ? "Decisions could not be read for this day." : "Not acknowledged yet."}</p>
      )}
      {canAck ? (
        <>
          <div className="gl-decide__picks" role="group" aria-label="Decision">
            {["CONFIRMED", "DISPUTED"].map((o) => (
              <button key={o} type="button" aria-pressed={outcome === o} disabled={busy}
                      className={`gl-decide__pick gl-decide__pick--${o === "DISPUTED" ? "no" : "yes"}${outcome === o ? " is-on" : ""}`}
                      onClick={() => setOutcome(outcome === o ? null : o)}>
                <i className={`ti ${o === "DISPUTED" ? "ti-x" : "ti-check"}`} aria-hidden="true" />
                {words[o].pick}
              </button>
            ))}
          </div>
          {outcome && (
            <div className="gl-decide__form">
              <label className="gl-decide__field">
                <span className="gl-decide__label">{outcome === "DISPUTED" ? "Reason" : "Note"}</span>
                <textarea ref={noteRef} rows={3} maxLength={2000} value={note} disabled={busy}
                          placeholder={words[outcome].placeholder} onChange={(e) => setNote(e.target.value)} />
              </label>
              <p className="gl-decide__hint">
                {a ? "Replaces the decision above. " : ""}Saved with your name and the time, and shown in the row’s Acknowledged column.
              </p>
              {failure && <p className="gl-decide__fail" role="alert">{failure}</p>}
              <div className="gl-decide__foot">
                {!ok && <span className="gl-decide__need">Give a reason to continue</span>}
                <button type="button" className="dr-chip gl-tool" onClick={() => { setOutcome(null); setNote(""); }} disabled={busy}>Cancel</button>
                <button type="button" className={`gl-decide__go gl-decide__go--${outcome === "DISPUTED" ? "no" : "yes"}`} onClick={save} disabled={!ok || busy}>
                  {busy ? "Saving…" : words[outcome].confirm}
                </button>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="dr-panel__note">Your role can view the Gate log but not acknowledge its events.</p>
      )}
    </section>
  );
}

/**
 * Leaflet on OpenStreetMap tiles, as the main map. It opens on the premises,
 * then flies in on the gate (with the unit, when it was near). Paths are
 * styled in GateLogScreen.css by class; the fence takes its own map colour.
 */
function GateEventMap({ fixes, here, unitAt, facing, way, gate, spot, premises, sprite, plate }) {
  const box = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    const m = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false, zoomSnap: 0.25 });
    L.tileLayer(TILE_URL, { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
    map.current = m;
    layer.current = L.layerGroup().addTo(m);
    return () => { m.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return undefined;
    const g = layer.current;
    g.clearLayers();

    const site = L.latLngBounds([]);
    if (premises) {
      const style = { color: premises.color, weight: 2, opacity: 0.9, fillColor: premises.color, fillOpacity: 0.06, className: "gl-map__fence" };
      const shape = premises.circle
        ? L.circle([premises.circle.lat, premises.circle.lng], { ...style, radius: premises.circle.radiusM })
        : L.geoJSON(premises.feature, { style: () => style });
      shape.bindTooltip(premises.name, { sticky: true }).addTo(g);
      site.extend(shape.getBounds());
    }
    const radius = gate?.radiusM ?? GATE_RADIUS_M;
    if (spot) {
      L.circle([spot.lat, spot.lng], { radius, className: "gl-map__gate", interactive: false }).addTo(g);
      L.marker([spot.lat, spot.lng], {
        icon: L.divIcon({ html: "<span>Gate</span>", className: "gl-map__gate-tag", iconSize: null, iconAnchor: [0, 0] }),
        interactive: false, keyboard: false,
      }).addTo(g);
    }
    if (fixes.length > 1) {
      L.polyline(fixes.map((f) => [f.lat, f.lng]), { className: "gl-map__track", interactive: false }).addTo(g);
    }
    if (unitAt) {
      const h = Number.isFinite(facing) ? facing : 0;
      const r = (h * Math.PI) / 180;
      // A gate event is a unit on the move: the green driving sprite, gliding
      // a few pixels the way it faces, out through the gate for a sign-out
      // and in for a return.
      const html = `<div class="gl-drive" style="--gl-dx:${Math.sin(r).toFixed(3)};--gl-dy:${(-Math.cos(r)).toFixed(3)}">${
        markerIconHtml("ok", { moving: false, heading: h, sprite, name: plate ?? "" })}</div>`;
      const when = here ? ` at ${clockSec(here.at)}` : ", position not recorded";
      L.marker([unitAt.lat, unitAt.lng], {
        icon: L.divIcon({ html, className: "gl-map__unit", iconSize: [40, 40], iconAnchor: [20, 20] }),
        keyboard: false, zIndexOffset: 1000,
      }).bindTooltip(`${plate ?? "The unit"} ${way === "out" ? "signing out" : "signing in"}${when}`, { direction: "top", offset: [0, -18] }).addTo(g);
    }

    // Where it ends: the gate and its circle, with the unit when it was within
    // 1.5 km (further off, both would shrink to dots); no gate, the premises.
    const end = L.latLngBounds([]);
    if (spot) {
      end.extend(L.latLng(spot.lat, spot.lng).toBounds(radius * 5));
      if (here && metresBetween(here, spot) <= 1500) end.extend([here.lat, here.lng]);
    } else if (site.isValid()) {
      end.extend(site);
      if (here) end.extend([here.lat, here.lng]);
    } else if (unitAt) {
      end.extend(L.latLng(unitAt.lat, unitAt.lng).toBounds(300));
    }
    // Where it starts: the whole premises, so the eye sees where the gate is.
    const start = L.latLngBounds([]);
    if (site.isValid()) start.extend(site);
    if (end.isValid()) start.extend(end);

    if (!end.isValid()) { m.setView([-0.5, 36.5], 6); return undefined; }
    // Clear of the zoom buttons (top left) and the attribution (bottom).
    const pad = { paddingTopLeft: [56, 40], paddingBottomRight: [40, 40], maxZoom: 18 };
    m.invalidateSize();
    m.fitBounds(start.pad(0.2), { ...pad, animate: false });
    // The panel slides in: measure once it has its width, then fly in.
    const t = setTimeout(() => {
      m.invalidateSize();
      if (reducedMotion()) m.fitBounds(end, { ...pad, animate: false });
      else m.flyToBounds(end, { ...pad, duration: 1.2, easeLinearity: 0.2 });
    }, 300);
    return () => clearTimeout(t);
  }, [fixes, here, unitAt, facing, way, gate, spot, premises, sprite, plate]);

  return <div ref={box} className="gl-map" role="img" aria-label="Map of the premises, the gate and the unit at the event" />;
}
