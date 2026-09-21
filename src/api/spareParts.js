// The parts a sensor fault can be waiting on.
//
// ## This is a CATALOGUE, not an inventory
//
// Nothing in this system knows what is on a shelf. There is no stock table, no
// supplier, no quantity, and this file invents none of them — every entry is a
// part TYPE, and picking one says "this unit needs one of these", never "there
// is one in the store". If a real inventory arrives, `listSpareParts()` below
// becomes a fetch and every caller keeps working, which is the whole reason
// the lookup is a function rather than the bare array.
//
// ## Why it is keyed on channels
//
// The ids in `channels` are ProbeHealthPanel's own (its CHANNELS list, the one
// already driving the filter bar) — deliberately not a second vocabulary for
// the same hardware. A technician reporting a dead unit has a failing channel
// in front of them, so the form can put the five plausible parts at the top of
// the list instead of asking them to read thirty.
//
// The scoping is a SORT, never a filter: every part stays reachable under
// "Other sensor parts", because the diagnosis that a GPS fault needs a GPS
// antenna is the technician's to make, not this file's.

/**
 * @typedef  {object} SparePart
 * @property {string}   id        Stable key. Not sent anywhere — see `name`.
 * @property {string}   name      What travels to the server and into the email.
 * @property {string[]} channels  ProbeHealthPanel channel ids this part serves.
 */

/**
 * The sentinel the dropdown adds beneath the real parts.
 *
 * Exported rather than typed as a literal at the two places that test for it,
 * so a part can never be named "__other__" by accident and disappear.
 */
export const OTHER_PART = "__other__";

/** @type {SparePart[]} */
const CATALOGUE = [
  // ── The tracker itself ────────────────────────────────────────────────────
  // A silent unit is upstream of every other channel, so these come first in
  // the file for the same reason "Tracker" is the first named channel.
  { id: "tracker-unit",     name: "Tracker unit (replacement)",     channels: ["tracker"] },
  { id: "tracker-harness",  name: "Tracker power harness",          channels: ["tracker"] },
  { id: "backup-battery",   name: "Tracker backup battery",         channels: ["tracker"] },
  { id: "sim",              name: "SIM card",                       channels: ["tracker"] },
  { id: "gsm-antenna",      name: "GSM antenna",                    channels: ["tracker"] },

  // ── Position ──────────────────────────────────────────────────────────────
  { id: "gps-antenna",      name: "GPS antenna",                    channels: ["gps", "tracker"] },
  { id: "gps-cable",        name: "GPS antenna cable",              channels: ["gps"] },

  // ── Fuel ──────────────────────────────────────────────────────────────────
  // Both sensing technologies are listed because the fleet runs both, and the
  // panel cannot tell them apart from telemetry — the technician at the tank
  // can.
  { id: "fuel-probe",       name: "Capacitive fuel probe",          channels: ["fuelProbe", "fuelSensor"] },
  { id: "float-sender",     name: "Float level sender",             channels: ["fuelProbe", "fuelSensor"] },
  { id: "probe-harness",    name: "Fuel probe harness",             channels: ["fuelProbe", "fuelSensor"] },
  { id: "probe-gasket",     name: "Probe tank-flange gasket",       channels: ["fuelProbe"] },
  { id: "probe-adapter",    name: "Probe head adapter",             channels: ["fuelProbe"] },

  // ── Engine state ──────────────────────────────────────────────────────────
  { id: "ignition-wire",    name: "Ignition sense wire",            channels: ["ignition"] },
  { id: "ignition-relay",   name: "Ignition relay",                 channels: ["ignition"] },

  // ── Counters ──────────────────────────────────────────────────────────────
  { id: "odo-sensor",       name: "Odometer pulse sensor",          channels: ["odometer", "engineHours"] },
  { id: "can-reader",       name: "CAN bus reader",                 channels: ["odometer", "engineHours"] },
  { id: "can-harness",      name: "CAN adapter harness",            channels: ["odometer", "engineHours"] },

  // ── Fits anything ─────────────────────────────────────────────────────────
  // No `channels`, so these never surface as "likely" and always sit in the
  // second group. They are what a harness repair actually consumes, and a
  // technician who cannot find them types them out every single time.
  { id: "connector-kit",    name: "Waterproof connector kit",       channels: [] },
  { id: "cable-gland",      name: "Cable gland",                    channels: [] },
  { id: "loom",             name: "Wiring loom (1 m)",              channels: [] },
  { id: "fuse-holder",      name: "Inline fuse holder",             channels: [] },
  { id: "bracket",          name: "Mounting bracket",               channels: [] },
];

/**
 * Every part, in catalogue order.
 *
 * The seam a real inventory would replace. Callers treat it as data they were
 * given, not as a constant they can index into.
 *
 * @returns {SparePart[]}
 */
export function listSpareParts() {
  return CATALOGUE;
}

/**
 * Split the catalogue into what this unit probably needs and everything else.
 *
 * Both groups are returned because BOTH are rendered — as two `<optgroup>`s in
 * one select. A part promoted into `likely` is not removed from the catalogue,
 * it is moved, so the list a technician scans is always the same length and
 * nothing they reached for last week has gone missing.
 *
 * With no channels (a row whose fault the panel could not attribute, or a
 * Malfunction-tab episode) `likely` is empty and the caller renders one
 * ungrouped list — which is the honest thing to show when there is nothing to
 * rank by.
 *
 * @param   {string[]} [channels] ProbeHealthPanel channel ids failing on this unit.
 * @returns {{ likely: SparePart[], others: SparePart[] }}
 */
export function sparesFor(channels) {
  const want = new Set(channels ?? []);
  if (want.size === 0) return { likely: [], others: CATALOGUE };

  const likely = [];
  const others = [];
  for (const part of CATALOGUE) {
    (part.channels.some((c) => want.has(c)) ? likely : others).push(part);
  }
  return { likely, others };
}
