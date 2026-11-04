/*
 * The hours under the calendar: click an hour, or two for a window, or set them
 * exactly. With hh and hoursText, what the field reads for them. Movements' own,
 * shared with the report tabs under it (operator, 4 Nov 2026).
 */

import { useState } from 'react';
import { hourLabel } from '../../lib/fleetReports';

// The day's end reads 24:00, so a whole day is 00:00–24:00, not 00:00–00:00
// Hours may carry minutes (7.5 = 07:30): the Shift picks to the minute (operator, 2 Nov)
export const hh = (h) => {
  if (h === 24) return '24:00';
  const m = Math.round(h * 60);
  return `${hourLabel(Math.floor(m / 60) % 24)}:${String(m % 60).padStart(2, '0')}`;
};
/** "07:00/20:00", "20:00/06:00 next day" (operator, 3 Nov: "07:30/19:30"). */
export const hoursText = (start, end) => `${hh(start)}/${hh(end)}${end <= start ? ' next day' : ''}`;

export default function HourWindow({ start, end, onChange, label = 'Hours each day' }) {
  const [anchor, setAnchor] = useState(null);
  const lastHour = (end + 23) % 24;
  const inWindow = (h) => (end > start ? h >= start && h < end : h >= start || h < end);
  const click = (h) => {
    if (anchor == null) { setAnchor(h); onChange(h, h + 1); return; }
    onChange(Math.min(anchor, h), Math.max(anchor, h) + 1);
    setAnchor(null);
  };
  const exact = (s, e) => { setAnchor(null); onChange(s, e); };
  const span = ((end - start + 23) % 24) + 1;
  return (
    <div className="mvr-hours" role="group" aria-label={label}>
      <div className="mvr-hours__head">
        <span className="mvr-hours__l">{label}</span>
        <button type="button" className={`drp-chip${start === 0 && end === 24 ? ' drp-chip--on' : ''}`}
                onClick={() => exact(0, 24)}>Whole day</button>
      </div>
      <div className="mvr-hours__ruler">
        {Array.from({ length: 24 }, (_, h) => {
          const cls = ['mvr-hour',
            inWindow(h) && 'mvr-hour--in',
            h === start && 'mvr-hour--lo',
            h === lastHour && 'mvr-hour--hi',
            anchor === h && 'mvr-hour--anchor'].filter(Boolean).join(' ');
          return (
            <button key={h} type="button" className={cls} onClick={() => click(h)}
                    aria-pressed={inWindow(h)} aria-label={`${hh(h)} to ${hh(h + 1)}`}>
              {hourLabel(h)}
            </button>
          );
        })}
      </div>
      <div className="mvr-hours__exact">
        <label>From
          <select className="rpt-select" value={start} onChange={(e) => exact(Number(e.target.value), end)}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </label>
        <label>To
          <select className="rpt-select" value={end} onChange={(e) => exact(start, Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, i) => i + 1).map((h) => <option key={h} value={h}>{hh(h)}</option>)}
          </select>
        </label>
        <span className="mvr-hours__span">{span === 1 ? '1 hour' : `${span} hours`}{end <= start ? ', past midnight' : ''}</span>
      </div>
    </div>
  );
}
