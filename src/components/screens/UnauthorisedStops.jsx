/*
 * Menengai's units flagged now by the stop watch (lib/stopWatch,
 * components/shared/StopWatch), on the Alerts page: standing in a no-go zone,
 * or stopped over 10 minutes outside every authorised place. It follows the
 * watch by itself; a unit that moves on drops off. Desktop alerts are turned
 * on here, once per browser.
 *
 * As the geofence exits (operator, 2026-11-06): a Type column (a no-go zone,
 * or for a stop outside every authorised place the nearest one, its type and
 * how far), a copy button, and read marks with the page's Read filter. The
 * marks are kept in this browser (lib/feedReads, STOP_READS).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { desktopAlertsOn, distanceWords, nearestPlace, setDesktopAlerts, placesOf, standingWords, stopCopyText, storePlaces } from "../../lib/stopWatch";
import { byRead } from "../../lib/geofenceExits";
import { ZONE_STYLE } from "../../lib/zoneLegend";
import { resolveOrgId } from "../../api/org";
import { loadZones } from "../../hooks/useEstateZones";
import { AUTHORISED } from "../../data/menengaiStopPlaces";
import { CopyExit, ZoneType } from "./GeofenceExits";
import { cachedPlaceName, usePlaceName } from "../../hooks/usePlaceName";

/**
 * Where a unit stands, by name (the vehicle card's reverse geocoding, cached
 * per ~1 km), linked to Google Maps; under it, the no-go zone or "Outside any
 * authorised place". The coordinates show until the name is known, and in
 * the link's title after.
 */
function StopWhere({ f }) {
  const name = usePlaceName(f.lat, f.lng);
  const coords = `${f.lat.toFixed(5)}, ${f.lng.toFixed(5)}`;
  return (
    <span className="alr-stop-where">
      <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer noopener"
         className={`alr-stop-where__place${name ? "" : " alr-stop-where__place--pending"}`}
         title={name ? `${name} (${coords}), open in Google Maps` : `${coords}, open in Google Maps`}
         onClick={(event) => event.stopPropagation()}>{name ?? coords}</a>
      <span className="alr-stop-where__rule">{f.kind === "nogo" ? `In ${f.zone}` : "Outside any authorised place"}</span>
    </span>
  );
}

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
const squash = (x) => String(x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * Desktop alerts for new stops, on and off. The browser's permission is asked
 * the first time; after that the switch is the platform's own (lib/stopWatch),
 * since a page cannot take the permission back.
 */
function DesktopAlerts() {
  const can = typeof Notification !== "undefined";
  const [perm, setPerm] = useState(can ? Notification.permission : "denied");
  const [on, setOn] = useState(desktopAlertsOn);
  if (!can) return null;
  if (perm === "denied") return <span className="sp4-muted">Desktop alerts are blocked in this browser’s settings.</span>;
  const live = perm === "granted" && on;
  const flip = () => {
    if (live) { setDesktopAlerts(false); setOn(false); return; }
    const turnOn = (p) => { setPerm(p); if (p === "granted") { setDesktopAlerts(true); setOn(true); } };
    if (perm === "granted") turnOn("granted");
    else Notification.requestPermission().then(turnOn).catch(() => {});
  };
  return (
    <button type="button" className={`sp4-ghost-btn alr-desktop-alerts-btn${live ? " alr-desktop-alerts-btn--on" : ""}`} onClick={flip}
            title={live ? "Stop the notifications in the corner of the screen; new stops still show here, with the sound"
              : "A notification in the corner of the screen for each new one, even in another tab or program"}>
      <i className={`ti ${live ? "ti-bell-off" : "ti-bell-plus"}`} aria-hidden="true" /> {live ? "Turn off desktop alerts" : "Turn on desktop alerts"}
    </button>
  );
}

/**
 * Every authorised place, as the watch judges against: the file's, MORL and
 * STO, and Menengai's geofences (read once a page; the watch has read them).
 */
function useAuthorisedPlaces() {
  const [places, setPlaces] = useState(null);
  useEffect(() => {
    let live = true;
    const base = [...storePlaces(), ...placesOf(AUTHORISED)];
    resolveOrgId("menengai")
      .then((id) => (id ? loadZones(id) : null))
      .catch(() => null)
      .then((fc) => { if (live) setPlaces([...base, ...placesOf(fc?.features ?? [])]); });
    return () => { live = false; };
  }, []);
  return places;
}

const styleOf = (category) => {
  const s = ZONE_STYLE[category] ?? ZONE_STYLE.other;
  return { label: category === "parking" ? "Rest stop" : s.label, color: s.osmColor ?? s.color };
};

/**
 * The Type cell's facts for a stop: a no-go zone is its own type; a stop
 * outside is given the nearest authorised place. Null while places are read.
 */
function typeOf(f, places) {
  if (f.kind === "nogo") return { ...styleOf("restricted"), name: f.zone, category: "restricted" };
  if (!places) return null;
  const n = nearestPlace(f, places);
  if (!n) return { ...styleOf("other"), name: null, category: "other", far: "No authorised place known" };
  return { ...styleOf(n.category), name: n.name, category: n.category, metres: n.metres, far: `${distanceWords(n.metres)} · ${n.name}` };
}

const NO_READS = { unread: () => false, markRead: () => {} };
const EMPTY_READ = {
  unread: { icon: "ti-mail-opened", title: "Nothing Unread", sub: "You have opened every stop flagged now." },
  read: { icon: "ti-mail", title: "Nothing Read Yet", sub: "Stops you open or copy are listed here." },
};

/**
 * watch.flags come in as lines with read marks (lib/stopWatch stopLine).
 * reads: { unread(row), markRead(rows) }; read: the page's Read filter.
 */
export default function UnauthorisedStops({ watch, q, lines, reads = NO_READS, read = "all" }) {
  const places = useAuthorisedPlaces();
  const all = lines ?? watch.flags;
  // The nearest place moves only with the unit: once per flag and places.
  const types = useMemo(() => new Map(all.map((f) => [f.key, typeOf(f, places)])), [all, places]);
  const [keep, setKeep] = useState(() => new Set());
  useEffect(() => { setKeep(new Set()); }, [read]);
  const rows = useMemo(() => {
    const s = squash(q);
    const words = String(q ?? "").trim().toLowerCase();
    const found = s ? all.filter((f) => squash(f.plate).includes(s) || squash(f.zone).includes(s)
      || String(types.get(f.key)?.label ?? "").toLowerCase().includes(words)
      || squash(types.get(f.key)?.name).includes(s)) : all;
    return byRead(found, read, reads.unread, keep);
  }, [all, q, types, read, reads.unread, keep]);
  const seen = (row) => {
    if (read !== "all") setKeep((k) => (k.has(row.key) ? k : new Set(k).add(row.key)));
    reads.markRead([row]);
  };
  const copyOf = (f) => {
    const t = types.get(f.key);
    return stopCopyText(f, { now, area: cachedPlaceName(f.lat, f.lng),
      place: f.kind === "nogo" || !t?.name ? null : `${t.name} (${t.label}), ${distanceWords(t.metres)}` });
  };
  const pager = usePager(rows, q);
  const now = watch.checkedAt ?? Date.now();
  const [openKey, setOpenKey] = useState(null);
  const returnFocus = useRef(null);
  const openRow = rows.find((r) => r.key === openKey) ?? null;

  useEffect(() => {
    if (openKey || !returnFocus.current) return;
    returnFocus.current.focus();
    returnFocus.current = null;
  }, [openKey]);

  const toggle = (row, event) => {
    returnFocus.current = event.currentTarget;
    setOpenKey((key) => key === row.key ? null : row.key);
    seen(row);
  };

  return (
    <>
      <p className="sp4-muted alr-geo-note alr-stop-note" role="note">
        <DesktopAlerts />
        {watch.checkedAt && <span> Checked {clock(watch.checkedAt)}</span>}
        {watch.status === "error" && <span className="rpt-warn"> The last check failed: {watch.message}</span>}
      </p>
      {watch.status === "loading" && !watch.checkedAt ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Checking Menengai’s Units">Where every unit stands, against the authorised places and the no-go zones.</EmptyNote>
      ) : rows.length === 0 && EMPTY_READ[read] && all.length > 0 ? (
        <EmptyNote icon={EMPTY_READ[read].icon} title={EMPTY_READ[read].title}>{q ? `Nothing matches “${q}”.` : EMPTY_READ[read].sub}</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title="No Unauthorised Stops">{q ? `Nothing matches “${q}”.` : "No Menengai unit is standing in a no-go zone or stopped outside an authorised place."}</EmptyNote>
      ) : (
        <div className="sp4-table-scroll aud-units alr-table alr-stop-table">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <colgroup>
              <col className="alr-stop-col--unit" />
              <col className="alr-stop-col--alert" />
              <col className="alr-stop-col--since" />
              <col className="alr-stop-col--for" />
              <col className="alr-stop-col--type" />
              <col className="alr-stop-col--where" />
              <col className="alr-stop-col--action" />
            </colgroup>
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit</th>
                <th className="sp4-th--left">Alert</th>
                <th className="sp4-th--left" title="Standing since">Since</th>
                <th className="sp4-th--left">For</th>
                <th className="sp4-th--left" title="A no-go zone, or the nearest authorised place to a stop outside them">Type</th>
                <th className="sp4-th--left">Where</th>
                <th className="sp4-th--right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.map((f) => { const unread = reads.unread(f); const type = types.get(f.key); return (
                <tr key={f.key} className={"sp4-tr aud-tr" + (openKey === f.key ? " aud-tr--open" : "") + (unread ? " alr-tr--unread" : "")}
                    tabIndex={0} aria-expanded={openKey === f.key} aria-controls={openKey === f.key ? "stop-watch-panel" : undefined}
                    onClick={(event) => toggle(f, event)}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggle(f, event); } }}>
                  <td className="sp4-td--left sp4-td--pin">
                    {unread && <span className="alr-unread-dot" role="img" aria-label="Unread" title="Unread" />}
                    <span className="sp4-reg" title={f.plate}>{f.plate}</span>
                    {f.name && f.name !== f.plate && <div className="sp4-muted alr-stop-unit-name" title={f.name}>{f.name}</div>}</td>
                  <td className="sp4-td--left">
                    <i className={`ti ${f.kind === "nogo" ? "ti-hand-stop" : "ti-map-pin-exclamation"}`} aria-hidden="true" />{" "}
                    {f.kind === "nogo" ? <b style={{ color: "#c62828" }}>No-go zone</b> : "Unauthorised stop"}
                  </td>
                  <td className="sp4-td--left">{clock(f.since)}</td>
                  <td className="sp4-td--left">{standingWords(f.since, now)}</td>
                  <td className="sp4-td--left">
                    <ZoneType zone={type} />
                    {type?.far && <span className="alr-stop-near" title={`Nearest authorised place: ${type.name ?? "none"}`}>{type.far}</span>}
                  </td>
                  <td className="sp4-td--left"><StopWhere f={f} /></td>
                  <td className="sp4-td--right">
                    <span className="alr-geo-actions">
                      <CopyExit text={() => copyOf(f)} plate={f.plate} what="stop" onCopied={() => seen(f)} />
                      <button type="button" className="sp4-ghost-btn"
                              onClick={(event) => { event.stopPropagation(); toggle(f, event); }}>
                        {openKey === f.key ? "Hide" : "Details"}
                      </button>
                    </span>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
          <TablePager pager={pager} label="Unauthorised stop pages" />
        </div>
      )}
      {openRow && (
        <DetailSidebar id="stop-watch-panel" title={openRow.kind === "nogo" ? "No-go zone stop" : "Unauthorised stop"}
                       label={`${openRow.kind === "nogo" ? "No-go zone stop" : "Unauthorised stop"}, ${openRow.plate}`}
                       itemKey={openRow.key} onClose={() => setOpenKey(null)}
                       footer={(
                         <a className="sp4-ghost-btn" href={`https://www.google.com/maps?q=${openRow.lat},${openRow.lng}`}
                            target="_blank" rel="noreferrer noopener">
                           <i className="ti ti-external-link" aria-hidden="true" /> Where it happened
                         </a>
                       )}>
          <DetailSidebarIdent
            kind={<span className="alr-kind"><i className={`ti ${openRow.kind === "nogo" ? "ti-hand-stop" : "ti-map-pin-exclamation"}`} aria-hidden="true" />
              {openRow.kind === "nogo" ? "No-go zone" : "Unauthorised stop"}</span>}
            name={openRow.plate} nameTitle={openRow.name || openRow.plate} sub={openRow.name && openRow.name !== openRow.plate ? openRow.name : undefined}
          />
          <DetailSidebarFacts facts={[
            { label: "Standing since", value: clock(openRow.since) },
            { label: "For", value: standingWords(openRow.since, now) },
            { label: "Where", value: <StopWhere f={openRow} /> },
            { label: "Type", value: <ZoneType zone={types.get(openRow.key)} /> },
            ...(openRow.kind === "nogo" ? [] : [{ label: "Nearest place", value: types.get(openRow.key)?.far ?? "…" }]),
          ]} />
          <DetailSidebarSection title="Location">
            <p className="dsb__note">{openRow.lat.toFixed(5)}, {openRow.lng.toFixed(5)}</p>
            <p className="alr-geo-copyline"><CopyExit text={() => copyOf(openRow)} plate={openRow.plate} what="stop" />Copy this stop to paste elsewhere</p>
          </DetailSidebarSection>
        </DetailSidebar>
      )}
    </>
  );
}
