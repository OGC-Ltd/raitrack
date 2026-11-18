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
import { desktopAlertsOn, setDesktopAlerts, standingWords, stopCopyText, stopKind } from "../../lib/stopWatch";
import { byRead } from "../../lib/geofenceExits";
import { ZONE_STYLE } from "../../lib/zoneLegend";
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
      <span className="alr-stop-where__rule">{stopKind(f).where}</span>
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

const colourOf = (category) => { const s = ZONE_STYLE[category] ?? ZONE_STYLE.other; return s.osmColor ?? s.color; };

/**
 * The Type cell: at a customer or not (operator, 18 Nov 2026: "either it's a
 * customer or not"; the type is "Unauthorised stop", not the nearest place's).
 */
function typeOf(f) {
  if (f.kind === "nogo") return { label: "No-go zone", color: colourOf("restricted"), name: f.zone, category: "restricted" };
  if (f.kind === "customer") return { label: "Customer", color: colourOf("customer"), name: f.zone, category: "customer" };
  return { label: "Unauthorised stop", color: "#e8590c", name: null, category: "unauthorised" };
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
export default function UnauthorisedStops({ watch, q, lines, reads = NO_READS, read = "all", customers = false }) {
  const all = lines ?? watch.flags;
  const types = useMemo(() => new Map(all.map((f) => [f.key, typeOf(f)])), [all]);
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
  const copyOf = (f) => stopCopyText(f, { now, area: cachedPlaceName(f.lat, f.lng) });
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
        <EmptyNote icon="ti-circle-check" title={customers ? "No Customer Stops" : "No Unauthorised Stops"}>{q ? `Nothing matches “${q}”.`
          : customers ? "No Menengai unit is stopped at a customer." : "No Menengai unit is standing in a no-go zone or stopped outside an authorised place."}</EmptyNote>
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
                    <i className={`ti ${stopKind(f).icon}`} aria-hidden="true" />{" "}
                    {f.kind === "nogo" ? <b style={{ color: "#c62828" }}>No-go zone</b> : stopKind(f).label}
                  </td>
                  <td className="sp4-td--left">{clock(f.since)}</td>
                  <td className="sp4-td--left">{standingWords(f.since, now)}</td>
                  <td className="sp4-td--left">
                    <ZoneType zone={type} />
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
          <TablePager pager={pager} label={customers ? "Customer stop pages" : "Unauthorised stop pages"} />
        </div>
      )}
      {openRow && (
        <DetailSidebar id="stop-watch-panel" title={stopKind(openRow).title}
                       label={`${stopKind(openRow).title}, ${openRow.plate}`}
                       itemKey={openRow.key} onClose={() => setOpenKey(null)}
                       footer={(
                         <a className="sp4-ghost-btn" href={`https://www.google.com/maps?q=${openRow.lat},${openRow.lng}`}
                            target="_blank" rel="noreferrer noopener">
                           <i className="ti ti-external-link" aria-hidden="true" /> Where it happened
                         </a>
                       )}>
          <DetailSidebarIdent
            kind={<span className="alr-kind"><i className={`ti ${stopKind(openRow).icon}`} aria-hidden="true" />
              {stopKind(openRow).label}</span>}
            name={openRow.plate} nameTitle={openRow.name || openRow.plate} sub={openRow.name && openRow.name !== openRow.plate ? openRow.name : undefined}
          />
          <DetailSidebarFacts facts={[
            { label: "Standing since", value: clock(openRow.since) },
            { label: "For", value: standingWords(openRow.since, now) },
            { label: "Where", value: <StopWhere f={openRow} /> },
            { label: "Type", value: <ZoneType zone={types.get(openRow.key)} /> },
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
