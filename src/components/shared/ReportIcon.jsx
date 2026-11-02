/**
 * The Reports page's marks, one per report (redrawn 2026-11-02). Each says
 * what its report reads rather than a stock glyph near it: a CPO tanker for
 * the movements sheet, the sun going down on a clipboard for End of shift, a
 * needle pinned past the dial for Overspeeding, a day's dial three parts used
 * for Utilization.
 *
 * One hand: a 24 grid, a 1.75 stroke with round ends, nothing filled but the
 * used part of the utilization dial. Inherits `currentColor` and sizes off the
 * text it sits in (1em), like the Tabler glyphs beside it, so a tab or an
 * EmptyNote disc sets its size and colour.
 */
const MARKS = {
  // End of shift: a clipboard, and on it the sun setting on a line.
  shift: (
    <>
      <path d="M9 4.5H7a1.5 1.5 0 0 0-1.5 1.5v13.5A1.5 1.5 0 0 0 7 21h10a1.5 1.5 0 0 0 1.5-1.5V6A1.5 1.5 0 0 0 17 4.5h-2" />
      <rect x="9" y="3" width="6" height="3" rx="1" />
      <path d="M8 17.5h8" />
      <path d="M9.5 17.5a2.5 2.5 0 0 1 5 0" />
      <path d="M12 10.5v1.6M8 12.4l1 1M16 12.4l-1 1" />
    </>
  ),
  // CPO movements: a tanker, tank behind the cab, on the move.
  movements: (
    <>
      <rect x="2.5" y="7.5" width="11" height="6.5" rx="3.25" />
      <path d="M13.5 14V9.5h3.6a1 1 0 0 1 .9.6l1.9 4.4V17h-1.4" />
      <path d="M2.5 17h1.9M7.6 17h7.8" />
      <circle cx="6" cy="17.2" r="1.6" />
      <circle cx="17" cy="17.2" r="1.6" />
      <path d="M16 9.5v2.5h3" />
    </>
  ),
  // Driver behaviour: the wheel, three spokes to the hub.
  behaviour: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M3.6 10.8 10 11.6M20.4 10.8 14 11.6M12 14v6.5" />
    </>
  ),
  // Night driving: a road running off under a crescent moon.
  night: (
    <>
      <path d="M18.3 2.8a2.9 2.9 0 1 0 2.9 3.9 3.4 3.4 0 0 1-2.9-3.9Z" />
      <path d="M4 21 9.5 11M20 21 14.5 11" />
      <path d="M12 13.5v1.5M12 18v2.5" />
    </>
  ),
  // Overspeeding: a dial, its needle pinned past the last mark.
  overspeed: (
    <>
      <path d="M4.2 17.5a8.5 8.5 0 1 1 15.6 0" />
      <path d="M12 6v1.5M6.3 8.4l1 1M17.7 8.4l-1 1M4.5 13h1.4" />
      <path d="m12 14.5 6.8-3.4" />
      <circle cx="12" cy="14.5" r="1.4" />
    </>
  ),
  // Vehicle utilization: the day as a dial, the used part filled.
  utilisation: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 12V3.5a8.5 8.5 0 1 1-8.5 8.5Z" fill="currentColor" fillOpacity=".22" stroke="none" />
      <path d="M12 3.5V12H3.5" />
    </>
  ),
};

export default function ReportIcon({ name, className = '' }) {
  const mark = MARKS[name];
  if (!mark) return null;
  return (
    <svg className={`report-icon ${className}`} width="1em" height="1em" viewBox="0 0 24 24"
         fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
         aria-hidden="true" focusable="false">
      {mark}
    </svg>
  );
}
