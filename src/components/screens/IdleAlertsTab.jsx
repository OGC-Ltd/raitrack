/**
 * The Alerts page's Idle units: Menengai's listed units that have not moved
 * for 3 hours of working time (07:30–19:30), away from the yard and depots,
 * as the server's idle watch has them now (hooks/useIdleWatch). Critical at
 * 6 hours. Below, the listed units the rule cannot judge: trackers silent a
 * day or more, and plates no tracked unit carries.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import { dismissIdle, undismissIdle } from "../../hooks/useIdleWatch";
import { alertText, eatWords, idleWords, mapUrl, searchAlerts, whereWords } from "../../lib/idleAlerts";
import { copyText } from "../../lib/copyText";
import "./IdleAlertsTab.css";

function CopyBtn({ alert }) {
  const [st, setSt] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(alertText(alert));
    setSt(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt("idle"), ok ? 1600 : 2600);
  };
  const label = st === "copied" ? "Copied" : st === "failed" ? "Could not copy" : "Copy alert details";
  return (
    <button type="button" className={`sp4-ghost-btn idle-copy-btn idle-copy-btn--${st}`} onClick={onClick} title={label} aria-label={label}>
      <i className={`ti ${st === "copied" ? "ti-check" : st === "failed" ? "ti-alert-triangle" : "ti-copy"}`} aria-hidden="true" />
    </button>
  );
}

function IdleRow({ alert: a }) {
  const url = mapUrl(a);
  return (
    <tr className={`idle-tr idle-tr--${a.severity}`}>
      <td data-label="Unit">
        <span className="idle-plate">{a.plate}</span>
        <span className="idle-meta">{a.size} · {a.designation}</span>
      </td>
      <td data-label="Where">
        {url
          ? <a href={url} target="_blank" rel="noreferrer noopener" className="idle-location-link">{whereWords(a)}</a>
          : <span className="sp4-muted">{whereWords(a)}</span>}
      </td>
      <td data-label="Stopped since">
        <span className="idle-since">{a.sinceExact === false ? "by " : ""}{eatWords(a.since)}</span>
      </td>
      <td data-label="Idle in working hours">
        <span className={`idle-duration idle-duration--${a.severity}`}>
          <i className={`ti ${a.severity === "critical" ? "ti-alert-triangle" : "ti-clock"}`} aria-hidden="true" />
          {a.sinceExact === false ? "at least " : ""}{idleWords(a.idleMs)}
        </span>
      </td>
      <td data-label="Engine"><span className="sp4-muted">{a.engineOn == null ? "—" : a.engineOn ? "On" : "Off"}</span></td>
      <td data-label="">
        <span className="idle-row-acts">
          <CopyBtn alert={a} />
          <button type="button" className="sp4-ghost-btn idle-dismiss-btn" onClick={() => dismissIdle(a.key)}
                  title="Hide this alert in this browser. If the unit moves and stops again, that is a new alert.">
            Dismiss
          </button>
        </span>
      </td>
    </tr>
  );
}

function Dismissed({ alerts }) {
  const [open, setOpen] = useState(false);
  if (!alerts.length) return null;
  return (
    <div className="idle-dismissed-section">
      <button type="button" className="sp4-ghost-btn idle-dismissed-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <i className={`ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`} aria-hidden="true" />
        {alerts.length} dismissed
      </button>
      {open && (
        <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable idle-dismissed-table">
          <thead><tr><th>Unit</th><th>Stopped since</th><th>Idle in working hours</th><th></th></tr></thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.key} className="idle-tr idle-tr--dismissed">
                <td data-label="Unit"><span className="idle-plate">{a.plate}</span><span className="idle-meta">{a.size}</span></td>
                <td data-label="Stopped since"><span className="idle-since">{eatWords(a.since)}</span></td>
                <td data-label="Idle in working hours"><span className="idle-duration">{idleWords(a.idleMs)}</span></td>
                <td data-label=""><button type="button" className="sp4-ghost-btn idle-dismiss-btn" onClick={() => undismissIdle(a.key)}>Undo</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/** The listed units the rule cannot judge, said once under the list. */
function Unjudged({ watch }) {
  const dark = watch.notReporting ?? [];
  const missing = watch.notOnPlatform ?? [];
  if (!dark.length && !missing.length) return null;
  return (
    <div className="idle-fleet-preview">
      {dark.length > 0 && (
        <p className="idle-fleet-label">
          Not reporting, so not judged: {dark.map((d) => `${d.plate} (last ${eatWords(d.lastSeenAt)})`).join(", ")}
        </p>
      )}
      {missing.length > 0 && (
        <p className="idle-fleet-label">On the list but not on the platform: {missing.join(", ")}</p>
      )}
    </div>
  );
}

export default function IdleAlertsTab({ watch, q = "" }) {
  const active = useMemo(() => watch.alerts.filter((a) => !watch.dismissed.has(a.key)), [watch.alerts, watch.dismissed]);
  const shown = useMemo(() => searchAlerts(active, q), [active, q]);
  const dismissed = useMemo(() => watch.alerts.filter((a) => watch.dismissed.has(a.key)), [watch.alerts, watch.dismissed]);
  const pager = usePager(shown, q);
  const rule = watch.rule
    ? `${idleWords(watch.rule.idleMs)} still in working hours (${watch.rule.hours}), away from ${watch.rule.excluded.join(" and ")}`
    : "3 h still in working hours, away from the yard and depots";

  if (watch.status === "loading" || watch.status === "idle") {
    return <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Idle Units">Asking the server which Menengai units are idle.</EmptyNote>;
  }
  if (watch.status === "error") {
    return <EmptyNote icon="ti-alert-triangle" tone="error" title="Could Not Read Idle Units">{watch.message}. It is read again every minute.</EmptyNote>;
  }

  return (
    <div className="idle-wrap alr-table">
      {shown.length === 0 ? (
        <EmptyNote icon="ti-circle-check" tone="ok" title="No Idle Units">
          {q ? "No idle Menengai unit matches the search." : `No listed Menengai unit has stood ${rule}.`}
          {watch.checkedAt && <span className="idle-generated">Checked {eatWords(watch.checkedAt)}</span>}
        </EmptyNote>
      ) : (<>
        <p className="idle-rule sp4-muted">Idle: {rule}. Critical from {idleWords(watch.rule?.criticalMs ?? 6 * 3_600_000)}. Checked {eatWords(watch.checkedAt)}.</p>
        <div className="idle-table-scroll">
          <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
            <thead>
              <tr><th>Unit</th><th>Where</th><th>Stopped since</th><th>Idle in working hours</th><th>Engine</th><th></th></tr>
            </thead>
            <tbody>{pager.pageRows.map((a) => <IdleRow key={a.key} alert={a} />)}</tbody>
          </table>
        </div>
        <TablePager pager={pager} label="Idle unit pages" />
      </>)}
      <Dismissed alerts={dismissed} />
      <Unjudged watch={watch} />
    </div>
  );
}
