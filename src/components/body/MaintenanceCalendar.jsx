/* Month calendar — the fourth tile in the history-chart row, and the control
   that sets the window those charts read.

   Three ways to choose a window, in increasing precision:
     · a period preset — Today / Month / Year / All;
     · a single day    — click it;
     · a range         — click a day, then a second to extend to it. A third
                         click starts a new single-day selection.

   Every preset ends at TODAY rather than at the end of the calendar period.
   "Year" means Jan 1 → today, not Jan 1 → Dec 31: the charts split whatever
   window they are given in half and label it "this period vs previous", so
   trailing empty future days would drag the current half toward zero and
   report a fake decline. See MaintenancePage's HistoryChartCard.

   Ported from fleetdash; "today" uses the real calendar date (fleettrack has
   no sim clock). */
import { useState, memo } from 'react';

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function dateKey(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function buildMonthGrid(year, month) {
  const firstDay    = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells = [];
  for (let i = 0; i < startOffset; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

/* The period presets, each resolved against the real today at click time.
   `view` reports which month the grid should jump to so the selection the
   preset just made is actually visible — picking "Year" while parked on a
   month six back would otherwise highlight nothing. `null` range = the hook's
   default window, which is what "All" means. */
const PERIOD_PRESETS = [
  {
    key: 'today',
    label: 'Today',
    build: (t) => {
      const k = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
      return { range: { start: k, end: k }, view: [t.getFullYear(), t.getMonth()] };
    },
  },
  {
    key: 'month',
    label: 'Month',
    build: (t) => ({
      range: {
        start: dateKey(t.getFullYear(), t.getMonth(), 1),
        end:   dateKey(t.getFullYear(), t.getMonth(), t.getDate()),
      },
      view: [t.getFullYear(), t.getMonth()],
    }),
  },
  {
    key: 'year',
    label: 'Year',
    build: (t) => ({
      range: {
        start: dateKey(t.getFullYear(), 0, 1),
        end:   dateKey(t.getFullYear(), t.getMonth(), t.getDate()),
      },
      view: [t.getFullYear(), t.getMonth()],
    }),
  },
  {
    key: 'all',
    label: 'All',
    build: (t) => ({ range: null, view: [t.getFullYear(), t.getMonth()] }),
  },
];

// Memoized: the calendar's props don't change when a vehicle is selected in
// the grid below, so it shouldn't re-render its ~400 day cells on selection.
export default memo(function MaintenanceCalendar({ selection, onSelect }) {
  const today = new Date();

  const [viewYear, setViewYear]   = useState(() => today.getFullYear());
  const [viewMonth, setViewMonth] = useState(() => today.getMonth());

  const cells = buildMonthGrid(viewYear, viewMonth);
  const isToday = (d) => d != null
    && viewYear === today.getFullYear()
    && viewMonth === today.getMonth()
    && d === today.getDate();

  const changeMonth = (delta) => {
    let m = viewMonth + delta, y = viewYear;
    if (m < 0)  { m = 11; y -= 1; }
    if (m > 11) { m = 0;  y += 1; }
    setViewMonth(m);
    setViewYear(y);
  };

  // Which preset, if any, the CURRENT selection equals. Derived by comparing
  // against freshly-built ranges rather than stored on click, so a range the
  // user assembled by hand that happens to match "Month" lights up too — and
  // so the highlight survives a re-mount.
  const activePreset = PERIOD_PRESETS.find(p => {
    const { range } = p.build(today);
    if (range == null) return selection == null;
    return selection != null && selection.start === range.start && selection.end === range.end;
  })?.key;

  const applyPreset = (preset) => {
    const { range, view } = preset.build(today);
    setViewYear(view[0]);
    setViewMonth(view[1]);
    onSelect(range);
  };

  const cellState = (key) => {
    if (!selection) return '';
    const { start, end } = selection;
    if (key === start && key === end) return ' selected-single';
    if (key === start) return ' selected-start';
    if (key === end)   return ' selected-end';
    if (key > start && key < end) return ' selected-range';
    return '';
  };

  const handleClick = (day) => {
    const key = dateKey(viewYear, viewMonth, day);
    if (!selection || selection.start !== selection.end) {
      onSelect({ start: key, end: key });
    } else {
      onSelect(key < selection.start ? { start: key, end: selection.start } : { start: selection.start, end: key });
    }
  };

  return (
    <div className="maint-calendar-tile">
      <div className="maint-calendar__head">
        <button className="maint-calendar__nav" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
        <span className="maint-calendar__title">{MONTHS[viewMonth]} {viewYear}</span>
        <button className="maint-calendar__nav" onClick={() => changeMonth(1)} aria-label="Next month">›</button>
      </div>

      <div className="maint-calendar__presets">
        {PERIOD_PRESETS.map(p => (
          <button
            key={p.key}
            type="button"
            className={'maint-calendar__preset' + (activePreset === p.key ? ' is-active' : '')}
            aria-pressed={activePreset === p.key}
            onClick={() => applyPreset(p)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="maint-calendar__weekdays">
        {WEEKDAYS.map(w => <span key={w}>{w}</span>)}
      </div>

      <div className="maint-calendar__grid">
        {cells.map((d, i) => {
          const key = d != null ? dateKey(viewYear, viewMonth, d) : null;
          return (
            <button
              key={i}
              type="button"
              disabled={d == null}
              onClick={() => d != null && handleClick(d)}
              className={`maint-calendar__cell${d == null ? ' empty' : ''}${isToday(d) ? ' today' : ''}${key ? cellState(key) : ''}`}
            >
              {d ?? ''}
            </button>
          );
        })}
      </div>

      {/* Reads out the window actually in effect — the preset chip says which
          period was asked for, this says the dates it resolved to.

          Rendered in BOTH states, not just when something is selected. Two
          reasons: this tile sets the height of the whole chart row, so a
          readout that appears and disappears would grow the row by ~19px and
          nudge all three charts down on every selection; and the default
          window is otherwise unstated, leaving "All" to mean whatever the
          reader assumes. */}
      {selection ? (
        <button className="maint-calendar__clear" onClick={() => onSelect(null)}>
          {selection.start === selection.end ? selection.start : `${selection.start} → ${selection.end}`} · Clear
        </button>
      ) : (
        <span className="maint-calendar__clear maint-calendar__clear--static">
          Last 366 days · default
        </span>
      )}
    </div>
  );
})
