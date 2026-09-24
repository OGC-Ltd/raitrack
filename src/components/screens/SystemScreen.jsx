/**
 * System: the account's own system notifications. Today that means fuel
 * follow-ups: deleting a fuel alert opens one, and somebody with case rights
 * (`fuel_theft:triage`) has to accept it and decide it. They used to sit
 * behind a button on the map, where a technician (no map) never saw them.
 *
 * The list is the shared store in lib/fuelFollowUps, so the sidebar badge and
 * this screen always agree. A row opens the case window (FuelFollowUpHost),
 * which is where accepting, notes and the decision happen.
 */

import { useEffect, useState } from "react";
import "./SystemScreen.css";
import { useAppContext } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import { fetchFollowUps, needsMe, openFollowUp, useFollowUps } from "../../lib/fuelFollowUps";
import { StatusChip, litres, when } from "../body/FuelFollowUp";

const TABS = [
  { key: "mine",   label: "For me" },
  { key: "active", label: "Outstanding" },
  { key: "closed", label: "Closed" },
];

const EMPTY = {
  mine:   "Nothing is waiting on you.",
  active: "No follow-ups are outstanding.",
  closed: "No follow-up has been decided yet.",
};

/** One line saying where the follow-up stands and who it is with. */
function whoLine(f) {
  switch (f.status) {
    case "OPEN":
      return `Alert deleted by ${f.dismissedBy?.fullName ?? "someone"} · ${when(f.openedAt)}`;
    case "ACCEPTED":
      return `${f.viewer?.ownsIt ? "With you" : `With ${f.acceptedBy?.fullName ?? "someone"}`} since ${when(f.acceptedAt)}`;
    case "ESCALATED":
      return `Confirmed theft by ${f.acceptedBy?.fullName ?? "someone"} · ${when(f.resolvedAt)}`;
    case "DEESCALATED":
      return `Closed as not a theft by ${f.acceptedBy?.fullName ?? "someone"} · ${when(f.resolvedAt)}`;
    default:
      return "";
  }
}

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

export default function SystemScreen() {
  const { activeCompany } = useAppContext();
  const { orgId, can } = usePermissions();
  const canTriage = can("fuel_theft:triage");
  const active = useFollowUps(orgId, canTriage);
  const [tab, setTab] = useState("mine");
  const closed = useClosed(orgId, canTriage && tab === "closed");

  const mine = active.items.filter(needsMe);
  const waiting = active.items.filter((f) => f.status === "OPEN").length;
  const reviewing = active.items.length - waiting;

  const list = tab === "mine" ? mine : tab === "active" ? active.items : closed.items;
  const loading = tab === "closed" ? closed.loading : active.loading && active.items.length === 0;
  const error = tab === "closed" ? closed.error : active.error;
  const count = { mine: mine.length, active: active.items.length, closed: null };

  return (
    <div className="sys-screen">
      <header className="sys-head">
        <h1 className="sys-title">System</h1>
        <p className="sys-sub">
          Notifications for {activeCompany?.name ?? "this organisation"}. When a fuel alert is
          deleted, a follow-up opens here until someone accepts it and decides it.
        </p>
      </header>

      <div className="sys-kpis">
        <div className="sys-kpi sys-kpi--me"><span className="sys-kpi-num">{mine.length}</span><span className="sys-kpi-lbl">Waiting on you</span></div>
        <div className="sys-kpi"><span className="sys-kpi-num">{waiting}</span><span className="sys-kpi-lbl">Waiting to be accepted</span></div>
        <div className="sys-kpi"><span className="sys-kpi-num">{reviewing}</span><span className="sys-kpi-lbl">Under review</span></div>
      </div>

      <div className="sys-tabs" role="tablist" aria-label="Follow-ups">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                  className={`sys-tab${tab === t.key ? " sys-tab--on" : ""}`}
                  onClick={() => setTab(t.key)}>
            {t.label}
            {count[t.key] != null && <span className="sys-tab-count">{count[t.key]}</span>}
          </button>
        ))}
      </div>

      <section className="sys-card" aria-live="polite">
        {error && <p className="sys-empty sys-empty--error">Could not load follow-ups.</p>}
        {!error && loading && <p className="sys-empty">Loading…</p>}
        {!error && !loading && list.length === 0 && <p className="sys-empty">{EMPTY[tab]}</p>}
        {!error && list.length > 0 && (
          <ul className="sys-list">
            {list.map((f) => (
              <li key={f.id}>
                <button type="button" className={`sys-row sys-row--${f.status.toLowerCase()}`}
                        onClick={() => openFollowUp(f.id)}>
                  <span className="sys-row-dot" aria-hidden="true" />
                  <span className="sys-row-main">
                    <span className="sys-row-title">
                      Fuel follow-up · <strong>{f.incident.plate}</strong>
                      <span className="sys-row-vol">{litres(f.incident.volumeMl)}</span>
                    </span>
                    <span className="sys-row-who">{whoLine(f)}</span>
                    <span className="sys-row-when">Happened {when(f.incident.beganAt)}</span>
                  </span>
                  <span className="sys-row-side">
                    {needsMe(f) && <span className="sys-turn">{f.status === "OPEN" ? "Accept" : "Decide"}</span>}
                    <StatusChip status={f.status} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
