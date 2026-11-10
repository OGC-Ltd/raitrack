/**
 * Idle alert corner badge.
 *
 * Mounted once in App.jsx (alongside StopWatch / ToastStack). Shows a fixed
 * bottom-right card whenever there are active (non-dismissed) idle alerts for
 * the Menengai fleet. Clicking "Open" switches the app to the Alerts page and
 * jumps straight to the Idle Alerts tab.
 *
 * Intentionally lightweight: it reads from useIdleAlerts() which is already
 * polling — no extra network calls.
 */

import { useEffect, useRef, useState } from "react";
import { useAppActions, useCompanies } from "../../context/AppContext";
import { useIdleAlerts, requestIdleView } from "../../hooks/useIdleAlerts";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { copyText } from "../../lib/copyText";
import { idleDuration } from "../../lib/idleAlerts";
import "./IdleAlertBadge.css";

const EAT_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Africa/Nairobi",
  day: "2-digit", month: "short",
  hour: "2-digit", minute: "2-digit",
  hour12: false,
});
const fmt = (ms) => ms ? EAT_FMT.format(ms) : "—";

/** Build the clipboard text for one alert. */
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

function CopyBtn({ text }) {
  const [st, setSt] = useState("idle");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const onClick = async () => {
    const ok = await copyText(text);
    setSt(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setSt("idle"), ok ? 1600 : 2600);
  };
  const label = st === "copied" ? "Copied" : st === "failed" ? "Could not copy" : "Copy alert details";
  return (
    <button type="button" className={`iab__copy iab__copy--${st}`} onClick={onClick} title={label} aria-label={label}>
      <i className={`ti ${st === "copied" ? "ti-check" : st === "failed" ? "ti-alert-triangle" : "ti-copy"}`} aria-hidden="true" />
    </button>
  );
}

export default function IdleAlertBadge() {
  const { companies } = useCompanies();
  const holdsMenungai = companies.some((c) => c.id === "menengai");
  const { setDesktopActiveTab } = useAppActions();
  const { vehicles: liveVehicles } = useFleetLiveShared();
  const { status, alerts } = useIdleAlerts({ vehicles: liveVehicles });
  const [dismissed, setDismissed] = useState(false);

  // Reset local dismissed flag when alert count changes so new alerts re-surface.
  const prevCount = useRef(0);
  useEffect(() => {
    if (alerts.length !== prevCount.current) {
      if (alerts.length > prevCount.current) setDismissed(false);
      prevCount.current = alerts.length;
    }
  }, [alerts.length]);

  if (!holdsMenungai) return null;
  if (status !== "ok") return null;
  if (alerts.length === 0) return null;
  if (dismissed) return null;

  const critical = alerts.filter((a) => a.severity === "critical");
  const top = critical[0] ?? alerts[0];
  const tone = critical.length > 0 ? "critical" : "warning";

  const open = () => {
    setDesktopActiveTab("alerts");
    requestIdleView();
    setDismissed(true);
  };

  return (
    <div className={`iab iab--${tone}`} role="alert" aria-live="polite">
      <span className="iab__mark" aria-hidden="true">
        <i className={`ti ${tone === "critical" ? "ti-alert-triangle" : "ti-clock"}`} />
      </span>
      <div className="iab__body">
        <b className="iab__title">
          {alerts.length === 1
            ? `${top.plate} idle ${idleDuration(top.durationMs)}`
            : `${alerts.length} units idle — longest ${idleDuration(top.durationMs)}`}
        </b>
        <span className="iab__sub">
          {critical.length > 0
            ? `${critical.length} critical (6+ h)`
            : `All warning (3–6 h)`}
          {" · "}{top.plate}
        </span>
      </div>
      <div className="iab__acts">
        <CopyBtn text={alertCopyText(top)} />
        <button type="button" className="iab__open" onClick={open}>Open</button>
        <button type="button" className="iab__x" aria-label="Dismiss this badge" onClick={() => setDismissed(true)}>✕</button>
      </div>
    </div>
  );
}
