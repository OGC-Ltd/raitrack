/**
 * Menengai's idle units: the runner and the corner badge.
 *
 * The server decides which listed units are idle (fleet-server
 * modules/idle-watch: 3 hours of working time, 07:30–19:30, away from the yard
 * and depots), once for everybody. While Menengai is on the account, this
 * reads that list every CHECK_MS into the shared store (hooks/useIdleWatch),
 * as StopWatch reads the stop watch. The badge shows only while Menengai is
 * the company open; "Open" lands on the Alerts page's Idle units list.
 */

import { useEffect, useRef, useState } from "react";
import { useAppActions, useAppSelector, useCompanies } from "../../context/AppContext";
import { resolveOrgId } from "../../api/org";
import { apiFetch } from "../../services/api";
import { copyText } from "../../lib/copyText";
import { alertText, idleWords } from "../../lib/idleAlerts";
import { requestIdleView, setIdleWatch, useIdleWatch } from "../../hooks/useIdleWatch";
import "./IdleAlertBadge.css";

export const CHECK_MS = 60_000;
const ORG = "menengai";

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

/** Reads the server's list while Menengai is on the account; nothing runs otherwise. */
function useIdleRunner(holds) {
  useEffect(() => {
    if (!holds) { setIdleWatch({ status: "off", alerts: [], notReporting: [], notOnPlatform: [] }); return undefined; }
    let live = true;
    let timer = null;
    const check = async () => {
      try {
        const orgId = await resolveOrgId(ORG);
        if (!orgId) throw new Error("Menengai is not on this account");
        const { data } = await apiFetch(`/api/v1/organisations/${orgId}/idle-watch`);
        if (!live) return;
        const status = data?.status === "error" ? "error" : data?.status === "loading" ? "loading" : data?.status === "off" ? "off" : "done";
        setIdleWatch({
          status,
          alerts: Array.isArray(data?.alerts) ? data.alerts : [],
          notReporting: Array.isArray(data?.notReporting) ? data.notReporting : [],
          notOnPlatform: Array.isArray(data?.notOnPlatform) ? data.notOnPlatform : [],
          rule: data?.rule ?? null,
          checkedAt: data?.checkedAt ?? Date.now(),
          message: data?.message ?? null,
        });
      } catch (err) {
        if (!live) return;
        // Not on this server yet: no list, no badge, and nothing to report
        if (err?.status === 404) setIdleWatch({ status: "off", alerts: [] });
        else setIdleWatch({ status: "error", message: err?.message ?? String(err), checkedAt: Date.now() });
      } finally {
        if (live) timer = setTimeout(check, CHECK_MS);
      }
    };
    setIdleWatch({ status: "loading" });
    check();
    return () => { live = false; clearTimeout(timer); };
  }, [holds]);
}

export default function IdleAlertBadge() {
  const { companies } = useCompanies();
  const holds = companies.some((c) => c.id === ORG);
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { setDesktopActiveTab } = useAppActions();
  useIdleRunner(holds);
  const watch = useIdleWatch();
  const alerts = watch.alerts.filter((a) => !watch.dismissed.has(a.key));
  const [hidden, setHidden] = useState(false);

  // A new idle unit brings the badge back after it was closed
  const prevCount = useRef(0);
  useEffect(() => {
    if (alerts.length > prevCount.current) setHidden(false);
    prevCount.current = alerts.length;
  }, [alerts.length]);

  if (activeCompanyId !== ORG || watch.status !== "done" || !alerts.length || hidden) return null;

  const critical = alerts.filter((a) => a.severity === "critical");
  const top = critical[0] ?? alerts[0];
  const tone = critical.length ? "critical" : "warning";
  const open = () => {
    setDesktopActiveTab("alerts");
    requestIdleView();
    setHidden(true);
  };

  return (
    <div className={`iab iab--${tone}`} role="status" aria-live="polite">
      <span className="iab__mark" aria-hidden="true">
        <i className={`ti ${tone === "critical" ? "ti-alert-triangle" : "ti-clock"}`} />
      </span>
      <div className="iab__body">
        <b className="iab__title">
          {alerts.length === 1
            ? `${top.plate} idle ${idleWords(top.idleMs)}`
            : `${alerts.length} units idle, longest ${idleWords(alerts[0].idleMs)}`}
        </b>
        <span className="iab__sub">
          {critical.length ? `${critical.length} critical, idle 6 h or more` : "Idle 3 to 6 h"} in working hours · {top.plate}
        </span>
      </div>
      <div className="iab__acts">
        <CopyBtn text={alertText(top)} />
        <button type="button" className="iab__open" onClick={open}>Open</button>
        <button type="button" className="iab__x" aria-label="Close this badge" onClick={() => setHidden(true)}>✕</button>
      </div>
    </div>
  );
}
