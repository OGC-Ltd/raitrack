// The Vehicle Support and Repair Workflow (fleet-server repairs.workflow).
//
// A faulty unit, from the Control Room's flag to the Control Room's
// verification. The job is the same repair job Maintenance > Repairs and
// Fuel > Audit show; these are the routes that walk it through the workflow.
// Every write announces itself on REPAIRS_CHANGED, like api/repairs.

import { apiFetch } from "../services/api";
import { repairsChanged } from "./repairs";

const base = (orgId) => `/api/v1/organisations/${orgId}/repairs`;

async function get(url) {
  const res = await apiFetch(url);
  return res?.data ?? null;
}
async function post(url, body = {}) {
  const res = await apiFetch(url, { method: "POST", body: JSON.stringify(body) });
  repairsChanged();
  return res?.data ?? null;
}
/** Drop empty strings, so an untouched optional field is not sent as "". */
function clean(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== "" && v != null && !(typeof v === "string" && !v.trim()))
    .map(([k, v]) => [k, typeof v === "string" ? v.trim() : v]));
}

// ── Vocabulary (server: repairs.workflow.schema; Postgres CHECKs) ─────────

export const CATEGORY_GROUPS = [
  ["Telematics", [["fuel_probe", "Fuel probe"], ["tracker", "Tracker"], ["sensor", "Sensor"]]],
  ["Mechanical", [
    ["engine", "Engine"], ["transmission", "Transmission"], ["brakes", "Brakes"],
    ["suspension_steering", "Suspension and steering"], ["tyres", "Tyres"],
    ["electrical", "Electrical"], ["hydraulics", "Hydraulics"], ["body", "Body"],
  ]],
  ["Other", [["other", "Other"]]],
];
export const CATEGORY_LABEL = Object.fromEntries(CATEGORY_GROUPS.flatMap(([, list]) => list));
export const TELEMATICS = new Set(["fuel_probe", "tracker", "sensor"]);

/** Where a flag goes, said before it is sent. */
export function routeOf(category, chosenQueue) {
  if (TELEMATICS.has(category)) return "controltech";
  if (category === "other") return chosenQueue ?? "workshop";
  return "workshop";
}

export const COMPONENT_LABEL = {
  probe: "Fuel probe", probe_cable: "Probe cable and connector", tank_bracket: "Tank and bracket",
  tracker: "Tracker", calibration: "Calibration", antenna: "Antenna", power_feed: "Power feed", sim: "SIM",
  wiring: "Wiring", sensor: "Sensor", connector: "Connector", engine: "Engine", cooling: "Cooling",
  fuel_system: "Fuel system", air_intake: "Air intake", exhaust: "Exhaust", gearbox: "Gearbox",
  clutch: "Clutch", driveshaft: "Driveshaft", differential: "Differential", pads_shoes: "Pads and shoes",
  discs_drums: "Discs and drums", air_hydraulic_lines: "Air and hydraulic lines", handbrake: "Handbrake",
  springs: "Springs", shocks: "Shocks", steering_box: "Steering box", linkages: "Linkages", tyres: "Tyres",
  wheels: "Wheels", hubs_bearings: "Hubs and bearings", battery: "Battery", alternator: "Alternator",
  starter: "Starter", lighting: "Lighting", pump: "Pump", rams: "Rams", hoses: "Hoses", valves: "Valves",
  cab: "Cab", body_panels: "Body panels", glass: "Glass", trailer_coupling: "Trailer coupling",
};
export const componentLabel = (c) => COMPONENT_LABEL[c] ?? String(c ?? "").replace(/_/g, " ");

/**
 * The six phases the workflow reads as, in order. Each stage belongs to one.
 * The ladder in the job panel draws these, not the fourteen stages.
 */
export const PHASES = [
  ["flag",     "Flagged"],
  ["triage",   "Triage"],
  ["assess",   "Assessment"],
  ["workshop", "Workshop"],
  ["repair",   "Repair"],
  ["verify",   "Verification"],
];
export const PHASE_OF_STAGE = {
  pending: "flag", forwarded: "triage", remote_fix: "repair", awaiting_assessment: "assess",
  booked: "workshop", towing: "workshop", field_inspection: "repair", in_workshop: "workshop",
  spare_outsourced: "repair", fixing: "repair", completed: "verify", fixed: "verify", failed: "verify", void: "verify",
};

/** Who acts next, and what, for each stage: the head of the job panel. */
export const NEXT_STEP = {
  pending:             { who: "Control Room", what: "Forward the job" },
  forwarded:           { who: "ControlTech",  what: "Claim the job and decide remote or physical" },
  remote_fix:          { who: "ControlTech",  what: "Fix it remotely, then test and complete" },
  awaiting_assessment: { who: "Control Room", what: "Assess whether it can reach the workshop" },
  booked:              { who: "Workshop",     what: "Check the unit in when it arrives" },
  towing:              { who: "Workshop",     what: "Check the unit in when the tow arrives" },
  field_inspection:    { who: "Technician",   what: "Inspect on site and classify the damage" },
  in_workshop:         { who: "Technician",   what: "Inspect and classify the damage" },
  spare_outsourced:    { who: "ControlTech",  what: "Source the missing parts" },
  fixing:              { who: "Technician",   what: "Repair, test and complete" },
  completed:           { who: "Control Room", what: "Verify the repair matches the work done" },
  fixed:               { who: null,           what: "Fixed and available" },
  failed:              { who: null,           what: "Signed off unsuccessful" },
  void:                { who: null,           what: "Void" },
};

export const PATH_LABEL = { remote: "Remote", physical: "Physical" };
export const INTERVENTION_LABEL = { workshop: "Drive to the workshop", tow: "Tow", field_inspection: "Inspect on site" };
export const DAMAGE_LABEL = { genuine: "Genuine", suspected_malicious: "Suspected malicious" };
export const INVESTIGATION_LABEL = {
  open: "Open", investigating: "Investigating", closed_confirmed: "Closed: confirmed", closed_unfounded: "Closed: unfounded",
};
export const INVESTIGATION_PILL = { open: "inc", investigating: "warn", closed_confirmed: "inc", closed_unfounded: "none" };
export const WORK_KIND_LABEL = { diagnosis: "Diagnosis", repair: "Repair", test: "Test", note: "Note" };
export const SERVICE_STATE_LABEL = {
  awaiting_repair: "Repair flagged", in_workshop: "In workshop", awaiting_verification: "Awaiting verification",
};

// ── Reads ──────────────────────────────────────────────────────────────────

export const listWorkflowJobs = (orgId, { status = "open", queue } = {}) => {
  const qs = new URLSearchParams({ status, limit: "200" });
  if (queue) qs.set("queue", queue);
  return get(`${base(orgId)}/items?${qs}`).then((d) => d ?? []);
};
export const fetchQueue          = (orgId) => get(`${base(orgId)}/queue`).then((d) => d ?? []);
export const fetchTicket         = (orgId, itemId) => get(`${base(orgId)}/items/${itemId}/ticket`);
export const fetchFlaggableUnits = (orgId) => get(`${base(orgId)}/flaggable-units`).then((d) => d ?? []);
export const fetchServiceStates  = (orgId) => get(`${base(orgId)}/service-states`).then((d) => d ?? []);
export const fetchWorkshops      = (orgId) => get(`${base(orgId)}/workshops`).then((d) => d ?? []);
export const fetchAvailability   = (orgId, workshopId, days = 14) => get(`${base(orgId)}/workshops/${workshopId}/availability?days=${days}`);
export const fetchWorkshopDay    = (orgId, workshopId, date) => get(`${base(orgId)}/workshops/${workshopId}/day?date=${date}`);
export const fetchInvestigations = (orgId, status = "open") => get(`${base(orgId)}/security-investigations?status=${status}`).then((d) => d ?? []);
export const fetchSecurityHolders = (orgId) => get(`${base(orgId)}/security-investigations/holders`).then((d) => d ?? []);
export const fetchAssignees      = (orgId) => get(`${base(orgId)}/assignees`).then((d) => d ?? []);

// ── Writes ─────────────────────────────────────────────────────────────────

const item = (orgId, id, what) => `${base(orgId)}/items/${id}/${what}`;

export const flagUnits = (orgId, { vehicleIds, faultCategory, suspectedFault, queue, forward = true }) =>
  post(`${base(orgId)}/flags`, clean({ vehicleIds, faultCategory, suspectedFault, queue, forward }));
export const forwardJob     = (orgId, id, queue) => post(item(orgId, id, "forward"), clean({ queue }));
export const claimJob       = (orgId, id) => post(item(orgId, id, "claim"));
export const decidePath     = (orgId, id, path, note) => post(item(orgId, id, "path"), clean({ path, note }));
export const assessJob      = (orgId, id, a) => post(item(orgId, id, "assessment"), clean({
  roadworthy: a.roadworthy, intervention: a.intervention, reason: a.reason,
  detail: Object.keys(clean(a.detail ?? {})).length ? clean(a.detail) : undefined,
}));
export const bookJob        = (orgId, id, workshopId, date) => post(item(orgId, id, "booking"), { workshopId, date });
export const cancelBooking  = (orgId, id, reason) => post(item(orgId, id, "booking/cancel"), { reason: reason.trim() });
export const arriveJob      = (orgId, id) => post(item(orgId, id, "arrive"));
export const assignWorkshop = (orgId, id, { technicianId, name }) => post(item(orgId, id, "workshop-assign"), clean({ technicianId, name }));
export const classifyDamage = (orgId, id, d) => post(item(orgId, id, "damage"), clean(d));
export const voidWarranty   = (orgId, id, note, components) => post(item(orgId, id, "warranty-void"), { note: note.trim(), components });
export const clearWarranty  = (orgId, id, note) => post(item(orgId, id, "warranty-void/clear"), { note: note.trim() });
export const addWork        = (orgId, id, w) => post(item(orgId, id, "work"), clean(w));
export const completeJob    = (orgId, id, c) => post(item(orgId, id, "complete"), clean(c));
export const verifyJob      = (orgId, id, decision, note) => post(item(orgId, id, "verify"), clean({ decision, note }));
export const voidJob        = (orgId, id, reason) => post(item(orgId, id, "void"), { reason: reason.trim() });
export const requestPart    = (orgId, id, p) => post(item(orgId, id, "parts"), clean({
  name: p.name, quantity: Number(p.quantity) || 1, source: p.source, itemCode: p.itemCode, store: p.store, note: p.note,
}));
/** Fixed on the spot, nothing from stores: one completed, ticketed job per unit, waiting for verification. */
export const spotFix        = (orgId, f) => post(`${base(orgId)}/spot-fixes`, clean({
  vehicleIds: f.vehicleIds, faultCategory: f.faultCategory, suspectedFault: f.suspectedFault, fixNote: f.fixNote,
  testNote: f.testNote, labourMinutes: f.labourMinutes === "" ? undefined : Number(f.labourMinutes) || undefined,
  storePartTaken: f.storePartTaken,
}));
export const sourcePart     = (orgId, id, partId, s) => post(`${item(orgId, id, "parts")}/${partId}/source`, clean(s));
export const issuePart      = (orgId, id, partId, s) => post(`${item(orgId, id, "parts")}/${partId}/issue`, clean(s));
export const fitPart        = (orgId, id, partId) => post(`${item(orgId, id, "parts")}/${partId}`, { status: "fitted" });
/** An ordered part has arrived; the fix is planned for today, the workshop's (Nairobi) day. */
export const receivePart    = (orgId, id, partId) => post(`${item(orgId, id, "parts")}/${partId}`, { status: "received", fixDate: nairobiDay() });
const nairobiDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export const updateInvestigation = (orgId, invId, u) => post(`${base(orgId)}/security-investigations/${invId}`, clean(u));
export const updateWorkshop = (orgId, workshopId, w) => post(`${base(orgId)}/workshops/${workshopId}`, clean(w));

/** YYYY-MM-DD, the way the booking strip and the server name a day. */
export const isoDay = (d) => new Date(d).toISOString().slice(0, 10);

// ── Opening a job in Workshop from another screen ─────────────────────────
// The screen may not be mounted yet: the id waits here for it to take on
// mount, and a mounted screen hears the event.

export const WORKSHOP_OPEN = "workshop:open";
let handoff = null;
export function openInWorkshop(itemId) {
  handoff = itemId;
  window.dispatchEvent(new CustomEvent(WORKSHOP_OPEN, { detail: itemId }));
}
export function takeWorkshopHandoff() {
  const id = handoff;
  handoff = null;
  return id;
}
