/*
 * The Ops Room Operator's weighbridge pop-ups (operator, 2026-11-25), mounted
 * once for the whole app; nothing runs for anyone else (lib/opsRoomAlerts
 * wantsOpsRoomAlerts, and the weighbridges right).
 *
 * Every CHECK_MS, for the organisation open: today's weighings (fleet-server
 * weighments/recent). Each new one is a pop-up in the corner, the same stack as
 * Menengai's stops (lib/toasts), and a unit's second or later ticket of the day
 * is a card that stays until acknowledged (in this browser only). The gate had
 * pop-ups too for a few hours; taken out the same day (operator: "no need for
 * alerts when units sign in and out, they are many").
 * The first read that WORKS only notes what is already
 * there: no flood of the morning's events on opening the page (a failed first
 * read used to count as noted, and the next one then showed two hours of old
 * weighings; 2026-11-25). Only events of the last hour pop up (lib/opsRoomAlerts
 * MAX_AGE_MS). Unacknowledged tickets of the day do show.
 * No sound.
 */

import { useEffect, useRef, useState } from "react";
import { usePermissions } from "../../hooks/usePermissions";
import { useFleetLiveShared } from "../../context/FleetLiveContext";
import { getRecentWeighings } from "../../api/gateLog";
import { fleetDay } from "../../lib/alertsView";
import { addToast } from "../../lib/toasts";
import { requestRow } from "../../lib/rowFocus";
import { useAppActions } from "../../context/AppContext";
import { CHECK_MS, wantsOpsRoomAlerts, weighingToast, secondTickets, fresh, readAcks, writeAck, isRecent } from "../../lib/opsRoomAlerts";
import "./ToastStack.css";

/** Weighings can be saved a little after they happened: each read looks back this far, and repeats are dropped by id. */
const WEIGHING_LOOK_BACK_MS = 2 * 3_600_000;
/** Cards drawn at once; the rest wait behind, counted. */
const SHOWN = 3;

export default function OpsRoomAlerts() {
  const { can } = usePermissions();
  const { orgId } = useFleetLiveShared();
  // Weighbridges only: the gate pop-ups were taken out (operator, 2026-11-25:
  // "no need for alerts when units sign in and out, they are many").
  const on = Boolean(orgId) && wantsOpsRoomAlerts(can) && can("weighbridge:read");
  const [sticky, setSticky] = useState([]);
  const [acks, setAcks] = useState(() => readAcks());
  const state = useRef(null);
  const { setDesktopActiveTab } = useAppActions();

  useEffect(() => {
    setSticky([]);
    if (!on) return undefined;
    let live = true;
    let timer = null;
    const blank = () => ({ day: fleetDay(), wbNoted: false, seenWb: new Set(), tickets: new Map() });
    state.current = blank();

    const check = async () => {
      const s = state.current;
      const today = fleetDay();
      if (s.day !== today) Object.assign(s, blank());
      const now = Date.now();
      const toasts = [];
      {
        try {
          const since = s.wbNoted ? new Date(now - WEIGHING_LOOK_BACK_MS).toISOString() : null;
          const res = await getRecentWeighings({ orgId, since });
          if (!live) return;
          const all = res.weighings ?? [];
          const news = fresh(all, s.seenWb);
          if (s.wbNoted) toasts.push(...news.filter((w) => isRecent(w.at, now)).map(weighingToast));
          s.wbNoted = true;
          for (const a of secondTickets(all)) s.tickets.set(a.id, a);
          setSticky([...s.tickets.values()].sort((a, b) => Date.parse(a.at) - Date.parse(b.at)));
        } catch { /* the next read tries again */ }
      }
      // Oldest first, so the newest ends up in front of the stack.
      toasts.sort((a, b) => Date.parse(a.at) - Date.parse(b.at)).forEach((t) => addToast(t));
      if (live) timer = setTimeout(check, CHECK_MS);
    };
    check();
    return () => { live = false; clearTimeout(timer); };
  }, [on, orgId]);

  const waiting = sticky.filter((a) => !acks[a.id]);
  if (!on || waiting.length === 0) return null;
  const shown = waiting.slice(-SHOWN).reverse();
  return (
    <div className="tst-stack tst-stack--page ops-sticky" role="region" aria-label="Alerts to acknowledge">
      {waiting.length > SHOWN && <p className="ops-sticky__more">{waiting.length - SHOWN} more to acknowledge</p>}
      {shown.map((a) => (
        <div key={a.id} className="tst tst--warning" role="alert">
          <span className="tst__mark" aria-hidden="true"><i className="ti ti-scale" /></span>
          <div className="tst__text">
            <button type="button" className="tst__text tst__text--go" title="Show this ticket"
                    onClick={() => { setDesktopActiveTab("weighbridges"); requestRow("weighbridges", a.ticketId); }}>
              <b>{a.title}</b>
              <span>{a.body}</span>
            </button>
            <div className="tst__acts">
              <button type="button" className="tst__open" onClick={() => setAcks(writeAck(a.id))}>Acknowledge</button>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
