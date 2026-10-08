/**
 * Entries and exits — the Logbook's account of where a unit went, fence by
 * fence (operator, 2026-10-09: "if it made an entry into Sukari Industries,
 * where did it spend the time within the premises, and when it left, where did
 * it go and for how long").
 *
 * Three views of one list (review.visits, fleet-server usage-review.visits):
 *
 *   Journey    one row per day, 00:00–24:00: the premises it was inside as
 *              blocks, the areas within them as a band under each block,
 *              and its stops outside every fence by kind. Click a day to
 *              follow it on the map and in the log.
 *   Register   per fence: visits, hours, usual arrival and departure, and
 *              where it went next most often. Click to list that fence's visits.
 *   Log        the picked day (or fence) in order — entered, the areas inside,
 *              left, the time on the road, the next place — named the way the
 *              operator asked: "Sukari Industries · Weighbridge (work area)",
 *              "Ndhiwa Market (outside work area)".
 */
import { Fragment, useMemo, useState } from "react";
import { placeCase } from "./logbookPlaces";

const TZ = "Africa/Nairobi";
const DAY_MS = 86_400_000;
const EAT_MS = 3 * 3_600_000;
const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ });
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dayKey = (ms) => new Date(ms + EAT_MS).toISOString().slice(0, 10);
const dayStart = (key) => Date.parse(`${key}T00:00:00Z`) - EAT_MS;
const dayLabel = (key, weekday = false) => {
  const d = new Date(`${key}T00:00:00Z`);
  return `${weekday ? `${WEEKDAYS[d.getUTCDay()]} ` : ""}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};
const dur = (min) => {
  if (min == null) return "—";
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
};
const hhmm = (m) => (m == null ? "—" : `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);

/** The areas inside a premises, one hue each — kept clear of the green (home)
 *  and orange (outside work) the stops wear on the same strip. */
const AREA_TONES = ["#2a78d6", "#eda100", "#0e9aa7", "#c2185b", "#5b5bd6", "#7a8b1f"];

const KIND_WORD = { work: "work area", home: "home area", elsewhere: "outside work area" };

export default function LogbookVisits({ review, pal, gnames, sel, setSel, onPlayDay }) {
  const vz = review.visits;
  const [focus, setFocus] = useState(null);   // a fence id, from the register

  const fenceById = useMemo(() => new Map((vz?.fences ?? []).map((f) => [f.id, f])), [vz]);
  const placeById = useMemo(() => new Map(review.places.map((p) => [p.id, p])), [review]);
  const areaTone = useMemo(() => {
    const m = new Map();
    (vz?.fences ?? []).filter((f) => f.parentId).forEach((f, i) => m.set(f.id, AREA_TONES[i % AREA_TONES.length]));
    return m;
  }, [vz]);

  // Each premises, then the areas inside it, each by hours.
  const registerRows = useMemo(() => {
    const reg = vz?.register ?? [];
    const parentOf = (id) => fenceById.get(id)?.parentId ?? null;
    const tops = reg.filter((r) => !parentOf(r.fenceId) || !reg.some((x) => x.fenceId === parentOf(r.fenceId)));
    return tops.flatMap((t) => [t, ...reg.filter((r) => parentOf(r.fenceId) === t.fenceId)]);
  }, [vz, fenceById]);

  const fenceName = (id) => `${fenceById.get(id)?.name ?? "Fence"} (work area)`;
  const areaShort = (id) => {
    const f = fenceById.get(id);
    const parent = f?.parentId ? fenceById.get(f.parentId) : null;
    const n = f?.name ?? "";
    return parent && n.startsWith(parent.name) ? n.slice(parent.name.length).replace(/^[\s·:,–-]+/, "") || n : n;
  };
  const placeName = (id) => {
    const p = placeById.get(id);
    const n = gnames?.get(id) ?? placeCase(p?.name) ?? `Place ${id}`;
    return `${n} (${KIND_WORD[p?.kind] ?? KIND_WORD.elsewhere})`;
  };
  const refName = (r) => {
    if (!r) return "—";
    if (r.kind === "end") return "Still there when the period ended";
    if (r.kind === "exit") return `Left ${fenceById.get(r.id)?.name ?? "the premises"}`;
    if (r.kind === "fence") return fenceName(r.id);
    return placeName(r.id);
  };

  // Stops that sit in no visit: the time outside every fence.
  const outsideStops = useMemo(() => {
    if (!vz) return [];
    const top = vz.visits.filter((v) => v.parent == null);
    return review.stops.filter((s) => !top.some((v) => v.start <= (s.start + s.end) / 2 && v.end >= (s.start + s.end) / 2));
  }, [vz, review]);

  // ── journey: per day, the pieces that fall in it ──
  const days = useMemo(() => {
    if (!vz) return [];
    const by = new Map();
    const put = (key, item) => { if (!by.has(key)) by.set(key, []); by.get(key).push(item); };
    const split = (a, b, item) => {
      for (let k = dayKey(a); dayStart(k) < b; k = dayKey(dayStart(k) + DAY_MS + 1)) {
        const s = Math.max(a, dayStart(k)), e = Math.min(b, dayStart(k) + DAY_MS);
        if (e > s) put(k, { ...item, s, e });
        if (k >= review.period.to) break;
      }
    };
    for (const v of vz.visits) split(v.start, v.end, { type: v.parent == null ? "premises" : "area", v });
    for (const s of outsideStops) split(s.start, s.end, { type: "stop", st: s });
    return [...by.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, items]) => ({ key, items }));
  }, [vz, outsideStops, review]);

  if (!vz) {
    return (
      <section className="frv-card urv-card urv-visits">
        <h3 className="frv-card__t">Entries and Exits</h3>
        <div className="urv-hint">Entries and exits could not be worked out for this review: the organisation’s fences could not be read. Build again to retry.</div>
      </section>
    );
  }
  if (!vz.visits.length) {
    return (
      <section className="frv-card urv-card urv-visits">
        <h3 className="frv-card__t">Entries and Exits</h3>
        <div className="urv-hint">
          {review.vehicle.plate} went into none of the organisation’s site fences in this period. To follow it through a site,
          draw the site and the areas inside it on the map (Draw), then Recount.
        </div>
      </section>
    );
  }

  const tip = (it) => {
    if (it.type === "stop") return `${placeName(it.st.place)} · ${clock.format(it.st.start)}–${clock.format(it.st.end)} · ${dur(it.st.min)}`;
    const v = it.v;
    return `${fenceName(v.fenceId)} · ${v.openStart ? "already inside" : `in ${clock.format(v.start)}`} – ${v.openEnd ? "still inside" : `out ${clock.format(v.end)}`} · ${dur(v.min)}`;
  };
  const stopTone = (st) => {
    const k = placeById.get(st.place)?.kind;
    return k === "home" ? pal.base : k === "work" ? pal.fence : pal.place;
  };
  const pct = (key, t) => ((t - dayStart(key)) / DAY_MS) * 100;

  // ── the log: a day's sequence, or one fence's visits ──
  const logDay = sel.day && days.some((d) => d.key === sel.day) ? sel.day : null;
  const logFence = !logDay && focus ? focus : null;
  const shownDay = logDay ?? (!logFence ? days[days.length - 1]?.key : null);

  let log = null;
  if (shownDay) {
    const t0 = dayStart(shownDay), t1 = t0 + DAY_MS;
    const inDay = (a, b) => a < t1 && b > t0;
    const tops = vz.visits.filter((v) => v.parent == null && inDay(v.start, v.end));
    const outs = outsideStops.filter((s) => inDay(s.start, s.end));
    const seq = [
      ...tops.map((v) => ({ at: v.start, end: v.end, v })),
      ...outs.map((s) => ({ at: s.start, end: s.end, st: s })),
    ].sort((a, b) => a.at - b.at);
    log = (
      <ol className="urv-vlog">
        {seq.map((e, k) => {
          const prev = seq[k - 1];
          const road = prev ? Math.round((e.at - prev.end) / 60_000) : null;
          return (
            <Fragment key={e.v ? `v${e.v.id}` : `s${e.st.id}`}>
              {road != null && road > 0 && <li className="urv-vlog__road"><i className="ti ti-road" aria-hidden="true" /> {dur(road)} on the road</li>}
              {e.v ? (
                <li className="urv-vlog__item urv-vlog__item--fence">
                  <div className="urv-vlog__head">
                    <span className="urv-vlog__time">{e.v.openStart ? "before 00:00" : clock.format(e.v.start)}</span>
                    <b>Entered {fenceName(e.v.fenceId)}</b>
                  </div>
                  {vz.visits.filter((a) => a.parent === e.v.id).map((a) => (
                    <div key={a.id} className="urv-vlog__area">
                      <i style={{ background: areaTone.get(a.fenceId) }} aria-hidden="true" />
                      <span className="urv-vlog__time">{clock.format(a.start)}–{clock.format(a.end)}</span>
                      <span>{areaShort(a.fenceId)}</span>
                      <span className="urv-vlog__dur">{dur(a.min)}</span>
                    </div>
                  ))}
                  <div className="urv-vlog__head urv-vlog__head--out">
                    <span className="urv-vlog__time">{e.v.openEnd ? "—" : clock.format(e.v.end)}</span>
                    <span>{e.v.openEnd ? "Still inside when the period ended" : <>Left after <b>{dur(e.v.min)}</b>{e.v.quietMin >= 30 ? ` (tracker quiet ${dur(e.v.quietMin)} of it)` : ""}</>}</span>
                  </div>
                </li>
              ) : (
                <li className="urv-vlog__item urv-vlog__item--stop">
                  <div className="urv-vlog__head">
                    <span className="urv-vlog__time">{clock.format(e.st.start)}</span>
                    <b>{placeName(e.st.place)}</b>
                    <span className="urv-vlog__dur">{dur(e.st.min)}</span>
                  </div>
                </li>
              )}
            </Fragment>
          );
        })}
      </ol>
    );
  } else if (logFence) {
    const rows = vz.visits.filter((v) => v.fenceId === logFence);
    log = (
      <div className="sp4-table-scroll urv-table">
        <table className="sp4-table">
          <thead><tr><th>Day</th><th>Entered</th><th>Left</th><th className="urv-num">Stay</th><th>Went next</th></tr></thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id} className="urv-row" onClick={() => setSel((x) => ({ ...x, day: dayKey(v.start) }))} title="Follow this day">
                <td>{dayLabel(dayKey(v.start), true)}</td>
                <td>{v.openStart ? "already inside" : clock.format(v.start)}</td>
                <td>{v.openEnd ? "still inside" : clock.format(v.end)}</td>
                <td className="urv-num">{dur(v.min)}</td>
                <td>{refName(v.next)}{v.toNextMin >= 1 && v.next?.kind !== "exit" ? <span className="urv-muted"> · {dur(v.toNextMin)} later</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <section className="frv-card urv-card urv-visits">
      <div className="urv-detail__head">
        <div>
          <h3 className="frv-card__t">Entries and Exits</h3>
          <p className="urv-card__sub">
            {vz.visits.filter((v) => v.parent == null).length} visits to {vz.fences.filter((f) => !f.parentId).length} site(s) · fix by fix, so a short pass over a weighbridge counts · click a day to follow it
          </p>
        </div>
      </div>

      <div className="urv-journey" role="list" aria-label="Journey by day">
        <div className="urv-journey__axis" aria-hidden="true">
          <span />
          <div>{[0, 6, 12, 18, 24].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{String(h).padStart(2, "0")}</span>)}</div>
        </div>
        <div className="urv-journey__rows">
          {days.map((d) => (
            <button key={d.key} type="button" role="listitem"
                    className={`urv-journey__row${shownDay === d.key && !logFence ? " is-on" : ""}`}
                    onClick={() => { setFocus(null); setSel((x) => ({ ...x, day: x.day === d.key ? null : d.key })); }}
                    title={`${dayLabel(d.key, true)}: click to follow this day`}>
              <span className="urv-journey__day">{dayLabel(d.key, true)}</span>
              <span className="urv-journey__track">
                {d.items.filter((it) => it.type !== "area").map((it, i) => (
                  <span key={i}
                        className={`urv-journey__blk urv-journey__blk--${it.type}`}
                        style={{ left: `${pct(d.key, it.s)}%`, width: `${Math.max(0.4, pct(d.key, it.e) - pct(d.key, it.s))}%`,
                                 background: it.type === "stop" ? stopTone(it.st) : pal.fence }}
                        title={tip(it)} />
                ))}
                {d.items.filter((it) => it.type === "area").map((it, i) => (
                  <span key={`a${i}`} className="urv-journey__blk urv-journey__blk--area"
                        style={{ left: `${pct(d.key, it.s)}%`, width: `${Math.max(0.4, pct(d.key, it.e) - pct(d.key, it.s))}%`, background: areaTone.get(it.v.fenceId) }}
                        title={tip(it)} />
                ))}
              </span>
            </button>
          ))}
        </div>
        <div className="urv-journey__key" aria-hidden="true">
          <span><i style={{ background: pal.fence }} />Inside a site</span>
          {[...areaTone.entries()].map(([id, c]) => <span key={id}><i style={{ background: c }} />{areaShort(id)}</span>)}
          <span><i style={{ background: pal.base }} />Home area</span>
          <span><i style={{ background: pal.place }} />Outside work area</span>
        </div>
      </div>

      <div className="urv-visits__lower">
        <div className="urv-visits__reg">
          <h4 className="urv-visits__t">Register</h4>
          <div className="sp4-table-scroll urv-table">
            <table className="sp4-table">
              <thead><tr><th>Place</th><th className="urv-num">Visits</th><th className="urv-num">Hours</th><th className="urv-num">Avg stay</th><th>Usually</th><th>Most often next</th></tr></thead>
              <tbody>
                {registerRows.map((r) => {
                  const f = fenceById.get(r.fenceId);
                  return (
                    <tr key={r.fenceId} className={`urv-row${logFence === r.fenceId ? " urv-row--on" : ""}${f?.parentId ? " urv-row--sub" : ""}`}
                        onClick={() => { setSel((x) => ({ ...x, day: null })); setFocus((v) => (v === r.fenceId ? null : r.fenceId)); }}
                        title="List this place's visits">
                      {/* An area sits under its premises, so it needs only its own name. */}
                      <td title={fenceName(r.fenceId)}>
                        {f?.parentId
                          ? <><i className="urv-swatch" style={{ background: areaTone.get(r.fenceId) }} aria-hidden="true" />{areaShort(r.fenceId)}</>
                          : fenceName(r.fenceId)}
                      </td>
                      <td className="urv-num">{r.visits}</td>
                      <td className="urv-num">{r.hours.toLocaleString("en-GB", { maximumFractionDigits: 1 })}</td>
                      <td className="urv-num">{dur(r.avgMin)}</td>
                      <td>{hhmm(r.usualIn)}–{hhmm(r.usualOut)}</td>
                      <td>{r.next[0] ? <>{refName(r.next[0].ref)} <span className="urv-muted">×{r.next[0].times}</span></> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="urv-visits__log">
          <div className="urv-visits__loghead">
            <h4 className="urv-visits__t">
              {logFence ? `Every visit: ${fenceById.get(logFence)?.name}` : shownDay ? dayLabel(shownDay, true) : "Log"}
            </h4>
            {shownDay && onPlayDay && (
              <button type="button" className="urv-dayplay" onClick={() => onPlayDay(shownDay)} title="Play this day on the map">
                <i className="ti ti-player-play-filled" aria-hidden="true" /> Play
              </button>
            )}
          </div>
          {log}
        </div>
      </div>
    </section>
  );
}
