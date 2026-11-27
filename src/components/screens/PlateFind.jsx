/*
 * Find a unit by its plate, above a report's table, as Trips › Movements has it
 * (its mvr-find styles): narrows the rows shown, with the count on the right.
 */

export default function PlateFind({ value, onChange, shown, total, noun = 'row', follows = 'The PDF follows the search.', placeholder = 'Find a unit by plate, e.g. KCB 101A', label = 'Find a unit by its registration plate', none = 'No unit matches that plate.' }) {
  return (
    <div className="mvr-find">
      <div className="sp4-search-wrap mvr-find__box">
        <i className="ti ti-search sp4-search-icon" aria-hidden="true" />
        <input className="sp4-search" type="search" value={value} placeholder={placeholder}
               aria-label={label} onChange={(e) => onChange(e.target.value)} />
        {value && <button type="button" className="sp4-search-clear" aria-label="Clear the search" onClick={() => onChange('')}>✕</button>}
      </div>
      {value.trim() && (
        <span className={`mvr-find__note${shown ? '' : ' mvr-find__note--none'}`} role="status">
          {shown ? `${shown.toLocaleString('en-GB')} of ${total.toLocaleString('en-GB')} ${noun}s shown. ${follows}` : none}
        </span>
      )}
    </div>
  );
}
