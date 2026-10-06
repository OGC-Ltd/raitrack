// The vehicle panel's Alerts list, read for a person (operator, 28 Sep: "the
// alerts section, we need to reorganise, the UI looks very cluttered").
//
// The playback route hands over each alert as the notification text the server
// wrote: an upper-case headline, the unit's name, then the sentence —
//
//   "POSSIBLE THEFT — FUEL STILL MISSING: MUFINDI - CTR 07 lost 12.1 L while
//    parked with the engine off, and the level had not come back …"
//
// — and one loss arrives several times: the drain itself, the theft alert, the
// parked-fall call half an hour later and the follow-up hours after that. CTR
// 07's 21.3 L on 27 Sep was four rows of shouting in a panel already named
// CTR 07. Here each alert is split into what it is (a title, in sentence case),
// what it says (the sentence, without the unit's name) and the litres; the
// reports of one fuel loss are folded into one entry; and the list is grouped
// by fleet day.

import { fleetDayOf } from './fuelDay';

const SEVERITY_RANK = { info: 0, warning: 1, critical: 2 };

// An upper-case headline ending in a colon: "POSSIBLE THEFT — FUEL STILL MISSING:"
const HEADLINE = /^([A-Z][A-Z0-9 '&/()—–-]*[A-Z0-9)])\s*:\s*/;
// Alert names this product writes in capitals everywhere else
const KEEP_CAPS = new Set(['FUEL RATE', 'FUEL DOWN']);

function sentenceCase(s) {
  const t = s.trim();
  if (KEEP_CAPS.has(t)) return t;
  const lower = t.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const capitalise = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Litres to the tenth, as a number, or null. */
function litresOf(ev, text) {
  if (Number.isFinite(ev.ml)) return Math.round(ev.ml / 100) / 10;
  const m = /(\d+(?:\.\d+)?)\s*L\b/.exec(text ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * One alert as the list shows it: { t, severity, kind, tag, title, body,
 * litres }. `tag` is the headline's first part where it has two ("Possible
 * theft" of "POSSIBLE THEFT — FUEL STILL MISSING"); `body` is the sentence
 * with the unit's own name taken off the front.
 */
export function readAlert(ev, unitName = null) {
  let text = (ev.detail ?? '').trim();
  let tag = null;
  let title = ev.label ?? 'Alert';
  const head = HEADLINE.exec(text);
  if (head) {
    const parts = head[1].split(/\s+[—–]\s+/).map(sentenceCase);
    title = parts[parts.length - 1];
    tag = parts.length > 1 ? parts[0] : null;
    text = text.slice(head[0].length);
  }
  if (unitName) text = text.replace(new RegExp(`^${escapeRe(unitName)}\\s*[:,-]?\\s*`), '');
  const fuel = ev.kind === 'theft' || ev.kind === 'refill';
  const litres = fuel ? litresOf(ev, text) : null;
  // A body that is only the litres ("21.3 L") says nothing the figure beside
  // the title does not
  const body = /^\d+(?:\.\d+)?\s*L$/.test(text) ? null : capitalise(text) || null;
  return {
    t: ev.t,
    severity: ev.severity ?? 'info',
    kind: ev.kind ?? 'other',
    tag,
    title,
    body,
    litres,
  };
}

const maxSeverity = (items) => items.reduce(
  (s, it) => (SEVERITY_RANK[it.severity] > SEVERITY_RANK[s] ? it.severity : s), 'info');

/**
 * The list: fleet days, newest first, each with its entries newest first.
 *
 * An entry is one alert — { type: 'alert', ...readAlert } — or one fuel loss
 * with its reports folded in: { type: 'loss', t, severity, litres, title,
 * latest, reports }. Reports of a loss are the fuel-drain alerts of one day
 * naming the same litres. That is the only thread joining them: the follow-up
 * gives the litres but not the time of the drop. Two different losses of the
 * same tenth of a litre on one day would be folded together, and would still
 * each be listed under the entry.
 */
export function alertFeed(events, unitName = null) {
  const days = new Map();
  for (const ev of events) {
    const a = readAlert(ev, unitName);
    const day = fleetDayOf(ev.t);
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(a);
  }

  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([day, alerts]) => {
      const losses = new Map();
      const entries = [];
      for (const a of alerts) {
        if (a.kind === 'theft' && a.litres != null) {
          const key = a.litres.toFixed(1);
          if (!losses.has(key)) losses.set(key, []);
          losses.get(key).push(a);
        } else {
          entries.push({ type: 'alert', ...a });
        }
      }
      for (const reports of losses.values()) {
        if (reports.length === 1) { entries.push({ type: 'alert', ...reports[0] }); continue; }
        reports.sort((x, y) => x.t - y.t);
        const named = reports.find((r) => r.tag) ?? reports.find((r) => r.title !== 'Fuel drain');
        const title = named?.tag ?? named?.title ?? reports[0].title;
        const last = reports[reports.length - 1];
        entries.push({
          type: 'loss',
          t: reports[0].t,
          severity: maxSeverity(reports),
          litres: reports[0].litres,
          title,
          latest: last.t > reports[0].t ? last : null,
          reports,
        });
      }
      entries.sort((x, y) => y.t - x.t);
      return { day, entries };
    });
}
