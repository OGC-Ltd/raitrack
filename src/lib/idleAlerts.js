// Menengai's idle units, as the server's idle watch reports them (fleet-server
// modules/idle-watch): a listed unit that has not moved for 1 h 30 min of
// working time (07:30–19:30), wherever it stands, the yard and depots included,
// critical at 6 hours.
// The server decides once for everybody; this file only words and filters
// what it sends. Pure: no React.

const EAT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Nairobi', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "11 Nov 09:40", Nairobi; "—" for nothing. */
export const eatWords = (ms) => (Number.isFinite(ms) ? EAT.format(ms).replace(/,/g, '') : '—');

/** "3 h 05 min", "1 d 4 h", "42 min" (fleet-server idle-watch.rules idleWords). */
export function idleWords(ms) {
  const min = Math.max(0, Math.floor((Number(ms) || 0) / 60_000));
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  if (d) return `${d} d ${h} h`;
  if (!h) return `${min} min`;
  return min % 60 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${h} h`;
}

/** Where it stands: "at Naivas HQ", "1.2 km from Naivas HQ", else its coordinates. */
export function whereWords(a) {
  const n = a?.nearest;
  if (n?.name) {
    if (!(n.metres > 0)) return `at ${n.name}`;
    return `${n.metres < 1000 ? `${n.metres} m` : `${(n.metres / 1000).toFixed(1)} km`} from ${n.name}`;
  }
  return Number.isFinite(a?.lat) && Number.isFinite(a?.lng) ? `${a.lat.toFixed(5)}, ${a.lng.toFixed(5)}` : '—';
}

export const mapUrl = (a) => (Number.isFinite(a?.lat) && Number.isFinite(a?.lng) ? `https://www.google.com/maps?q=${a.lat},${a.lng}` : null);

/** The alert as text to paste into a message. */
export function alertText(a) {
  const lines = [
    `Idle unit — ${a.plate} (${a.size} · ${a.designation})`,
    `Stopped since: ${eatWords(a.since)}${a.sinceExact === false ? ' (at least)' : ''}`,
    `Idle in working hours: ${idleWords(a.idleMs)}${a.severity === 'critical' ? ' (critical)' : ''}`,
    `Where: ${whereWords(a)}`,
  ];
  const url = mapUrl(a);
  if (url) lines.push(`Map: ${url}`);
  return lines.join('\n');
}

const squash = (x) => String(x ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** The alerts a search keeps: by plate, size, designation or place. */
export function searchAlerts(alerts, q) {
  const s = squash(q);
  if (!s) return alerts;
  return alerts.filter((a) => [a.plate, a.size, a.designation, a.nearest?.name].some((x) => squash(x).includes(s)));
}

/**
 * Dismissed keys still worth keeping: those of alerts the server still sends.
 * A key names one stop (`vehicleId|idle|since`), so once that stop ends it
 * can never come back, and keeping it would only grow the store.
 */
export const liveDismissals = (dismissed, alerts) => {
  const live = new Set((alerts ?? []).map((a) => a.key));
  return new Set([...dismissed].filter((k) => live.has(k)));
};
