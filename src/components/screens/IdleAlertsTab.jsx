/**
 * Idle-alert tab on the Alerts page.
 *
 * Shows Menengai units that have been stationary (speed < 2 km/h) for more
 * than 3 hours. Alerts do NOT clear automatically — a user must dismiss them.
 *
 * Data comes from useIdleAlerts(), which:
 *   - Polls /api/v1/idle-alerts when the backend is live.
 *   - Falls back to detecting from live vehicle data + localStorage when it isn't.
 *
 * While the endpoint isn't live yet the tab shows a "monitoring active" state
 * with the list of units being watched — so the tab is useful right now.
 */

import { useMemo, useRef, useEffect, useState } from "react";
import EmptyNote from "../shared/EmptyNote";
import TablePager, { usePager } from "../body/TablePager";
import { useIdleAlerts } from "../../hooks/useIdleAlerts";
import { idleDuration } from "../../lib/idleAlerts";
import { copyText } from "../../lib/copyText";
import { MENENGAI_IDLE_UNITS } from "../../data/menengaiIdleUnits";
import "./IdleAlertsTab.css";

const EAT_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  day: "2-digit", month: "short",
  hour: "2-digit", minute: "2-digit",
  hour12: false,
});
const fmt = (ms) => ms ? EAT_FMT.format(ms) : "—";
const squash = (x) => String(x ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Build clipboard text for one idle alert. */
function alertCopyText(a) {
  const lines = [
    `Idle alert — ${a.plate} (${a.size} · ${a.designation})`,
    `Idle since: ${fmt(a.idleSinceMs)}`,
    `Duration:   ${idleDuration(a.durationMs)}`,
    `Speed:      ${a.speed != null ? `${Math.round(a.speed)} km/h` : "—"}`,
  ];
  if (a.location) lines.push(`Location:   ${a.location}`);
  if (a.lat != null && a.lng != null) lines.push(`Map:        https://www.google.com/maps?q=${a.lat},${a.lng}`);
  lines.push(`Severity:   ${a.severity}`);
  return lines.join("\n");
}

/** Copy icon button — tick on success, warning on failure, resets after 1.6 s. */
function CopyBtn({ alert }) {
  const [st, setSt] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async (e) => {
    e.stopPropagation();
    const ok = await copyText(alertCopyText(alert));
    setSt(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt("idle"), ok ? 1600 : 2600);
  };
  const label = st === "copied" ? "Copied" : st === "failed" ? "Could not copy" : "Copy alert details";
  return (
    <button
      type="button"
      className={`sp4-ghost-btn idle-copy-btn idle-copy-btn--${st}`}
      onClick={onClick}
      title={label}
      aria-label={label}
    >
      <i className={`ti ${st === "copied" ? "ti-check" : st === "failed" ? "ti-alert-triangle" : "ti-copy"}`} aria-hidden="true" />
    </button>
  );
}

function filterAlerts(alerts, q) {
  if (!q) return alerts;
  const s = squash(q);
  return alerts.filter(
    (a) => squash(a.plate).includes(s) || squash(a.location).includes(s) || squash(a.size).includes(s)
  );
}

/**
 * One row in the idle-alerts table.
 */
function IdleRow({ alert, onDismiss }) {
  const isCritical = alert.severity === "critical";
  return (
    <tr className={`idle-tr idle-tr--${alert.severity}`}>
      <td data-label="Plate">
        <span className="idle-plate">{alert.plate}</span>
        <span className="idle-meta">{alert.size} · {alert.designation}</span>
      </td>
      <td data-label="Location">
        {alert.lat != null && alert.lng != null ? (
          <a
            href={`https://www.google.com/maps?q=${alert.lat},${alert.lng}`}
            target="_blank" rel="noreferrer noopener"
            className="idle-location-link"
            onClick={(e) => e.stopPropagation()}
          >
            {alert.location || `${alert.lat.toFixed(4)}, ${alert.lng.toFixed(4)}`}
          </a>
        ) : (
          <span className="sp4-muted">{alert.location || "—"}</span>
        )}
      </td>
      <td data-label="Idle since">
        <span className="idle-since">{fmt(alert.idleSinceMs)}</span>
      </td>
      <td data-label="Duration">
        <span className={`idle-duration idle-duration--${alert.severity}`}>
          <i className={`ti ${isCritical ? "ti-alert-triangle" : "ti-clock"}`} aria-hidden="true" />
          {idleDuration(alert.durationMs)}
        </span>
      </td>
      <td data-label="Speed">
        <span className="sp4-muted">
          {alert.speed != null ? `${Math.round(alert.speed)} km/h` : "—"}
        </span>
      </td>
      <td data-label="">
        <span className="idle-row-acts">
          <CopyBtn alert={alert} />
          <button
            type="button"
            className="sp4-ghost-btn idle-dismiss-btn"
            title="Dismiss this alert — it will not reappear unless the unit stops again"
            onClick={() => onDismiss(alert.id)}
          >
            Dismiss
          </button>
        </span>
      </td>
    </tr>
  );
}

/**
 * Dismissed alerts listed below the main table, with undo buttons.
 */
function DismissedSection({ alerts, onUndismiss }) {
  const [open, setOpen] = useState(false);
  if (alerts.length === 0) return null;
  return (
    <div className="idle-dismissed-section">
      <button type="button" className="sp4-ghost-btn idle-dismissed-toggle" onClick={() => setOpen((o) => !o)}>
        <i className={`ti ${open ? "ti-chevron-down" : "ti-chevron-right"}`} aria-hidden="true" />
        {alerts.length} dismissed {alerts.length === 1 ? "alert" : "alerts"}
      </button>
      {open && (
        <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable idle-dismissed-table">
          <thead>
            <tr><th>Plate</th><th>Idle since</th><th>Duration</th><th></th></tr>
          </thead>
          <tbody>
            {alerts.map((a) => (
              <tr key={a.id} className="idle-tr idle-tr--dismissed">
                <td data-label="Plate">
                  <span className="idle-plate">{a.plate}</span>
                  <span className="idle-meta">{a.size}</span>
                </td>
                <td data-label="Idle since"><span className="idle-since">{fmt(a.idleSinceMs)}</span></td>
                <td data-label="Duration"><span className="idle-duration">{idleDuration(a.durationMs)}</span></td>
                <td data-label="">
                  <button type="button" className="sp4-ghost-btn idle-dismiss-btn" onClick={() => onUndismiss(a.id)}>Undo</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * The full idle-alerts tab, rendered inside AlertsScreen.
 * Pass `vehicles` (the app's live vehicle list) so the fallback detection works.
 */
export default function IdleAlertsTab({ q = "", vehicles }) {
  const { status, alerts, allAlerts, generatedAt, error, source, dismissedIds, dismiss, undismiss, refresh } =
    useIdleAlerts({ vehicles });

  const filtered  = useMemo(() => filterAlerts(alerts, q), [alerts, q]);
  const dismissed = useMemo(
    () => allAlerts.filter((a) => dismissedIds.has(a.id)),
    [allAlerts, dismissedIds]
  );

  const pager = usePager(filtered, q);

  if (status === "loading") {
    return (
      <EmptyNote icon="ti-loader-2" tone="busy" title="Reading Idle Alerts">
        Checking which Menengai units have been stationary over 3 hours.
      </EmptyNote>
    );
  }

  if (status === "error") {
    return (
      <EmptyNote icon="ti-alert-triangle" tone="error" title="Could Not Load Idle Alerts">
        {error}
        <button type="button" className="sp4-ghost-btn" onClick={refresh} style={{ marginTop: 8 }}>
          Retry
        </button>
      </EmptyNote>
    );
  }

  // No active alerts
  if (filtered.length === 0) {
    return (
      <div className="idle-no-alerts">
        <EmptyNote icon="ti-circle-check" tone="ok" title="No Idle Units">
          {q
            ? "No idle Menengai units match your search."
            : "All monitored Menengai units have been active in the last 3 hours."}
          {generatedAt && <span className="idle-generated">Checked {fmt(generatedAt)}</span>}
          {source === "local" && (
            <span className="idle-source-note">
              <i className="ti ti-database-off" aria-hidden="true" /> Monitoring locally —
              alerts will persist when you refresh. Backend integration pending.
            </span>
          )}
        </EmptyNote>
        {/* Still show dismissed section even when no active alerts */}
        <DismissedSection alerts={dismissed} onUndismiss={undismiss} />
        <div className="idle-fleet-preview">
          <p className="idle-fleet-label">
            Watching {MENENGAI_IDLE_UNITS.length} units · threshold 3 hours
          </p>
          <div className="idle-fleet-grid">
            {MENENGAI_IDLE_UNITS.map((u) => (
              <span key={u.plate} className="idle-fleet-pill">
                {u.plate}
                <span className="idle-fleet-pill__meta">{u.size}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const critical = filtered.filter((a) => a.severity === "critical").length;
  const warning  = filtered.filter((a) => a.severity === "warning").length;

  return (
    <div className="idle-wrap alr-table">
      <div className="idle-summary">
        {critical > 0 && (
          <span className="idle-badge idle-badge--critical">
            <i className="ti ti-alert-triangle" aria-hidden="true" />
            {critical} critical {critical === 1 ? "unit" : "units"} (6+ h)
          </span>
        )}
        {warning > 0 && (
          <span className="idle-badge idle-badge--warning">
            <i className="ti ti-clock" aria-hidden="true" />
            {warning} {warning === 1 ? "unit" : "units"} idle 3–6 h
          </span>
        )}
        <span className="idle-generated">
          {generatedAt ? `Updated ${fmt(generatedAt)}` : ""}
          {source === "local" && (
            <span className="idle-source-note">
              <i className="ti ti-database-off" aria-hidden="true" /> Local
            </span>
          )}
        </span>
        <button type="button" className="sp4-ghost-btn idle-refresh-btn" onClick={refresh} title="Check now">
          <i className="ti ti-refresh" aria-hidden="true" /> Refresh
        </button>
      </div>

      <div className="idle-table-scroll">
        <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
          <thead>
            <tr>
              <th>Plate</th>
              <th>Location</th>
              <th>Idle since</th>
              <th>Duration</th>
              <th>Speed</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pager.pageRows.map((a) => <IdleRow key={a.id} alert={a} onDismiss={dismiss} />)}
          </tbody>
        </table>
      </div>
      <TablePager pager={pager} label="Idle alert pages" />
      <DismissedSection alerts={dismissed} onUndismiss={undismiss} />
    </div>
  );
}
