/**
 * Alerts › Idle units, as a table in the Overspeeding list's own shape
 * (operator, 2026-11-13: "match our theme and be like overspeeding looks"):
 * Unit, When, Alert (the kind, then the one figure with its bar), Details,
 * State, Action. One table for both views: Now (the server's live list) and
 * History (the idle stops kept).
 */

import { useEffect, useRef, useState } from "react";
import TablePager from "../body/TablePager";
import { alertText, eatWords, idleWords, mapUrl, whereWords } from "../../lib/idleAlerts";
import { copyText } from "../../lib/copyText";

function CopyBtn({ alert }) {
  const [st, setSt] = useState("ready");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async (e) => {
    e.stopPropagation();
    const ok = await copyText(alertText(alert));
    setSt(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt("ready"), ok ? 1600 : 2600);
  };
  const label = st === "copied" ? "Copied" : st === "failed" ? "Could not copy" : "Copy alert details";
  return (
    <button type="button" className={`sp4-ghost-btn idle-copy idle-copy--${st}`} onClick={onClick} title={label} aria-label={label}>
      <i className={`ti ${st === "copied" ? "ti-check" : st === "failed" ? "ti-alert-triangle" : "ti-copy"}`} aria-hidden="true" />
    </button>
  );
}

/** The State cell: how bad it got, and in History whether it is over. */
function state(a, history) {
  if (history && a.endedAt) {
    return { label: "Moved", tone: "con", sub: `moved ${eatWords(a.endedAt)}` };
  }
  if (a.severity === "critical") return { label: "Critical", tone: "inc", sub: "idle 6 h or more" };
  return { label: history ? "Still idle" : "Idle", tone: "warn", sub: "idle 1 h 30 min or more" };
}

/**
 * @param rows      the alerts (Now) or the idle stops kept (History)
 * @param history   true for History: the stop's end and the Map action
 * @param pager     usePager over `rows`
 * @param onDismiss Now only: hide one alert in this browser
 */
export default function IdleTable({ rows, history = false, pager, onDismiss, label }) {
  const most = Math.max(1, ...rows.map((r) => r.idleMs ?? 0));
  return (
    <div className="sp4-table-scroll aud-units alr-table">
      <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
        <thead>
          <tr>
            <th className="sp4-th--left sp4-th--pin">Unit</th>
            <th className="sp4-th--left">Stopped</th>
            <th className="sp4-th--left">Alert</th>
            <th className="sp4-th--left">Details</th>
            <th className="sp4-th--left">State</th>
            <th className="sp4-th--right">Action</th>
          </tr>
        </thead>
        <tbody>
          {pager.pageRows.map((a) => {
            const st = state(a, history);
            const url = mapUrl(a);
            const kind = [a.size, a.designation].filter(Boolean).join(" ");
            return (
              <tr key={a.key} className="sp4-tr aud-tr">
                <td className="sp4-td--left sp4-td--pin">
                  <span className="sp4-reg">{a.plate}</span>
                  {kind && <span className="alr-org">{kind}</span>}
                </td>
                <td className="sp4-td--left sys-num">
                  {a.sinceExact === false ? "by " : ""}{eatWords(a.since)}
                </td>
                <td className="sp4-td--left">
                  <span className="alr-kind alr-kind--idle">
                    <i className="ti ti-clock-pause" aria-hidden="true" />Idle
                  </span>
                  <span className="aud-cellbar alr-figure">
                    <span>
                      <b className={"sys-num" + (a.severity === "critical" ? " alr-over" : "")}>
                        {a.sinceExact === false ? "at least " : ""}{idleWords(a.idleMs)}
                      </b>{" "}
                      <span className="aud-unit">in working hours</span>
                    </span>
                    <i aria-hidden="true">
                      <b className={a.severity === "critical" ? "aud-cellbar--alert" : "idle-bar"}
                         style={{ width: `${Math.max(2, Math.min(1, (a.idleMs ?? 0) / most) * 100)}%` }} />
                    </i>
                  </span>
                </td>
                <td className="sp4-td--left alr-details">
                  {url
                    ? <a href={url} target="_blank" rel="noreferrer noopener" className="idle-where">{whereWords(a)}</a>
                    : whereWords(a)}
                  {a.engineOn != null && <span className="alr-state-sub">Engine {a.engineOn ? "on" : "off"}</span>}
                </td>
                <td className="sp4-td--left">
                  <span className="alr-state">
                    <span className={`sp4-pill sp4-pill--${st.tone}`}>{st.label}</span>
                    <span className="alr-state-sub">{st.sub}</span>
                  </span>
                </td>
                <td className="sp4-td--right">
                  <span className="alr-actions">
                    <CopyBtn alert={a} />
                    {onDismiss && (
                      <button type="button" className="sp4-ghost-btn" onClick={() => onDismiss(a.key)}
                              title="Hide this alert in this browser. If the unit moves and stops again, that is a new alert.">
                        Dismiss
                      </button>
                    )}
                    {history && url && (
                      <a className="sp4-ghost-btn" href={url} target="_blank" rel="noreferrer noopener">Map</a>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <TablePager pager={pager} label={label} />
    </div>
  );
}
