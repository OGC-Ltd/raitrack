/**
 * The Staffs page while its first read is out (operator, 2026-11-20: "on the
 * staff page the loading should be well handled"; 2026-11-21: "keep the
 * circular loader and also implement the circular loader on the staffs page").
 * The Workshop's loader, the turning ring of EmptyNote's busy state, in the
 * roster's card, for every tab that has one (Analytics, Operators,
 * Supervisors). The tab's own controls that work before the read is back (the
 * period picker) stay above it.
 *
 * Only the first read: a later one (a new period, a refetch) keeps the figures
 * on screen until the new ones arrive.
 */
import "./DriversScreen.css";
import "./StaffLoading.css";
import EmptyNote from "../shared/EmptyNote";

const cap = (w) => w.replace(/\b\w/g, (c) => c.toUpperCase());

/** The ring and its line, in the Staffs page's tokens. Also used by the Scorecard's grid. */
export function StaffSpinner({ what }) {
  return (
    <div className="stf-load">
      <EmptyNote icon="ti-loader-2" tone="busy" title={`Reading the ${cap(what)}`} />
    </div>
  );
}

/**
 * @param {{ what: string, filters?: React.ReactNode }} props
 *   `what` names who is being read ("drivers", "operators"); `filters` the
 *   tab's own controls that work before the read is back.
 */
export default function StaffLoading({ what, filters = null }) {
  return (
    <div className="dr-layout">
      {filters && <div className="dr-filters">{filters}</div>}
      <div className="dr-grid-card">
        <StaffSpinner what={what} />
      </div>
    </div>
  );
}
