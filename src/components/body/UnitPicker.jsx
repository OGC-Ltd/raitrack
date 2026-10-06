/**
 * Pick one unit of the organisation on screen — a searchable list, not a
 * datalist.
 *
 * The native <datalist> it replaces matched only an exact plate, drew a
 * different list in every browser and barely anything on a phone. This lists
 * the organisation's units as you type and matches the way people type them:
 *
 *   · spaces and case ignored — "ktcc872b" finds KTCC 872B
 *   · plate, unit name, machine name or machine type — "mahindra", "excavator"
 *   · plates that START with what was typed first, then the rest A–Z
 *
 * Up/Down move through the list, Enter picks, Escape closes. A plate that is
 * not in this organisation but is in another one this account may open is
 * offered below the empty list, by name, and picking it switches organisation
 * — the same lookup the Units list uses (hooks/useCrossOrgUnits), but never
 * automatic: the switch is the operator's choice.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useAppSelector, useAppActions, useCompanies } from "../../context/AppContext";
import { useCrossOrgUnits } from "../../hooks/useCrossOrgUnits";
import { fleetType, fleetTypeLabel } from "../../lib/vehicleMap";
import "./UnitPicker.css";

const MAX_SHOWN = 60;
const key = (s) => String(s ?? "").replace(/\s+/g, "").toLowerCase();

/** Units matching `q`, best first. Exported for tests. */
export function matchUnits(vehicles, q) {
  const k = key(q);
  const scored = [];
  for (const v of vehicles ?? []) {
    const plate = key(v.id);
    const name = key(v.name);
    const machine = key(v.machineName);
    const type = key(fleetTypeLabel(fleetType(v)));
    let rank = null;
    if (!k) rank = 3;
    else if (plate.startsWith(k)) rank = 0;
    else if (plate.includes(k)) rank = 1;
    else if (name.includes(k) || machine.includes(k) || type.includes(k)) rank = 2;
    if (rank != null) scored.push({ v, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || String(a.v.id).localeCompare(String(b.v.id)));
  return scored.map((x) => x.v);
}

export default function UnitPicker({ vehicles, value, onChange, placeholder = "Search unit — plate, name or type…" }) {
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const { setActiveCompanyId } = useAppActions();
  const { activeCompany, companies } = useCompanies();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const wrapRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const selected = useMemo(() => (vehicles ?? []).find((v) => v.vehicleId === value) ?? null, [vehicles, value]);
  // The box shows the chosen plate until the operator starts typing again.
  const shown = open ? query : selected ? selected.id : query;

  const matches = useMemo(() => matchUnits(vehicles, query), [vehicles, query]);
  const list = matches.slice(0, MAX_SHOWN);

  // Elsewhere: only asked when this organisation has nothing for the query.
  const { companies: elsewhere, loading: lookingElsewhere } = useCrossOrgUnits({
    query, enabled: open && query.trim().length >= 3 && matches.length === 0,
    activeCompanyId, visibleCompanies: companies,
  });

  // After switching organisation for a plate, pick it once the new fleet is in.
  const pendingPlate = useRef(null);
  useEffect(() => {
    if (!pendingPlate.current) return;
    const hit = (vehicles ?? []).find((v) => key(v.id) === key(pendingPlate.current));
    if (hit) { pendingPlate.current = null; onChange(hit.vehicleId); setQuery(""); }
  }, [vehicles, onChange]);

  // A unit picked in another organisation is not in this one.
  useEffect(() => {
    if (value && vehicles?.length && !selected) onChange(null);
  }, [value, vehicles, selected, onChange]);

  useEffect(() => {
    if (!open) return undefined;
    const down = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener("pointerdown", down);
    return () => document.removeEventListener("pointerdown", down);
  }, [open]);

  useEffect(() => { setHi(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${hi}"]`)?.scrollIntoView({ block: "nearest" });
  }, [hi]);

  const pick = (v) => { onChange(v.vehicleId); setQuery(""); setOpen(false); };
  const onKey = (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setHi((i) => Math.min(i + 1, list.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHi((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter") { if (open && list[hi]) { e.preventDefault(); pick(list[hi]); } }
    else if (e.key === "Escape") { if (open) { e.stopPropagation(); setOpen(false); } }
  };

  return (
    <div className="sp4-search-wrap upk" ref={wrapRef}>
      <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input
        className="sp4-search upk__input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && list[hi] ? `${listId}-${hi}` : undefined}
        aria-label="Unit"
        autoComplete="off"
        spellCheck={false}
        value={shown}
        placeholder={placeholder}
        // Focus keeps what was typed: coming back to the box (a phone switching
        // apps mid-search) must not throw the search away.
        onFocus={(e) => { setOpen(true); e.target.select(); }}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKey}
      />
      {(selected || query) && (
        <button type="button" className="sp4-search-clear" aria-label="Clear unit"
                onClick={() => { onChange(null); setQuery(""); setOpen(true); }}>✕</button>
      )}

      {open && (
        <div className="upk__panel">
          <div className="upk__head">
            {activeCompany?.short || activeCompany?.name || "This organisation"}
            <span>{query ? `${matches.length} of ${vehicles?.length ?? 0}` : `${vehicles?.length ?? 0} units`}</span>
          </div>
          <ul className="upk__list" id={listId} role="listbox" ref={listRef}>
            {list.map((v, i) => (
              <li
                key={v.vehicleId ?? v.id}
                id={`${listId}-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === hi}
                className={`upk__opt${i === hi ? " upk__opt--hi" : ""}${v.vehicleId === value ? " upk__opt--on" : ""}`}
                onPointerDown={(e) => e.preventDefault()}
                onPointerEnter={() => setHi(i)}
                onClick={() => pick(v)}
              >
                <span className={`upk__dot${v.online ? " upk__dot--on" : ""}`} title={v.online ? "Online" : "Offline"} />
                <span className="upk__plate">{v.id}</span>
                <span className="upk__name">{v.machineName || v.name || ""}</span>
                <span className="upk__type">{fleetTypeLabel(fleetType(v))}</span>
              </li>
            ))}
            {matches.length > MAX_SHOWN && (
              <li className="upk__more">{matches.length - MAX_SHOWN} more — keep typing to narrow</li>
            )}
            {matches.length === 0 && (
              <li className="upk__empty">
                {lookingElsewhere
                  ? "Checking your other organisations…"
                  : elsewhere.length === 0
                    ? `No unit in ${activeCompany?.short || "this organisation"} matches “${query}”.`
                    : (
                      <>
                        <span>Not in {activeCompany?.short || "this organisation"}. Found in:</span>
                        {elsewhere.map(({ company, units }) => (
                          <button
                            key={company.id}
                            type="button"
                            className="upk__elsewhere"
                            onClick={() => {
                              pendingPlate.current = units[0].plate;
                              setActiveCompanyId(company.id);
                              setOpen(false);
                            }}
                            title={`Switch to ${company.name} and pick ${units[0].plate}`}
                          >
                            <b>{company.short || company.name}</b>
                            <span>{units.slice(0, 3).map((u) => u.plate).join(", ")}{units.length > 3 ? ` +${units.length - 3}` : ""}</span>
                          </button>
                        ))}
                      </>
                    )}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
