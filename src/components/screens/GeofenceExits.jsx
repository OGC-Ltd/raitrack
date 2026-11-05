/*
 * Today's geofence exits on the Alerts page (operator, 5 Nov 2026), from the
 * server's notification history (lib/geofenceExits). A list to read and
 * search: no escalation or read marks, which the server keeps only for fuel
 * and overspeeding alerts.
 */

import { useMemo } from "react";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import { searchExits } from "../../lib/geofenceExits";

const clock = (ms) => new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", hour: "2-digit", minute: "2-digit", hour12: false }).format(ms);

export default function GeofenceExits({ state, q, orgName, showOrg, onRetry }) {
  const rows = useMemo(() => searchExits(state.rows ?? [], q), [state.rows, q]);
  const pager = usePager(rows, `${q}|${state.day}`);
  const shown = pager.pageRows;

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
        <div className="sp4-table-scroll aud-units alr-table">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <thead>
              <tr>
                <th className="sp4-th--left">Unit</th>
                <th className="sp4-th--left">When</th>
                <th className="sp4-th--left">Alert</th>
                <th className="sp4-th--left">Details</th>
                {showOrg && <th className="sp4-th--left">Organisation</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.key} className="sp4-tr">
                  <td className="sp4-td--left"><b>{r.plate ?? "-"}</b></td>
                  <td className="sp4-td--left">{clock(r.at)}</td>
                  <td className="sp4-td--left"><i className="ti ti-map-pin-off" aria-hidden="true" /> Geofence exit</td>
                  <td className="sp4-td--left">{r.text}</td>
                  {showOrg && <td className="sp4-td--left">{orgName(r.orgId)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager pager={pager} label="Geofence exit pages" />
        </div>
      )}
    </>
  );
}
