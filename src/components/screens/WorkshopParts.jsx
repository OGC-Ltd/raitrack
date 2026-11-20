/**
 * The Workshop's tables and filter row, in the Staffs page's parts
 * (DriversScreen.css): shared by every Workshop view, Auto Workshop included.
 */
import TablePager from "../body/TablePager";

// ── The Staffs page's parts ─────────────────────────────────────────────────
// The Workshop is laid out as the Staffs page is (operator, 2026-11-21): a
// title with the view switch beside it, a summary strip, one filter row of
// segmented switches and the search, then the table in its card with the
// standard pager under it.

/** The filter row: a segmented switch per group, the search, then the tools. */
export function WfFilters({ groups = [], search, onSearch, placeholder, label, tools = null }) {
  return (
    <div className="dr-filters wf-filters">
      {groups.map((g) => (
        <div key={g.label} className="dr-filters__chips" role="group" aria-label={g.label}>
          <span className="dr-rankby__label" aria-hidden="true">{g.label}</span>
          <span className="dr-seg">
            {g.options.map(([id, text, n]) => (
              <button key={id} type="button" aria-pressed={g.value === id}
                      className={`dr-chip${g.value === id ? " dr-chip--active" : ""}`} onClick={() => g.onPick(id)}>
                {text}{n != null && <span className="wf-chip-n">{n}</span>}
              </button>
            ))}
          </span>
        </div>
      ))}
      {onSearch && (
        <div className="dr-searchwrap">
          <svg className="dr-searchwrap__icon" width="13" height="13" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input className="dr-search" type="text" value={search} placeholder={placeholder} aria-label={label}
                 onChange={(e) => onSearch(e.target.value)} />
        </div>
      )}
      {tools && <div className="dr-filters__tools">{tools}</div>}
    </div>
  );
}

/** Reload, as a quiet chip at the row's end; it turns while a read is out. */
export function Reload({ loading, onReload }) {
  return (
    <button type="button" className="dr-chip wf-reload" onClick={onReload} disabled={loading}
            aria-label={loading ? "Reading" : "Reload"} title="Reload">
      <i className={`ti ti-refresh${loading ? " wf-spin" : ""}`} aria-hidden="true" />
    </button>
  );
}

/** The table in the Staffs card, with the standard pager under it. */
export function WfGrid({ head, pager, label, children }) {
  return (
    <div className="dr-grid-card">
      <div className="dr-grid-scroll">
        <table className="dr-grid wf-grid">
          <thead>
            <tr>{head.map(([h, num]) => <th key={h} className={num ? "dr-num" : undefined}>{h}</th>)}</tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      {pager.pageCount > 1 && <TablePager label={label} pager={pager} />}
    </div>
  );
}

/** What every Workshop row shares: the row is the control that opens it. */
export const rowProps = (selected, open) => ({
  tabIndex: 0,
  className: selected ? "dr-grid__row--selected" : undefined,
  "aria-selected": selected,
  onClick: open,
  onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } },
});

/** The Staffs grid's status badge: a soft fill, a dot and the word. Takes the
 *  Workshop's own pill tones (con, warn, inc, info, none). */
const BADGE = { con: "active", warn: "suspended", inc: "terminated", info: "info", none: "unknown" };
export function Badge({ tone, children }) {
  return (
    <span className={`dr-grid__badge dr-grid__badge--${BADGE[tone] ?? "unknown"}`}>
      <span className="dr-grid__dot" aria-hidden="true" />{children}
    </span>
  );
}

/** The Staffs grid's first cell: the row's name in ink, a grey line under it. */
export function Ident({ name, sub, title }) {
  return (
    <span className="dr-driver__ident" title={title ?? (typeof name === "string" ? name : undefined)}>
      <span className="dr-driver__name">{name}</span>
      {sub && <span className="dr-driver__sub">{sub}</span>}
    </span>
  );
}
