// Where each unit stands with the workshop, for the live map (operator,
// 2026-11-21: "update the status of the unit when they are booked in to auto
// workshop, when they are in auto workshop, when they are being fixed, and the
// nature of the fix, if it's engine etc").
//
// Read from the open repair jobs, the same list the Workshop's Jobs tab shows:
// each job carries its stage, its fault category and its FactorySuite card(s).
// One read shared by every reader on the page (the units list and the unit
// panel), again every two minutes and whenever a repair changes. Only for a
// role with repair:read; anyone else gets an empty map and no request.

import { useEffect, useState } from "react";
import { useFleetLiveShared } from "../context/FleetLiveContext";
import { usePermissions } from "./usePermissions";
import { listWorkflowJobs, CATEGORY_LABEL, shortCard } from "../api/repairWorkflow";
import { REPAIRS_CHANGED } from "../api/repairs";

const EVERY_MS = 2 * 60_000;

/** The card a job is being worked under now: the latest not released or cancelled. */
const liveCard = (job) =>
  [...(job?.fsJobCards ?? [])].reverse().find((c) => c.status !== "RELEASED" && c.status !== "CANCELLED") ?? null;

/**
 * A job's place in the workshop, or null when it is not there yet (flagged,
 * in assessment, with ControlTech) or is closed.
 *   booked   booked in, not arrived
 *   in       in the workshop, work not started
 *   fixing   being repaired
 *   parts    waiting on parts
 *   done     work done, waiting to be released or verified
 */
export function workshopStateOf(job) {
  if (!job || job.resolvedAt) return null;
  const card = liveCard(job);
  if (card) {
    if (card.status === "COMPLETED") return "done";
    if (card.status === "AWAITING_PARTS") return "parts";
    if (card.status === "IN_PROGRESS" || card.repairStartedAt) return "fixing";
    return "in";
  }
  switch (job.stage) {
    case "booked": case "towing": return "booked";
    case "in_workshop": case "field_inspection": return "in";
    case "fixing": return "fixing";
    case "completed": return "done";
    default: return null;
  }
}

export const WORKSHOP_STATE = {
  booked: { label: "Booked in", tone: "booked" },
  in:     { label: "In workshop", tone: "in" },
  fixing: { label: "Being fixed", tone: "fixing" },
  parts:  { label: "Awaiting parts", tone: "parts" },
  done:   { label: "Work done", tone: "done" },
};

/** One unit's workshop line: the state, what is being fixed, the card and since when. */
export function workshopUnitOf(job) {
  const state = workshopStateOf(job);
  if (!state) return null;
  const card = liveCard(job);
  return {
    state,
    ...WORKSHOP_STATE[state],
    // The nature of the fix: the job's fault category (Engine, Hydraulics,
    // Brakes…), and what was reported under it.
    fix: CATEGORY_LABEL[job.faultCategory] ?? null,
    detail: job.suspectedFault ?? job.problemNote ?? null,
    card: card ? shortCard(card.cardNumber) : null,
    major: card?.category === "MAJOR",
    since: card?.checkedInAt ?? job.stageChangedAt ?? null,
    jobId: job.id,
  };
}

// The shared read: one per organisation, whoever asks.
const store = { orgId: null, byVehicle: new Map(), at: 0, pending: null, subs: new Set() };

function read(orgId) {
  if (store.pending && store.orgId === orgId) return store.pending;
  store.orgId = orgId;
  store.pending = listWorkflowJobs(orgId, { status: "open" })
    .then((jobs) => {
      if (store.orgId !== orgId) return;
      const m = new Map();
      // Newest first wins: the jobs come oldest first, so later ones replace.
      for (const j of jobs) {
        const u = workshopUnitOf(j);
        if (u && j.vehicleId) m.set(j.vehicleId, u);
      }
      store.byVehicle = m;
      store.at = Date.now();
      store.subs.forEach((f) => f(m));
    })
    .catch(() => {})
    .finally(() => { store.pending = null; });
  return store.pending;
}

/** vehicleId -> its workshop line, for the units in the workshop now. */
export function useWorkshopUnits() {
  const { orgId } = useFleetLiveShared();
  const { can } = usePermissions();
  const allowed = !!orgId && can("repair:read");
  const [byVehicle, setByVehicle] = useState(() => (allowed && store.orgId === orgId ? store.byVehicle : new Map()));

  useEffect(() => {
    if (!allowed) { setByVehicle(new Map()); return undefined; }
    store.subs.add(setByVehicle);
    if (store.orgId !== orgId || Date.now() - store.at > EVERY_MS) read(orgId);
    else setByVehicle(store.byVehicle);
    const again = () => read(orgId);
    const timer = setInterval(again, EVERY_MS);
    window.addEventListener(REPAIRS_CHANGED, again);
    return () => {
      store.subs.delete(setByVehicle);
      clearInterval(timer);
      window.removeEventListener(REPAIRS_CHANGED, again);
    };
  }, [allowed, orgId]);

  return byVehicle;
}
