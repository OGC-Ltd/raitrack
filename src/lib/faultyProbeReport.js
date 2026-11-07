// Faulty Probe Report (operator, 7 Nov 2026): the Probes tab's report, laid out
// as West Kenya's sheet WSK TRUCKS FAULTY PROBE REPORT: each unit's
// registration and one comment in the sheet's own words. The rows are the
// Probes tab's (api/probeHealth); this decides the comment.
//
// Pure: no React, no network.

/** The sheet's comments, in report order: the cause before the symptom. */
export const COMMENTS = [
  { key: 'notUpdating', word: 'NOT UPDATING', label: 'Not updating' },
  { key: 'probeFailure', word: 'PROBE FAILURE', label: 'Probe failure' },
  { key: 'probeIssue', word: 'PROBE ISSUE', label: 'Probe issue' },
  { key: 'gpsMileage', word: 'GPS MILEAGE FAILURE', label: 'GPS mileage failure' },
  { key: 'ignition', word: 'IGNITION FAILURE', label: 'Ignition failure' },
  { key: 'engineHours', word: 'ENGINE HOURS FAILURE', label: 'Engine hours failure' },
  { key: 'noFls', word: 'NO FLS', label: 'No FLS' },
];
const BY_KEY = new Map(COMMENTS.map((c, i) => [c.key, { ...c, order: i }]));

export const HEADS = ['Registration No', 'Comment'];

const quiet = (r, ch) => r.channels?.[ch]?.state === 'NOT_REPORTING';

/**
 * The sheet's comment for a unit, or null when nothing on it is wrong. One per
 * unit, the first that applies, in the order faultAction (api/probeHealth)
 * diagnoses: a tracker that says nothing makes every other channel unjudgeable,
 * and a missing calibration table is why a fitted probe reads no level.
 */
export function faultKey(r) {
  const probe = r.fuelProbe?.state;
  if (r.trackerSilent || probe === 'UNKNOWN') return 'notUpdating';
  if (r.fuelSensor?.uncalibrated) return 'probeIssue';
  if (probe === 'DIED' || probe === 'SILENT') return 'probeFailure';
  if (quiet(r, 'gps') || quiet(r, 'odometer')) return 'gpsMileage';
  if (quiet(r, 'ignition')) return 'ignition';
  if (quiet(r, 'engineHours')) return 'engineHours';
  if (probe === 'NOT_FITTED' && !r.fuelSensor?.fitted) return 'noFls';
  return null;
}

export const commentWord = (key) => BY_KEY.get(key)?.word ?? '';

/** The units with a comment, `{ plate, key, comment }`, by comment then registration. */
export function faultyRows(rows) {
  return rows
    .map((r) => ({ r, key: faultKey(r) }))
    .filter((x) => x.key)
    .map(({ r, key }) => ({ vehicleId: r.vehicleId, plate: r.plate || r.name || '', key, comment: commentWord(key) }))
    .sort((a, b) => BY_KEY.get(a.key).order - BY_KEY.get(b.key).order || a.plate.localeCompare(b.plate, 'en', { numeric: true }));
}

/** How many units have each comment, in report order; the comments nobody has are left out. */
export function commentCounts(faulty) {
  const n = new Map();
  for (const f of faulty) n.set(f.key, (n.get(f.key) ?? 0) + 1);
  return COMMENTS.filter((c) => n.has(c.key)).map((c) => ({ ...c, count: n.get(c.key) }));
}

export const rowCells = (f) => [f.plate, f.comment];
