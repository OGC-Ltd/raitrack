// A driver's compliance, for the Drivers panel (operator, 4 Nov 2026: in place
// of the live gauges, "Compliance, list things like harsh accelerations, harsh
// braking, overspeeding, on phone, no seatbelt, freewheeling and other breaches
// that are in our reports").
//
// Two sources, each over the days it holds:
//   · the driver's own figures (analytics/drivers/overview): overspeeding,
//     harsh acceleration and harsh braking, over the panel's window (90 days);
//   · the dashcams, which the camera server keeps for 7 days only until the
//     platform keeps them itself (operator: "the dashcams we will persist
//     later"): on phone, no seatbelt and free-wheeling as the Driver Scorecard
//     credits them to the driver who held the vehicle, and camera covered on
//     the driver's vehicle.
//
// Pure: no React, no network.

import { COVER_CODES } from './fleetReports';
import { plateIn } from './plate';

/** The camera server's reach, days: the dashcam breaches cover no more. */
export const DASHCAM_DAYS = 7;

export const ITEMS = [
  { key: 'overspeed', label: 'Overspeeding', source: 'driver' },
  { key: 'accel', label: 'Harsh acceleration', source: 'driver' },
  { key: 'brake', label: 'Harsh braking', source: 'driver' },
  { key: 'phone', label: 'On phone', source: 'dashcam' },
  { key: 'seatbelt', label: 'No seatbelt', source: 'dashcam' },
  { key: 'freewheel', label: 'Free-wheeling', source: 'dashcam' },
  { key: 'covered', label: 'Camera covered', source: 'dashcam' },
];

const compact = (s) => String(s ?? '').replace(/[^A-Z0-9]/gi, '').toUpperCase();

/** The scorecard line for this driver: by id, else by name. */
export function scoreFor(scores, driver) {
  const list = scores?.drivers ?? [];
  return list.find((s) => s.driverId === driver?.id)
    ?? list.find((s) => compact(s.name) && compact(s.name) === compact(driver?.fullName))
    ?? null;
}

/** Camera-covered alarms on the driver's vehicle (its plate). */
export function coveredOn(alarms, vehicle) {
  const plate = compact(plateIn(vehicle, vehicle) ?? vehicle);
  if (!plate) return 0;
  return (alarms ?? []).filter((a) => COVER_CODES.has(Number(a.code)) && compact(plateIn(a.plate, a.plate) ?? a.plate).includes(plate)).length;
}

/**
 * The tiles: each breach, its count (null: not read), and the days it covers.
 * @param {object} totals   the driver's figures (overview detail.totals)
 * @param {object} dash     { status: 'idle'|'loading'|'done'|'error', scores, alarms, cameras }
 * @param {{ driver: object, vehicle: string, windowDays: number }} o
 */
export function complianceTiles(totals, dash, { driver, vehicle, windowDays = 90 }) {
  const score = dash?.status === 'done' ? scoreFor(dash.scores, driver) : null;
  const read = dash?.status === 'done';
  const noCameras = read && dash.cameras === 0;
  return ITEMS.map((it) => {
    if (it.source === 'driver') {
      const n = it.key === 'overspeed' ? totals?.overspeedingCases
        : it.key === 'accel' ? totals?.harshAccelerationCases : totals?.harshBrakingCases;
      return { ...it, count: Number.isFinite(n) ? n : null, days: windowDays };
    }
    if (!read || noCameras) return { ...it, count: null, days: DASHCAM_DAYS, why: noCameras ? 'No dashcams' : dash?.status === 'error' ? 'Not read' : 'Reading…' };
    if (it.key === 'covered') return { ...it, count: coveredOn(dash.alarms, vehicle), days: DASHCAM_DAYS };
    // No line of theirs on the scorecard says nothing of what they did: not a clean sheet
    if (!score) return { ...it, count: null, days: DASHCAM_DAYS, why: 'Not on the scorecard' };
    return { ...it, count: score.violations?.[it.key] ?? 0, days: DASHCAM_DAYS };
  });
}

/**
 * How many breaches, from the tiles that were read. "Compliant" only when every
 * tile was: what could not be read is not a clean sheet.
 */
export function complianceWords(tiles) {
  const unread = tiles.filter((t) => t.count == null);
  const n = tiles.reduce((s, t) => s + (t.count ?? 0), 0);
  if (n > 0) return { total: n, words: `${n.toLocaleString('en-GB')} breach${n === 1 ? '' : 'es'}`, tone: 'crit' };
  if (!unread.length) return { total: 0, words: 'Compliant: no breaches', tone: 'ok' };
  return { total: 0, words: unread.some((t) => t.why === 'Reading…') ? 'Reading dashcams…' : 'No breaches in what was read', tone: 'na' };
}
