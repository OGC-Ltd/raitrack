/**
 * System: the account's own system notifications. Today that means fuel
 * follow-ups: deleting a fuel alert opens one, and somebody with case rights
 * (`fuel_theft:triage`) has to accept it and decide it.
 *
 * Built from the Sensor Monitor's parts, like Repairs: the KPI header, the
 * State chips in a FilterBar, TableToolbar, and the `sp4-probe-table` grid.
 * A second table voice on this screen would read as a second product.
 *
 * The outstanding list is the shared store in lib/fuelFollowUps, so the
 * sidebar badge and this screen always agree. A row opens the case window
 * (FuelFollowUpHost), which is where accepting, notes and the decision happen.
 */

import { useEffect, useRef, useState } from "react";
import "../body/SensorPanel.css";
import "./SystemScreen.css";
import { usePermissions } from "../../hooks/usePermissions";
import { STATUS_LABEL, fetchFollowUps, followUpsChanged, needsMe, openFollowUp, useFollowUps } from "../../lib/fuelFollowUps";
import { litres, when } from "../body/FuelFollowUp";
import TableToolbar from "../body/TableToolbar";
import FilterBar from "../body/FilterBar";
import { watchTableLabels } from "../../lib/tableLabels";

const STATES = [
  ["mine",   "For me"],
  ["active", "Outstanding"],
  ["closed", "Closed"],
];

const EMPTY = {
  mine:   "Nothing is waiting on you.",
  active: "No follow-ups are outstanding.",
  closed: "No follow-up has been decided yet.",
};

// The panel's pill tones: amber waiting, blue in hand, red theft, green cleared.
const STATUS_PILL = { OPEN: "warn", ACCEPTED: "info", ESCALATED: "inc", DEESCALATED: "con" };
// Pill-length names; STATUS_LABEL's full sentences are the case window's.
const PILL_LABEL = { OPEN: "To accept", ACCEPTED: "Under review", ESCALATED: "Confirmed theft", DEESCALATED: "Not a theft" };

/** Closed follow-ups are not in the shared store, which holds only open work. */
function useClosed(orgId, enabled) {
  const [s, setS] = useState({ items: [], loading: true, error: null });
  useEffect(() => {
    if (!enabled || !orgId) return undefined;
    let live = true;
    const read = () => fetchFollowUps(orgId, "closed")
      .then((items) => { if (live) setS({ items, loading: false, error: null }); })
      .catch((e) => { if (live) setS({ items: [], loading: false, error: e?.message || "Could not load" }); });
    read();
    window.addEventListener("ft-fuel-followup-changed", read);
    return () => { live = false; window.removeEventListener("ft-fuel-followup-changed", read); };
  }, [orgId, enabled]);
  return s;
}

const muted = (v) => v ?? <span className="sp4-muted">—</span>;

export default function SystemScreen() {
  const { orgId, can } = usePermissions();
  const canTriage = can("fuel_theft:triage");
  const active = useFollowUps(orgId, canTriage);
  const [state, setState] = useState("mine");
  const closed = useClosed(orgId, canTriage && state === "closed");

  const mine = active.items.filter(needsMe);
  const waiting = active.items.filter((f) => f.status === "OPEN").length;
  const reviewing = active.items.length - waiting;

  const rows = state === "mine" ? mine : state === "active" ? active.items : closed.items;
  const loading = state === "closed" ? closed.loading : active.loading;
  const error = state === "closed" ? closed.error : active.error;
  const litresShown = rows.reduce((sum, f) => sum + (f.incident.volumeMl ?? 0), 0);

  // Column heads onto the cells, for the phone's card layout (lib/tableLabels).
  const rootRef = useRef(null);
  useEffect(() => watchTableLabels(rootRef.current), []);

  return (
    <div className="sp4-root sys-root" ref={rootRef}>
      <div className="sp4-header">
        <div className="sp4-header-kpis">
          <div className="sp4-kpi sys-kpi--me" title="Follow-ups you can accept, or accepted and still have to decide.">
            <span className="sp4-kpi-n">{mine.length}</span>
            <span className="sp4-kpi-l">For you</span>
          </div>
          <div className="sp4-kpi sp4-kpi--fuel" title="Deleted fuel alerts nobody has accepted yet.">
            <span className="sp4-kpi-n">{waiting}</span>
            <span className="sp4-kpi-l">To accept</span>
          </div>
          <div className="sp4-kpi sp4-kpi--fleet" title="Accepted, and not yet escalated or de-escalated.">
            <span className="sp4-kpi-n">{reviewing}</span>
            <span className="sp4-kpi-l">Under review</span>
          </div>
        </div>
      </div>

      <div className="sp4-body">
        <TableToolbar
          summary={
            <>
              <b>{rows.length}</b> follow-up{rows.length === 1 ? "" : "s"}
              {rows.length > 0 && <> · {litres(litresShown)}</>}
            </>
          }
          loading={loading}
          onReload={followUpsChanged}
          disabled={!rows.length}
        />

        <FilterBar label="State" activeCount={state !== "mine" ? 1 : 0}>
          <div className="sp4-filter-group">
            <span className="sp4-filter-label">State</span>
            {STATES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={"sp4-filter-chip" + (state === id ? " sp4-filter-chip--on" : "")}
                aria-pressed={state === id}
                onClick={() => setState(id)}
              >
                {label}
                {id !== "closed" && <span className="sys-chip-n">{id === "mine" ? mine.length : active.items.length}</span>}
              </button>
            ))}
          </div>
        </FilterBar>

        {error && <div className="sp4-banner sp4-banner--crit">Could not load follow-ups.</div>}

        {!error && !loading && rows.length === 0 && <div className="sp4-empty">{EMPTY[state]}</div>}

        {rows.length > 0 && (
          <div className="sp4-table-scroll">
            <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
              <thead>
                <tr>
                  <th className="sp4-th--left">Unit Reg</th>
                  <th className="sp4-th--right">Volume</th>
                  <th className="sp4-th--left">Happened</th>
                  <th className="sp4-th--left">Where</th>
                  <th className="sp4-th--left">Deleted by</th>
                  <th className="sp4-th--left">Accepted by</th>
                  <th className="sp4-th--left">Status</th>
                  <th className="sp4-th--right">{state === "closed" ? "Decided" : "Opened"}</th>
                  <th className="sp4-th--right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((f) => {
                  const turn = needsMe(f);
                  return (
                    <tr
                      key={f.id}
                      className="sp4-tr sp4-tr--incident"
                      tabIndex={0}
                      onClick={() => openFollowUp(f.id)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openFollowUp(f.id); } }}
                    >
                      <td className="sp4-td--left"><span className="sp4-reg">{f.incident.plate ?? "—"}</span></td>
                      <td className="sp4-td--right sys-num">{litres(f.incident.volumeMl)}</td>
                      <td className="sp4-td--left sys-num">{when(f.incident.beganAt)}</td>
                      <td className="sp4-td--left sys-where">{muted(f.incident.location)}</td>
                      <td className="sp4-td--left">
                        {muted(f.dismissedBy?.fullName)}
                        {f.viewer?.deletedIt && <span className="sp4-muted"> (you)</span>}
                      </td>
                      <td className="sp4-td--left">
                        {f.acceptedBy ? f.acceptedBy.fullName : <span className="sp4-muted">Nobody yet</span>}
                        {f.viewer?.ownsIt && <span className="sp4-muted"> (you)</span>}
                      </td>
                      <td className="sp4-td--left">
                        <span className={"sp4-pill sp4-pill--" + (STATUS_PILL[f.status] ?? "none")}>
                          {PILL_LABEL[f.status] ?? STATUS_LABEL[f.status] ?? f.status}
                        </span>
                      </td>
                      <td className="sp4-td--right sys-num">{when(state === "closed" ? f.resolvedAt : f.openedAt)}</td>
                      <td className="sp4-td--right">
                        <button
                          type="button"
                          className="sp4-ghost-btn"
                          onClick={(e) => { e.stopPropagation(); openFollowUp(f.id); }}
                        >
                          {turn ? (f.status === "OPEN" ? "Accept" : "Decide") : "View"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
