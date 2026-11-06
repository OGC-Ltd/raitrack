/*
 * Today's geofence exits on the Alerts page (operator, 5 Nov 2026), from the
 * server's notification history (lib/geofenceExits). A list to read and
 * search: no escalation, which the server keeps only for fuel and
 * overspeeding alerts. Unread exits look as unread alerts do; the marks are
 * the bell's (lib/feedReads), passed in by the page.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { loadZones } from "../../hooks/useEstateZones";
import { copyText } from "../../lib/copyText";
import { ZONE_STYLE } from "../../lib/zoneLegend";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { byRead, exitCopyText, searchExits, zoneIndex } from "../../lib/geofenceExits";

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);

/**
 * The geofences of the organisations with exits, read once each (loadZones
 * caches them for the page, and the map has usually read the active one).
 * → { index: Map(id → { name, category }) | null }
 */
function useExitZones(rows) {
  const orgKey = useMemo(() => [...new Set((rows ?? []).map((r) => r.orgId))].sort().join(","), [rows]);
  const [read, setRead] = useState({ key: null, index: null });
  useEffect(() => {
    if (!orgKey) return undefined;
    let live = true;
    Promise.allSettled(orgKey.split(",").map((id) => loadZones(id))).then((parts) => {
      if (live) setRead({ key: orgKey, index: zoneIndex(parts.filter((p) => p.status === "fulfilled").map((p) => p.value)) });
    });
    return () => { live = false; };
  }, [orgKey]);
  return read.key === orgKey ? read : { index: null };
}

/** A row's geofence: its name and type, or null while the geofences are read. */
const zoneOf = (index, row) => {
  if (!index) return null;
  const z = row.zoneId ? index.get(row.zoneId) : null;
  const category = ZONE_STYLE[z?.category] ? z.category : "other";
  const style = ZONE_STYLE[category];
  return { name: z?.name ?? null, category, label: style.label, color: style.osmColor ?? style.color };
};

/** The geofence type: a dot in the map's colour for it, and its word. */
export function ZoneType({ zone }) {
  if (!zone) return <span className="alr-geo-type alr-geo-type--pending" aria-label="Reading the geofence type">…</span>;
  return (
    <span className="alr-geo-type" title={zone.name ? `${zone.name}: ${zone.label}` : zone.label}>
      <i className="alr-geo-type__dot" style={{ "--zone": zone.color }} aria-hidden="true" />{zone.label}
    </span>
  );
}

/**
 * Copy one exit to paste elsewhere. The icon becomes a tick or a warning for
 * a moment, so the result is seen without the tooltip; the row is not opened.
 */
export function CopyExit({ text, plate, onCopied, what = "exit" }) {
  const [state, setState] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onCopy = async (event) => {
    event.stopPropagation();
    const ok = await copyText(typeof text === "function" ? text() : text);
    setState(ok ? "copied" : "failed");
    if (ok) onCopied?.();
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ok ? 1600 : 2600);
  };
  const words = state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : `Copy the ${plate ?? "unit"} ${what}`;
  return (
    <button type="button" className={`alr-copy-btn alr-copy-btn--${state}`} onClick={onCopy}
            onKeyDown={(event) => event.stopPropagation()} title={words} aria-label={words}>
      <i className={`ti ${state === "copied" ? "ti-check" : state === "failed" ? "ti-alert-triangle" : "ti-copy"}`} aria-hidden="true" />
    </button>
  );
}

const NO_READS = { unread: () => false, markRead: () => {} };
const EMPTY_READ = {
  unread: { icon: "ti-mail-opened", title: "Nothing Unread", sub: "You have opened every geofence exit listed today." },
  read: { icon: "ti-mail", title: "Nothing Read Yet", sub: "Exits you open or copy are listed here." },
};

/**
 * reads: { unread(row), markRead(rows) } (lib/feedReads useOrgsFeedReads);
 * read: the page's Read filter.
 */
export default function GeofenceExits({ state, q, orgName, showOrg, onRetry, reads = NO_READS, read = "all" }) {
  const zones = useExitZones(state.rows);
  // Opened under the Unread or Read filter: kept on screen until it changes.
  const [keep, setKeep] = useState(() => new Set());
  useEffect(() => { setKeep(new Set()); }, [read]);
  const rows = useMemo(
    () => byRead(searchExits(state.rows ?? [], q, (r) => zoneOf(zones.index, r)?.label), read, reads.unread, keep),
    [state.rows, q, zones.index, read, reads.unread, keep],
  );
  const seen = (row) => {
    if (read !== "all") setKeep((k) => (k.has(row.key) ? k : new Set(k).add(row.key)));
    reads.markRead([row]);
  };
  const copyOf = (r) => {
    const z = zoneOf(zones.index, r);
    return exitCopyText(r, { type: z?.label, zone: z?.name, org: orgName(r.orgId) });
  };
  const pager = usePager(rows, `${q}|${state.day}`);
  const shown = pager.pageRows;
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

  if (state.status === "loading") {
    return <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Today’s Geofence Exits">Every time a unit left a geofence today, in the organisations picked.</EmptyNote>;
  }
  if (state.status === "error") {
    return <EmptyNote icon="ti-alert-triangle" tone="error" title="The Geofence Exits Could Not Be Loaded" action={{ label: "Try again", onClick: onRetry }}>{state.message}</EmptyNote>;
  }
  return (
    <>
      {(state.failed?.length > 0 || state.cut?.length > 0) && (
      <p className="sp4-muted alr-geo-note" role="note">
        {state.failed?.length > 0 && <span className="rpt-warn"> Not read for {state.failed.map(orgName).join(", ")}.</span>}
        {state.cut?.length > 0 && <span> {state.cut.map(orgName).join(", ")}: the newest exits only, the day is longer than the page reads.</span>}
      </p>
      )}
      {rows.length === 0 ? (
        EMPTY_READ[read] && state.rows?.length ? (
          <EmptyNote icon={EMPTY_READ[read].icon} title={EMPTY_READ[read].title}>{q ? `Nothing matches “${q}”.` : EMPTY_READ[read].sub}</EmptyNote>
        ) : (
          <EmptyNote icon="ti-map-pin-off" title="No Geofence Exits">{q ? `Nothing matches “${q}”.` : "No unit has left a geofence today."}</EmptyNote>
        )
      ) : (
        <div className={`sp4-table-scroll aud-units alr-table alr-geo-table${showOrg ? " alr-geo-table--with-org" : ""}`}>
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <colgroup>
              <col className="alr-geo-col--unit" />
              <col className="alr-geo-col--when" />
              <col className="alr-geo-col--alert" />
              <col className="alr-geo-col--type" />
              <col className="alr-geo-col--details" />
              {showOrg && <col className="alr-geo-col--org" />}
              <col className="alr-geo-col--action" />
            </colgroup>
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit</th>
                <th className="sp4-th--left">When</th>
                <th className="sp4-th--left">Alert</th>
                <th className="sp4-th--left">Type</th>
                <th className="sp4-th--left">Details</th>
                {showOrg && <th className="sp4-th--left">Organisation</th>}
                <th className="sp4-th--right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => { const unread = reads.unread(r); return (
                <tr key={r.key} className={"sp4-tr aud-tr" + (openKey === r.key ? " aud-tr--open" : "") + (unread ? " alr-tr--unread" : "")}
                    tabIndex={0} aria-expanded={openKey === r.key} aria-controls={openKey === r.key ? "geo-exit-panel" : undefined}
                    onClick={(event) => toggle(r, event)}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggle(r, event); } }}>
                  <td className="sp4-td--left sp4-td--pin">
                    {unread && <span className="alr-unread-dot" role="img" aria-label="Unread" title="Unread" />}
                    <span className="sp4-reg" title={r.plate ?? undefined}>{r.plate ?? "-"}</span>
                  </td>
                  <td className="sp4-td--left">{clock(r.at)}</td>
                  <td className="sp4-td--left">
                    <span className="alr-geo-alert"><i className="ti ti-map-pin-off" aria-hidden="true" />Geofence exit</span>
                  </td>
                  <td className="sp4-td--left"><ZoneType zone={zoneOf(zones.index, r)} /></td>
                  <td className="sp4-td--left"><span className="alr-geo-details">{r.text}</span></td>
                  {showOrg && <td className="sp4-td--left">{orgName(r.orgId)}</td>}
                  <td className="sp4-td--right">
                    <span className="alr-geo-actions">
                      <CopyExit text={copyOf(r)} plate={r.plate} onCopied={() => seen(r)} />
                      <button type="button" className="sp4-ghost-btn"
                              onClick={(event) => { event.stopPropagation(); toggle(r, event); }}>
                        {openKey === r.key ? "Hide" : "Details"}
                      </button>
                    </span>
                  </td>
                </tr>
              ); })}
            </tbody>
          </table>
          <TablePager pager={pager} label="Geofence exit pages" />
        </div>
      )}
      {openRow && (
        <DetailSidebar id="geo-exit-panel" title="Geofence exit" label={`Geofence exit, ${openRow.plate ?? "unit"}`}
                       itemKey={openRow.key} onClose={() => setOpenKey(null)}>
          <DetailSidebarIdent
            kind={<span className="alr-kind"><i className="ti ti-map-pin-off" aria-hidden="true" />Geofence exit</span>}
            name={openRow.plate ?? "-"} sub={orgName(openRow.orgId)}
          />
          <DetailSidebarFacts facts={[
            { label: "When", value: clock(openRow.at) },
            { label: "Type", value: <ZoneType zone={zoneOf(zones.index, openRow)} /> },
            { label: "Geofence", value: zoneOf(zones.index, openRow)?.name ?? "-" },
            { label: "Organisation", value: orgName(openRow.orgId) },
          ]} />
          <DetailSidebarSection title="What Happened">
            <p className="dsb__note">{openRow.text}</p>
            <p className="alr-geo-copyline"><CopyExit text={copyOf(openRow)} plate={openRow.plate} />Copy this exit to paste elsewhere</p>
          </DetailSidebarSection>
        </DetailSidebar>
      )}
    </>
  );
}
