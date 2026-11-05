/*
 * Menengai's units flagged now by the stop watch (lib/stopWatch,
 * components/shared/StopWatch), on the Alerts page: standing in a no-go zone,
 * or stopped over 10 minutes outside every authorised place. It follows the
 * watch by itself; a unit that moves on drops off. Desktop alerts are turned
 * on here, once per browser.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { standingWords } from "../../lib/stopWatch";

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);
const squash = (x) => String(x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

function DesktopAlerts() {
  const can = typeof Notification !== "undefined";
  const [perm, setPerm] = useState(can ? Notification.permission : "denied");
  if (!can || perm === "granted") return null;
  if (perm === "denied") return <span className="sp4-muted">Desktop alerts are blocked in this browser’s settings.</span>;
  return (
    <button type="button" className="sp4-ghost-btn alr-desktop-alerts-btn" onClick={() => Notification.requestPermission().then(setPerm).catch(() => {})}
            title="A notification in the corner of the screen for each new one, even in another tab or program">
      <i className="ti ti-bell-plus" aria-hidden="true" /> Turn on desktop alerts
    </button>
  );
}

export default function UnauthorisedStops({ watch, q }) {
  const rows = useMemo(() => {
    const s = squash(q);
    return s ? watch.flags.filter((f) => squash(f.plate).includes(s) || squash(f.zone).includes(s)) : watch.flags;
  }, [watch.flags, q]);
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
  };

  return (
    <>
      <p className="sp4-muted alr-geo-note alr-stop-note" role="note">
        <DesktopAlerts />
        {watch.checkedAt && <span> Checked {clock(watch.checkedAt)}; it checks again every minute while the platform is open.</span>}
        {watch.status === "error" && <span className="rpt-warn"> The last check failed: {watch.message}</span>}
      </p>
      {watch.status === "loading" && !watch.checkedAt ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Checking Menengai’s Units">Where every unit stands, against the authorised places and the no-go zones.</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title="No Unauthorised Stops">{q ? `Nothing matches “${q}”.` : "No Menengai unit is standing in a no-go zone or stopped outside an authorised place."}</EmptyNote>
      ) : (
        <div className="sp4-table-scroll aud-units alr-table">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit</th>
                <th className="sp4-th--left">Alert</th>
                <th className="sp4-th--left">Standing since</th>
                <th className="sp4-th--left">For</th>
                <th className="sp4-th--left">Where</th>
                <th className="sp4-th--right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageRows.map((f) => (
                <tr key={f.key} className={"sp4-tr aud-tr" + (openKey === f.key ? " aud-tr--open" : "")}
                    tabIndex={0} aria-expanded={openKey === f.key} aria-controls={openKey === f.key ? "stop-watch-panel" : undefined}
                    onClick={(event) => toggle(f, event)}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggle(f, event); } }}>
                  <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{f.plate}</span>{f.name && f.name !== f.plate && <div className="sp4-muted">{f.name}</div>}</td>
                  <td className="sp4-td--left">
                    <i className={`ti ${f.kind === "nogo" ? "ti-hand-stop" : "ti-map-pin-exclamation"}`} aria-hidden="true" />{" "}
                    {f.kind === "nogo" ? <b style={{ color: "#c62828" }}>No-go zone</b> : "Unauthorised stop"}
                  </td>
                  <td className="sp4-td--left">{clock(f.since)}</td>
                  <td className="sp4-td--left">{standingWords(f.since, now)}</td>
                  <td className="sp4-td--left">
                    {f.zone ?? "Outside any authorised place"}{" "}
                    <a href={`https://www.google.com/maps?q=${f.lat},${f.lng}`} target="_blank" rel="noreferrer noopener" className="sp4-muted"
                       onClick={(event) => event.stopPropagation()}>({f.lat.toFixed(5)}, {f.lng.toFixed(5)})</a>
                  </td>
                  <td className="sp4-td--right">
                    <button type="button" className="sp4-ghost-btn"
                            onClick={(event) => { event.stopPropagation(); toggle(f, event); }}>
                      {openKey === f.key ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
              ))}
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
            { label: "Where", value: openRow.zone ?? "Outside any authorised place" },
          ]} />
          <DetailSidebarSection title="Location">
            <p className="dsb__note">{openRow.lat.toFixed(5)}, {openRow.lng.toFixed(5)}</p>
          </DetailSidebarSection>
        </DetailSidebar>
      )}
    </>
  );
}
