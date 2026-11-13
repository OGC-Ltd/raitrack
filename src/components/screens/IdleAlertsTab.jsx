/**
 * The Alerts page's Idle units: Menengai's listed units that have not moved
 * for 2 hours of working time (07:30–19:30), away from the yard and depots.
 * Now is the server's idle watch as it stands (hooks/useIdleWatch); History is
 * the idle stops it kept (IdleHistory). Which one, and History's days, are
 * picked in the page's filter bar (AlertsScreen), as Overspeeding's are, and
 * both are drawn in the Overspeeding list's shape (IdleTable).
 *
 * Under Now: the alerts dismissed in this browser, and the listed units the
 * rule cannot judge (trackers silent a day or more, plates not on the platform).
 */

import { useMemo, useState } from "react";
import EmptyNote from "../shared/EmptyNote";
import { usePager } from "../body/TablePager";
import { dismissIdle, undismissIdle } from "../../hooks/useIdleWatch";
import { eatWords, idleWords, searchAlerts } from "../../lib/idleAlerts";
import IdleHistory from "./IdleHistory";
import IdleTable from "./IdleTable";
import "./IdleAlertsTab.css";

function Dismissed({ alerts }) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return null;
  return (
    <section className="idle-aside" aria-label="Dismissed in this browser" title="Hidden in this browser only">
      <button type="button" className="sp4-ghost-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <i className={`ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`} aria-hidden="true" />
        {alerts.length} dismissed
      </button>
      {open && (
        <ul className="idle-aside-list">
          {alerts.map((a) => (
            <li key={a.key}>
              <span className="sp4-reg">{a.plate}</span>
              <span className="idle-aside-what">stopped {eatWords(a.since)}, idle {idleWords(a.idleMs)}</span>
              <button type="button" className="sp4-ghost-btn" onClick={() => undismissIdle(a.key)}>Undo</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The listed units the rule cannot judge, said once under the list. */
function Unjudged({ watch }) {
  const dark = watch.notReporting ?? [];
  const missing = watch.notOnPlatform ?? [];
  if (!dark.length && !missing.length) return null;
  return (
    <section className="idle-aside" aria-label="Not judged">
      {dark.length > 0 && (
        <p className="idle-aside-note">
          Not reporting, so not judged: {dark.map((d) => `${d.plate} (last ${eatWords(d.lastSeenAt)})`).join(", ")}
        </p>
      )}
      {missing.length > 0 && <p className="idle-aside-note">On the list but not on the platform: {missing.join(", ")}</p>}
    </section>
  );
}

function IdleNow({ watch, q }) {
  const active = useMemo(() => watch.alerts.filter((a) => !watch.dismissed.has(a.key)), [watch.alerts, watch.dismissed]);
  const shown = useMemo(() => searchAlerts(active, q), [active, q]);
  const dismissed = useMemo(() => watch.alerts.filter((a) => watch.dismissed.has(a.key)), [watch.alerts, watch.dismissed]);
  const pager = usePager(shown, q);
  const rule = watch.rule
    ? `${idleWords(watch.rule.idleMs)} still in working hours (${watch.rule.hours}), away from ${watch.rule.excluded.join(" and ")}`
    : "2 h still in working hours, away from the yard and depots";

  if (watch.status === "loading" || watch.status === "idle") {
    return <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Idle Units">Asking the server which Menengai units are idle.</EmptyNote>;
  }
  if (watch.status === "error") {
    return <EmptyNote icon="ti-alert-triangle" tone="error" title="Idle Units Could Not Be Loaded">{watch.message}. It is read again every minute.</EmptyNote>;
  }
  return (
    <>
      {shown.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title="No Idle Units">
          {q ? `Nothing matches “${q}”.` : `No listed Menengai unit has stood ${rule}.`}
        </EmptyNote>
      ) : (
        <IdleTable rows={shown} pager={pager} onDismiss={dismissIdle} label="Idle unit pages" />
      )}
      <Dismissed alerts={dismissed} />
      <Unjudged watch={watch} />
    </>
  );
}

/**
 * @param mode "now" or "history" (the filter bar's View)
 * @param days { from, to } for History (the filter bar's Days)
 */
export default function IdleAlertsTab({ watch, q = "", mode = "now", days }) {
  return mode === "history" && days
    ? <IdleHistory from={days.from} to={days.to} q={q} />
    : <IdleNow watch={watch} q={q} />;
}
