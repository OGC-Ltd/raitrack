/*
 * Today's geofence exits on the Alerts page (operator, 5 Nov 2026), from the
 * server's notification history (lib/geofenceExits). A list to read and
 * search: no escalation or read marks, which the server keeps only for fuel
 * and overspeeding alerts.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import DetailSidebar, { DetailSidebarFacts, DetailSidebarIdent, DetailSidebarSection } from "../shared/DetailSidebar";
import { searchExits } from "../../lib/geofenceExits";

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);

export default function GeofenceExits({ state, q, orgName, showOrg, onRetry }) {
  const rows = useMemo(() => searchExits(state.rows ?? [], q), [state.rows, q]);
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
        <EmptyNote icon="ti-map-pin-off" title="No Geofence Exits">{q ? `Nothing matches “${q}”.` : "No unit has left a geofence today."}</EmptyNote>
      ) : (
        <div className={`sp4-table-scroll aud-units alr-table alr-geo-table${showOrg ? " alr-geo-table--with-org" : ""}`}>
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <colgroup>
              <col className="alr-geo-col--unit" />
              <col className="alr-geo-col--when" />
              <col className="alr-geo-col--alert" />
              <col className="alr-geo-col--details" />
              {showOrg && <col className="alr-geo-col--org" />}
              <col className="alr-geo-col--action" />
            </colgroup>
            <thead>
              <tr>
                <th className="sp4-th--left sp4-th--pin">Unit</th>
                <th className="sp4-th--left">When</th>
                <th className="sp4-th--left">Alert</th>
                <th className="sp4-th--left">Details</th>
                {showOrg && <th className="sp4-th--left">Organisation</th>}
                <th className="sp4-th--right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className={"sp4-tr aud-tr" + (openKey === r.key ? " aud-tr--open" : "")}
                    tabIndex={0} aria-expanded={openKey === r.key} aria-controls={openKey === r.key ? "geo-exit-panel" : undefined}
                    onClick={(event) => toggle(r, event)}
                    onKeyDown={(event) => { if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggle(r, event); } }}>
                  <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{r.plate ?? "-"}</span></td>
                  <td className="sp4-td--left">{clock(r.at)}</td>
                  <td className="sp4-td--left">
                    <span className="alr-geo-alert"><i className="ti ti-map-pin-off" aria-hidden="true" />Geofence exit</span>
                  </td>
                  <td className="sp4-td--left"><span className="alr-geo-details">{r.text}</span></td>
                  {showOrg && <td className="sp4-td--left">{orgName(r.orgId)}</td>}
                  <td className="sp4-td--right">
                    <button type="button" className="sp4-ghost-btn"
                            onClick={(event) => { event.stopPropagation(); toggle(r, event); }}>
                      {openKey === r.key ? "Hide" : "Details"}
                    </button>
                  </td>
                </tr>
              ))}
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
            { label: "Organisation", value: orgName(openRow.orgId) },
          ]} />
          <DetailSidebarSection title="What Happened">
            <p className="dsb__note">{openRow.text}</p>
          </DetailSidebarSection>
        </DetailSidebar>
      )}
    </>
  );
}
