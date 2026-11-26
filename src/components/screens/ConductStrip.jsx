/* Hallmark · redesign 2026-11-25 · component: Driver conduct stats strip
 * theme: in-project tokens, preserved (DriversScreen.css .dr-tones / .dr-strip)
 * states: idle (run the report) · loading · zero (segments hidden) · chart
 *   hover + focus (TrendStat) · rising = red delta
 *
 * The Alerts strip, read for Driver conduct (operator, 25 Nov 2026: "the stats
 * cards to be like" the Alerts page's). One frame, four cells split by
 * hairlines: the period's incidents and how far follow-up has got, harsh
 * driving and dashcam alarms a day each, and the six kinds with the vehicles
 * behind each. It replaces eight equal tiles that gave Total incidents the
 * same weight as Camera covered. Every figure is the table's own: the strip
 * reads the rows on screen, so it follows the vehicle or driver search.
 */
import TrendStat from './TrendStat';
import { daysCovering } from '../../lib/fleetReports';
import { statusWord } from '../../lib/followUp';

const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-GB'));
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);
const fmtDay = (day) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// How far follow-up has got, per vehicle, in the Alerts Decisions bar's tones
const FOLLOW_UP = [
  { word: 'Pending', label: 'Pending', mix: 'fair' },
  { word: 'Action taken', label: 'Action taken', mix: 'good' },
  { word: 'No case', label: 'No case', mix: 'new' },
];

const KINDS = [
  { key: 'accel', name: 'Harsh acceleration', tone: 'speed' },
  { key: 'brake', name: 'Harsh braking', tone: 'speed' },
  { key: 'corner', name: 'Harsh cornering', tone: 'speed' },
  { key: 'seatbelt', name: 'No seatbelt', tone: 'theft' },
  { key: 'phone', name: 'On phone', tone: 'theft' },
  { key: 'covered', name: 'Camera covered', tone: 'theft' },
];

/**
 * rows: the conduct rows on screen (behaviourRows, after the search). ctx: the
 * run's (from, to, followUp, now). scope: the words for what the rows cover.
 * status: the run's ('idle', 'loading', 'done', ...), for the empty cells.
 */
export default function ConductStrip({ rows, ctx, scope, status }) {
  if (!rows || !ctx) {
    const words = status === 'loading' ? 'Reading…' : '-';
    return (
      <section className="dr-strip rpt-conduct-strip" aria-label="Driver conduct in the period" aria-busy={status === 'loading'}>
        {['Incidents', 'Harsh driving', 'Dashcam alarms', 'Vehicles'].map((t) => (
          <div key={t} className="dr-cell">
            <div className="dr-statchart__head"><span className="dr-statchart__label">{t}</span></div>
            <div className="dr-cell__empty">{words}</div>
          </div>
        ))}
      </section>
    );
  }

  const series = daysCovering(ctx.from, ctx.to).map((day) => ({ day, harsh: 0, dashcam: 0 }));
  const at = new Map(series.map((d) => [d.day, d]));
  for (const r of rows) {
    for (const [day, c] of Object.entries(r.days ?? {})) {
      const d = at.get(day);
      if (d) { d.harsh += c.harsh; d.dashcam += c.dashcam; }
    }
  }
  const sum = (k) => series.reduce((t, d) => t + d[k], 0);
  const half = Math.max(1, Math.floor(series.length / 2));
  const sub = series.length > 1 ? `last ${half}d vs previous ${half}d, ${scope}` : `one day, ${scope}`;
  const pointWords = (k, one) => (d) => `${fmtDay(d.day)}: ${fmt(d[k])} ${plural(d[k], one)}`;

  return (
    <section className="dr-strip rpt-conduct-strip" aria-label="Driver conduct in the period">
      <IncidentsCell rows={rows} ctx={ctx} />
      <TrendStat
        title="Harsh driving"
        series={series}
        valueKey="harsh"
        value={fmt(sum('harsh'))}
        unit={plural(sum('harsh'), 'event')}
        tone="speed"
        type="bar"
        what="harsh driving events"
        sub={sub}
        upIsBad
        pointWords={pointWords('harsh', 'event')}
      />
      <TrendStat
        title="Dashcam alarms"
        series={series}
        valueKey="dashcam"
        value={fmt(sum('dashcam'))}
        unit={plural(sum('dashcam'), 'alarm')}
        tone="theft"
        type="line"
        sub={ctx.dashcams === false ? 'no dashcams in this fleet' : sub}
        upIsBad
        pointWords={pointWords('dashcam', 'alarm')}
      />
      <KindsCell rows={rows} />
    </section>
  );
}

/** The period's incidents: how many, of which kind, and how far follow-up has got. */
function IncidentsCell({ rows, ctx }) {
  const sum = (k) => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  const total = sum('total');
  const suspect = rows.filter((r) => r.suspect).length;
  const facts = [
    { label: 'Harsh driving', value: sum('accel') + sum('brake') + sum('corner') },
    { label: 'Dashcam', value: sum('seatbelt') + sum('phone') + sum('covered') },
    { label: 'Logged', value: sum('logged') },
    ...(suspect ? [{ label: 'Check sensor', value: suspect }] : []),
  ];
  const words = rows.map((r) => statusWord(ctx.followUp?.get(r.unit.key), ctx.now));
  const mix = FOLLOW_UP.map((f) => ({ ...f, n: words.filter((w) => w === f.word).length }));

  return (
    <div className="dr-cell dr-fleet">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Incidents</span>
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(total)}</span>
        <span className="dr-summary__caption">in the period,<br />{fmt(rows.length)} {plural(rows.length, 'vehicle')}</span>
      </div>
      <dl className="dr-fleet__facts">
        {facts.map((f) => (
          <div key={f.label} className="dr-fleet__fact">
            <dt>{f.label}</dt>
            <dd>{fmt(f.value)}</dd>
          </div>
        ))}
      </dl>
      <div className="dr-fleet__mix">
        <span className="dr-fleet__mixlabel">Follow-up</span>
        <span className="dr-fleet__bar" role="img"
              aria-label={rows.length ? mix.map((m) => `${m.n} ${m.label.toLowerCase()}`).join(', ') : 'No vehicles in the period'}>
          {mix.map((m) => m.n > 0 && (
            <span key={m.word} className={`dr-fleet__seg dr-fleet__seg--${m.mix}`}
                  style={{ flexGrow: m.n }}
                  title={`${m.label}: ${fmt(m.n)} ${plural(m.n, 'vehicle')}`} />
          ))}
        </span>
        <ul className="dr-fleet__legend">
          {mix.map((m) => (
            <li key={m.word} className={`dr-fleet__key dr-fleet__key--${m.mix}`}>
              <span className="dr-fleet__swatch" aria-hidden="true" />{m.label}<b>{fmt(m.n)}</b>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** Each kind with the vehicles behind it: the only rows allowed colour, and only when not zero. */
function KindsCell({ rows }) {
  const kinds = KINDS.map((k) => ({
    ...k,
    n: rows.reduce((t, r) => t + (r[k.key] ?? 0), 0),
    who: rows.filter((r) => (r[k.key] ?? 0) > 0).length,
  }));
  const any = rows.filter((r) => r.total > 0).length;

  return (
    <div className="dr-cell dr-summary">
      <div className="dr-statchart__head">
        <span className="dr-statchart__label">Vehicles</span>
        {!any && <span className="dr-summary__clean">Clear</span>}
      </div>
      <div className="dr-summary__lead">
        <span className="dr-summary__figure">{fmt(any)}</span>
        <span className="dr-summary__caption">with incidents,<br />by kind</span>
      </div>
      <div className="dr-summary__incidents">
        {kinds.map((k) => (
          <div key={k.key} className={`dr-summary__incident${k.n ? ` dr-summary__incident--${k.tone}` : ''}`}>
            <span className="dr-summary__dot" aria-hidden="true" />
            <span className="dr-summary__name">
              {k.name}
              {k.n > 0 && <span className="dr-summary__who"> · {fmt(k.who)} {plural(k.who, 'vehicle')}</span>}
            </span>
            <span className="dr-summary__count">{fmt(k.n)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
