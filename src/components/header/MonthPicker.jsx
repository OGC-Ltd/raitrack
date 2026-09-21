// Month picker for the Analytics window.
//
// A MONTH grid, not a day calendar, because the page's window is a whole month
// (or the current month to date) — offering day precision would let a reader
// pick a range the cards below cannot render.
//
// The selectable span is bounded at BOTH ends and that is the point of the
// component. Months before `min` are not empty, they are outside the record
// entirely: the fleet's first persisted trip and first fuel reading are in
// August 2026, so a September-2025 view would be five structural zeroes and a
// flat chart claiming the fleet stood still. Months after the current one have
// not happened. Both are rendered but disabled, so the boundary is visible
// rather than being a click that silently does nothing.

import { useState, useRef, useEffect } from "react";
import "./MonthPicker.css";

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "2026-08" → 24_320, so a month is one comparable integer. */
const ord = (key) => {
  const [y, m] = key.split("-").map(Number);
  return y * 12 + (m - 1);
};

export const monthLabelOf = (key) => {
  const [y, m] = key.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
};

/**
 * @param {string} value  selected month, "YYYY-MM"
 * @param {string} min    earliest selectable month, "YYYY-MM"
 * @param {string} max    latest selectable month, "YYYY-MM"
 */
export default function MonthPicker({ value, min, max, onChange }) {
  const [open, setOpen] = useState(false);
  // The year the GRID is showing, which is not the selected year once the user
  // starts paging. Re-seeded from `value` on each open so reopening never lands
  // somewhere the last session left it.
  const [year, setYear] = useState(() => Number(value.split("-")[0]));
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    const onEscape = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const minOrd = ord(min);
  const maxOrd = ord(max);
  const selOrd = ord(value);

  const toggle = () => {
    if (!open) setYear(Number(value.split("-")[0]));
    setOpen((o) => !o);
  };

  const pick = (monthIndex) => {
    const key = `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
    onChange(key);
    setOpen(false);
  };

  // Year paging stops where the record does, so there is no walking off into
  // years that can never hold a selectable month.
  const minYear = Number(min.split("-")[0]);
  const maxYear = Number(max.split("-")[0]);

  return (
    <div className="month-picker" ref={wrapRef}>
      <button
        type="button"
        className={`month-picker__trigger${open ? " month-picker__trigger--open" : ""}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Reporting month: ${monthLabelOf(value)}. Change month`}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
        <span className="month-picker__value">{monthLabelOf(value)}</span>
        <span className={`month-picker__chevron${open ? " month-picker__chevron--open" : ""}`} aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="month-picker__panel" role="dialog" aria-label="Choose reporting month">
          <div className="month-picker__yearbar">
            <button
              type="button"
              className="month-picker__nav"
              onClick={() => setYear((y) => y - 1)}
              disabled={year <= minYear}
              aria-label="Previous year"
            >‹</button>
            <span className="month-picker__year">{year}</span>
            <button
              type="button"
              className="month-picker__nav"
              onClick={() => setYear((y) => y + 1)}
              disabled={year >= maxYear}
              aria-label="Next year"
            >›</button>
          </div>

          <div className="month-picker__grid">
            {MONTHS_SHORT.map((label, i) => {
              const o = year * 12 + i;
              const disabled = o < minOrd || o > maxOrd;
              const selected = o === selOrd;
              return (
                <button
                  type="button"
                  key={label}
                  className={`month-picker__cell${selected ? " month-picker__cell--on" : ""}`}
                  onClick={() => pick(i)}
                  disabled={disabled}
                  aria-current={selected ? "true" : undefined}
                  title={
                    disabled
                      ? o < minOrd
                        ? `No records before ${monthLabelOf(min)}`
                        : "Not reached yet"
                      : undefined
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          <div className="month-picker__foot">
            Records begin {monthLabelOf(min)}
          </div>
        </div>
      )}
    </div>
  );
}
