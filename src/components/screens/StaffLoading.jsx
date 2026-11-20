/**
 * The Staffs page while its first read is out (operator, 2026-11-20: "on the
 * staff page the loading should be well handled"). One placeholder for every
 * tab that has a strip and a roster (Analytics, Operators, Supervisors): the
 * strip's four cells and the roster's rows drawn as quiet bars, in the frames
 * the real ones take, so nothing jumps when the figures land. It replaces the
 * old "Loading…" in each cell and the empty table that said "No drivers
 * match" before anyone had been read.
 *
 * Only the first read: a later one (a new period, a refetch) keeps the figures
 * on screen until the new ones arrive.
 */
import "./DriversScreen.css";
import "./StaffLoading.css";

const ROWS = 8;
// Different widths per row, so the bars read as names and not as a pattern.
const NAME_W = [148, 112, 164, 126, 140, 104, 158, 120];

function Cell({ chart }) {
  return (
    <div className="dr-cell stf-cell">
      <span className="stf-bar stf-bar--label" />
      <span className="stf-bar stf-bar--figure" />
      <span className="stf-bar stf-bar--caption" />
      {chart && <span className="stf-bar stf-bar--chart" />}
    </div>
  );
}

/**
 * @param {{ what: string, cols?: number, filters?: React.ReactNode }} props
 *   `what` names who is being read ("drivers", "operators"), for the screen
 *   reader's line; `cols` the roster's columns after the name; `filters` the
 *   tab's own controls that work before the read is back (the period picker).
 */
export default function StaffLoading({ what, cols = 6, filters = null }) {
  return (
    <div className="stf-load" role="status" aria-live="polite">
      <span className="stf-sr">Loading the {what}</span>
      <div className="dr-layout" aria-hidden="true">
        <section className="dr-strip">
          <Cell />
          <Cell chart />
          <Cell chart />
          <Cell />
        </section>
      </div>
      {filters && <div className="dr-filters">{filters}</div>}
      <div className="dr-grid-card" aria-hidden="true">
        <ul className="stf-rows">
          {Array.from({ length: ROWS }, (_, i) => (
            <li key={i} className="stf-row" style={{ "--stf-cols": cols }}>
              <span className="stf-avatar" />
              <span className="stf-name">
                <span className="stf-bar" style={{ width: `${NAME_W[i % NAME_W.length]}px` }} />
                <span className="stf-bar stf-bar--sub" />
              </span>
              {Array.from({ length: cols }, (_, j) => (
                <span key={j} className="stf-bar stf-bar--num" />
              ))}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
