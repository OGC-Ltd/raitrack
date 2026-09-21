/**
 * The spare-part chooser.
 *
 * ## Why this is not a `<select>` any more
 *
 * It was one, and the native control was the wrong instrument for this list
 * for a reason no amount of CSS reaches: the OPTION POPUP is painted by the
 * browser, outside the page, and takes none of the panel's tokens. On a
 * near-black dialog it opened a light-grey scrolling column with a Windows
 * highlight bar, 23 rows long, spilling past the dialog it belonged to. The
 * two `<optgroup>` headings survived; nothing else about it did.
 *
 * The deeper problem was the length. Twenty-two parts plus an escape hatch is
 * exactly the size where scanning stops working and searching starts — and a
 * native select's only search is first-letter matching, which for a list where
 * five names begin with "Tracker" and three with "Probe" is no search at all.
 *
 * So: an editable combobox over the same catalogue. Typing FILTERS. The
 * ranking `sparesFor()` already computes is kept as two real groups, and the
 * groups collapse as the query narrows, so a technician who types "float" sees
 * one row rather than a heading over an empty list.
 *
 * ## The free-text escape is now the last row, not a second field
 *
 * The old flow was: choose "Other — not on this list", a new input appears
 * below, autofocus into it, type the name. Three stops. Here the query box IS
 * the free-text box — type something the catalogue does not have and the last
 * row offers to use exactly what was typed. One stop, and the typed name and
 * the search share a box, which is the only reason a technician would ever
 * discover that searching works.
 *
 * It must still be COMMITTED — clicked, or Enter on the row. A query left
 * sitting in the box is not an answer, and `incompleteReason` in the form
 * still says so. That row is only offered when the query has non-space
 * content, which is what makes "chose Other but named nothing" unreachable
 * rather than merely guarded.
 *
 * ## What it does NOT do
 *
 * No portal. The list is absolutely positioned inside the dialog's scrolling
 * body and flips above the field when there is more room there — measured
 * against the SCROLL CONTAINER, not the viewport, because the container is
 * what would clip it. A portal would escape the theme class this inherits and
 * re-introduce the problem the native popup had.
 *
 * No stylesheet of its own; every class here is SensorPanel's.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { listSpareParts, sparesFor, OTHER_PART } from "../../api/spareParts";

/** Room the list asks for, and the least it will accept before flipping. */
const WANT = 264;
const FLOOR = 112;

/**
 * The nearest ancestor that actually scrolls.
 *
 * This is the element that would clip the list, so it is the one the flip is
 * measured against. In the report dialog it is `.sp4-modal-body`; if this
 * picker is ever used somewhere that does not scroll, the walk falls off the
 * top and placement falls back to the viewport.
 */
function scrollParentOf(el) {
  for (let n = el?.parentElement; n; n = n.parentElement) {
    const oy = getComputedStyle(n).overflowY;
    if (oy === "auto" || oy === "scroll") return n;
  }
  return null;
}

export default function SparePartPicker({
  value,
  otherText = "",
  channels,
  labelId,
  disabled = false,
  loading = false,
  invalid = false,
  autoFocus = false,
  onChange,
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState({ up: false, max: WANT });

  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const uid = useId();
  const listId = `${uid}-list`;
  const optId = (i) => `${uid}-opt-${i}`;

  /** What is currently chosen, as the technician would read it back. */
  const chosen = useMemo(() => {
    if (value === OTHER_PART) return otherText;
    if (!value) return "";
    return listSpareParts().find((p) => p.id === value)?.name ?? "";
  }, [value, otherText]);

  /*
   * The list, grouped for rendering and flat for the keyboard.
   *
   * Both shapes are built in one pass so an option's flat index is assigned
   * where the option is created — an index looked up afterwards by key is the
   * kind of thing that quietly goes wrong the first time two rows share one.
   */
  const { groups, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (p) => q === "" || p.name.toLowerCase().includes(q);
    const { likely, others } = sparesFor(channels);

    const gs = [];
    const fl = [];
    const add = (label, parts) => {
      const keep = parts.filter(hit);
      if (keep.length === 0) return;
      const opts = keep.map((p) => {
        const o = { key: p.id, kind: "part", part: p, i: fl.length };
        fl.push(o);
        return o;
      });
      gs.push({ label, opts });
    };

    // No label when there is nothing to rank by: a lone "Other sensor parts"
    // heading over the whole catalogue claims a distinction that isn't there.
    if (likely.length > 0) {
      add("Likely for this fault", likely);
      add("Other sensor parts", others);
    } else {
      add(null, others);
    }

    const typed = query.trim();
    const known = listSpareParts().some((p) => p.name.toLowerCase() === typed.toLowerCase());
    if (typed !== "" && !known) {
      const o = { key: "__typed__", kind: "other", text: typed, i: fl.length };
      fl.push(o);
      gs.push({ label: null, opts: [o] });
    }
    return { groups: gs, flat: fl };
  }, [query, channels]);

  /* The active row must stay inside a list that re-filters on every keystroke.
     Clamping to 0 rather than to the old index: after a narrowing keystroke
     the first surviving row is what the technician is looking at. */
  useEffect(() => { setActive(0); }, [query]);

  /* Placement, re-measured whenever the container moves under it. Scrolling
     the dialog body while the list is open is the ordinary case — the list is
     anchored to a field that is itself moving. */
  useLayoutEffect(() => {
    if (!open) return undefined;
    const field = inputRef.current;
    if (!field) return undefined;
    const box = scrollParentOf(field);

    const measure = () => {
      const f = field.getBoundingClientRect();
      const top = box ? box.getBoundingClientRect().top : 0;
      const bottom = box ? box.getBoundingClientRect().bottom : window.innerHeight;
      const below = bottom - f.bottom - 8;
      const above = f.top - top - 8;
      // Down unless up is genuinely roomier — a list that flips for a few
      // pixels' gain reads as a glitch rather than as a decision.
      const up = below < Math.min(WANT, FLOOR) && above > below;
      setPlace({ up, max: Math.max(FLOOR, Math.min(WANT, up ? above : below)) });
    };

    measure();
    box?.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      box?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [open]);

  /* Keep the active row visible. `block: "nearest"` scrolls the list and
     nothing else — `center` would drag the dialog body along with it. */
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`#${CSS.escape(optId(active))}`)
      ?.scrollIntoView({ block: "nearest" });
  });

  /* A press outside closes the list and leaves the value alone. mousedown, not
     click, so the list is gone before whatever was pressed reacts. */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function show() {
    if (disabled || loading) return;
    // The query starts empty every time, so the whole list is there to scan;
    // what was already chosen shows as the placeholder and as the ticked row.
    setQuery("");
    setOpen(true);
  }

  function commit(o) {
    if (o.kind === "part") onChange?.({ sparePartId: o.part.id, sparePartOther: "" });
    else onChange?.({ sparePartId: OTHER_PART, sparePartOther: o.text });
    setOpen(false);
    setQuery("");
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (disabled || loading) return;
    const n = flat.length;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { show(); return; }
      if (n === 0) return;
      setActive((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
      return;
    }
    if (open && (e.key === "Home" || e.key === "End")) {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : Math.max(0, n - 1));
      return;
    }
    if (e.key === "Enter") {
      // Only ever swallowed while the list is open — otherwise Enter in this
      // field is the form's to handle, like every other field in the dialog.
      if (!open) return;
      e.preventDefault();
      if (flat[active]) commit(flat[active]);
      return;
    }
    if (e.key === "Escape" && open) {
      /* The dialog closes on Escape, and arms a discard when there is typed
         work. While this list is open, Escape belongs to the list — the old
         native select swallowed it for us, and the comment in
         RepairReportForm that said so is only true because of this line. */
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      return;
    }
    if (e.key === "Tab" && open) setOpen(false);
  }

  const state = loading ? "loading" : invalid ? "error" : chosen ? "success" : "";

  return (
    <div className="sp4-pick" ref={rootRef}>
      <div className="sp4-pick-field" data-state={state} data-open={open ? "true" : undefined}>
        <input
          ref={inputRef}
          className="sp4-pick-input"
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && flat[active] ? optId(active) : undefined}
          aria-autocomplete="list"
          aria-labelledby={labelId}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          spellCheck="false"
          disabled={disabled || loading}
          /* Revealed by the outcome chip, so the cursor belongs in it. */
          autoFocus={autoFocus}
          value={open ? query : chosen}
          placeholder={loading ? "Loading parts…"
            : chosen || "Search parts, or type a part we don't list"}
          onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
          onMouseDown={() => { if (!open) show(); }}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          className="sp4-pick-caret"
          tabIndex={-1}
          aria-hidden="true"
          disabled={disabled || loading}
          onMouseDown={(e) => {
            e.preventDefault();
            if (open) setOpen(false); else { show(); inputRef.current?.focus(); }
          }}
        >
          <svg viewBox="0 0 12 8" width="11" height="8" focusable="false">
            <path d="M1 1.5 6 6.5l5-5" fill="none" stroke="currentColor"
                  strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {open && (
        <div
          className={"sp4-pick-list" + (place.up ? " sp4-pick-list--up" : "")}
          style={{ maxHeight: place.max }}
          id={listId}
          role="listbox"
          ref={listRef}
        >
          {/* There is no empty state, and there cannot be one: an empty query
              matches all twenty-two, and a query that matches nothing is by
              definition not a catalogue name, so the "use what you typed" row
              is offered instead. The list is never empty while it is open. */}
          {groups.map((g, gi) => (
            <div
              className="sp4-pick-group"
              role={g.label ? "group" : "presentation"}
              aria-label={g.label ?? undefined}
              key={g.label ?? `g${gi}`}
            >
              {g.label && <p className="sp4-pick-grouphead" aria-hidden="true">{g.label}</p>}
              {g.opts.map((o) => {
                const isChosen = o.kind === "part"
                  ? o.part.id === value
                  : value === OTHER_PART && o.text === otherText;
                return (
                  <div
                    key={o.key}
                    id={optId(o.i)}
                    role="option"
                    aria-selected={isChosen}
                    className={"sp4-pick-opt"
                      + (o.i === active ? " sp4-pick-opt--active" : "")
                      + (isChosen ? " sp4-pick-opt--on" : "")
                      + (o.kind === "other" ? " sp4-pick-opt--new" : "")}
                    /* mousedown, not click: the input must not lose focus to
                       the row on its way to being chosen. */
                    onMouseDown={(e) => { e.preventDefault(); commit(o); }}
                    onMouseEnter={() => setActive(o.i)}
                  >
                    <span className="sp4-pick-tick" aria-hidden="true">{isChosen ? "✓" : ""}</span>
                    {o.kind === "part"
                      ? <Marked text={o.part.name} q={query.trim()} />
                      : <span>Use “<b>{o.text}</b>” — not in the catalogue</span>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The matched run, in bold.
 *
 * Weight rather than a highlight colour: a background swatch inside a row that
 * already has a hover fill and an active fill is a third competing surface,
 * and it is unreadable on whichever of the two themes it was not tuned for.
 */
function Marked({ text, q }) {
  if (q === "") return <span>{text}</span>;
  const at = text.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <b className="sp4-pick-hit">{text.slice(at, at + q.length)}</b>
      {text.slice(at + q.length)}
    </span>
  );
}
