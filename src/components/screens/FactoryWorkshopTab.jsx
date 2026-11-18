/**
 * Workshop › Auto Workshop (KASULU): FactorySuite's workshop as it stands.
 *
 * The cards themselves are worked as repair jobs on the Jobs tab (the server
 * feeds them into the workflow: fleet-server factorysuite-workshop.sync). This
 * tab is the workshop floor: which machines are in, for how long, what they
 * wait on, and the stores' stock. A row opens the repair job it runs under.
 *
 * Laid out as the Alerts page (operator, 2026-11-18): the stats strip on top,
 * then the count and its actions, then search and the filter chips, then the
 * list. The strip is the workshop's, so it stays put on both views.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { REPAIRS_CHANGED, STAGE_LABEL, STAGE_PILL } from "../../api/repairs";
import { fetchFactoryBoard, fetchStoresParts, CARD_STATUS, CARD_SOURCE, shortCard } from "../../api/repairWorkflow";
import TableToolbar from "../body/TableToolbar";
import FilterBar from "../body/FilterBar";
import EmptyNote from "../shared/EmptyNote";
import { at } from "../body/RepairWorkflowJob";
import WorkshopStrip, { STATES, stateOf } from "./WorkshopStrip";

function useRead(fn, deps) {
  const [s, setS] = useState({ data: null, loading: true, error: null });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const read = useCallback(() => {
    setS((p) => ({ ...p, loading: true }));
    Promise.resolve(fn())
      .then((data) => setS({ data, loading: false, error: null }))
      .catch((e) => setS((p) => ({ ...p, loading: false, error: e?.message || "Could not load" })));
  }, deps);
  useEffect(() => {
    read();
    window.addEventListener(REPAIRS_CHANGED, read);
    return () => window.removeEventListener(REPAIRS_CHANGED, read);
  }, [read]);
  return { ...s, read };
}

const hoursSince = (iso) => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : null);
const span = (h) => (h == null ? "-" : h < 1 ? `${Math.max(0, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
/** 14 days: the strip's charts compare the last week with the one before. */
const BOARD_DAYS = 14;
const STORES_LIMIT = 200;
const qty = (n) => (n == null ? "-" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: 1 }));
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** One card against the search: machine, plate, card number, fault or diagnosis. */
const cardMatches = (c, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return [c.machine, c.vehicle?.registrationPlate, c.vehicle?.name, c.cardNumber, c.reportedFault, c.diagnosis, c.repairItem?.ticketNo]
    .some((v) => v && String(v).toLowerCase().includes(t));
};

function Chip({ on, onClick, children, n, title }) {
  return (
    <button type="button" className={"sp4-filter-chip" + (on ? " sp4-filter-chip--on" : "")}
            aria-pressed={on} onClick={onClick} title={title}>
      {children}
      {n != null && <span className="sys-chip-n">{n}</span>}
    </button>
  );
}

function SearchBox({ value, onChange, placeholder }) {
  return (
    <div className="sp4-search-wrap fsw-search">
      <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
      </svg>
      <input className="sp4-search" type="text" placeholder={placeholder} aria-label={placeholder.replace(/…$/, "")}
             value={value} onChange={(e) => onChange(e.target.value)} />
      {value && <button type="button" className="sp4-search-clear" aria-label="Clear search" onClick={() => onChange("")}>✕</button>}
    </div>
  );
}

function BoardTable({ rows, onOpen, openId }) {
  return (
    <div className="sp4-table-scroll">
      <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable wf-table">
        <thead>
          <tr>
            <th className="sp4-th--left sp4-th--pin">Machine</th>
            <th className="sp4-th--left">Fault</th>
            <th className="sp4-th--left">Card</th>
            <th className="sp4-th--left">Repair job</th>
            <th className="sp4-th--left">Checked in</th>
            <th className="sp4-th--right">In for</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const [label, pill] = CARD_STATUS[c.status] ?? [c.status, "none"];
            const job = c.repairItem;
            const go = () => job && onOpen(job.id);
            return (
              <tr key={c.id} tabIndex={job ? 0 : -1}
                  className={"sp4-tr wf-tr" + (job ? " sp4-tr--incident" : "") + (job && openId === job.id ? " wf-tr--open" : "")}
                  onClick={go}
                  onKeyDown={(e) => { if (job && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); go(); } }}>
                <td className="sp4-td--left sp4-td--pin">
                  <span className="sp4-reg">{c.machine}</span>
                  {c.vehicle?.registrationPlate && c.vehicle.registrationPlate !== c.machine && <span className="wf-cell-sub">{c.vehicle.registrationPlate}</span>}
                </td>
                <td className="sp4-td--left">
                  <span className="wf-cell-fault">{c.reportedFault ?? "-"}</span>
                  {c.diagnosis && <span className="wf-cell-sub">{c.diagnosis}</span>}
                </td>
                <td className="sp4-td--left">
                  <span className="wf-cell-stage">
                    <span className={`sp4-pill sp4-pill--${pill}`}>{label}</span>
                    <span className="wf-cell-sub"><span className="wf-mono">{shortCard(c.cardNumber)}</span>{c.priority === "Urgent" ? ", urgent" : ""}{c.source ? `, ${(CARD_SOURCE[c.source] ?? c.source).toLowerCase()}` : ""}</span>
                  </span>
                </td>
                <td className="sp4-td--left">
                  {job
                    ? <span className="wf-cell-stage"><span className={`sp4-pill sp4-pill--${STAGE_PILL[job.stage] ?? "none"}`}>{STAGE_LABEL[job.stage] ?? job.stage}</span><span className="wf-cell-sub wf-mono">{job.ticketNo ?? ""}</span></span>
                    : <span className="sp4-muted" title="The machine on this card is not one of our tracked units">Not tracked</span>}
                </td>
                <td className="sp4-td--left sys-num">{at(c.checkedInAt)}</td>
                <td className="sp4-td--right sys-num">{span(hoursSince(c.checkedInAt))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StoresTable({ rows }) {
  return (
    <div className="sp4-table-scroll">
      <table className="sp4-table sp4-probe-table wf-table">
        <thead>
          <tr>
            <th className="sp4-th--left sp4-th--pin">Part</th>
            <th className="sp4-th--left">Part number</th>
            <th className="sp4-th--right">On hand</th>
            <th className="sp4-th--right">Minimum</th>
            <th className="sp4-th--left">Unit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="sp4-tr">
              <td className="sp4-td--left sp4-td--pin">{r.description ?? r.partNumber}</td>
              <td className="sp4-td--left"><span className="wf-mono">{r.partNumber}</span></td>
              <td className={"sp4-td--right sys-num" + (r.belowMinimum ? " fsw-low" : "")}>{qty(r.quantityOnHand)}</td>
              <td className="sp4-td--right sys-num">{qty(r.minimumLevel)}</td>
              <td className="sp4-td--left">{r.unit ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FactoryWorkshopTab({ orgId, onOpen, openId }) {
  const [view, setView] = useState("board");
  // Each view keeps its own search: a part number typed in Stores is no machine.
  const [boardQ, setBoardQ] = useState("");
  const [state, setState] = useState("all");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [partsQ, setPartsQ] = useState("");
  const [partsTerm, setPartsTerm] = useState("");
  const [low, setLow] = useState(false);
  useEffect(() => { const t = setTimeout(() => setPartsTerm(partsQ), 250); return () => clearTimeout(t); }, [partsQ]);

  const board = useRead(() => fetchFactoryBoard(orgId, BOARD_DAYS), [orgId]);
  const isStores = view === "stores";
  // Read only once the Stores view is open; the board alone answers the strip.
  const parts = useRead(() => (isStores ? fetchStoresParts(orgId, { q: partsTerm, low, limit: STORES_LIMIT }) : null), [orgId, partsTerm, low, isStores]);

  const open = useMemo(() => board.data?.open ?? [], [board.data]);
  const summary = board.data?.summary;
  const searched = useMemo(() => open.filter((c) => cardMatches(c, boardQ.trim())), [open, boardQ]);
  const urgentPicked = searched.filter((c) => !urgentOnly || c.priority === "Urgent");
  const rows = urgentPicked.filter((c) => state === "all" || stateOf(c) === state);
  const nState = (key) => urgentPicked.filter((c) => key === "all" || stateOf(c) === key).length;
  const nUrgent = searched.filter((c) => (state === "all" || stateOf(c) === state) && c.priority === "Urgent").length;
  const waiting = open.filter((c) => stateOf(c) === "parts").length;
  const partRows = parts.data ?? [];

  const activeCount = isStores
    ? (low ? 1 : 0)
    : (state !== "all" ? 1 : 0) + (urgentOnly ? 1 : 0);
  const narrowed = !!boardQ.trim() || state !== "all" || urgentOnly;

  return (
    <div className="fsw-tab">
      <WorkshopStrip open={open} summary={summary} loading={board.loading && !board.data} />

      <TableToolbar
        summary={isStores ? (
          <><b>{partRows.length}</b> {plural(partRows.length, "part")}{partsTerm ? <> matching “{partsTerm}”</> : null}{low ? " below minimum" : ""}{partRows.length >= STORES_LIMIT ? ", the first 200" : ""}</>
        ) : narrowed ? (
          <><b>{rows.length}</b> of {open.length} {plural(open.length, "machine")} in the workshop</>
        ) : (
          <><b>{open.length}</b> {plural(open.length, "machine")} in the workshop{waiting ? <>, <b>{waiting}</b> awaiting parts</> : null}</>
        )}
        loading={isStores ? parts.loading : board.loading}
        onReload={() => { board.read(); if (isStores) parts.read(); }}
      />

      <FilterBar
        label="Filters"
        activeCount={activeCount}
        peek={isStores
          ? <SearchBox value={partsQ} onChange={setPartsQ} placeholder="Search a part number or description…" />
          : <SearchBox value={boardQ} onChange={setBoardQ} placeholder="Search a machine, card or fault…" />}
      >
        <div className="sp4-filter-group fsw-group" role="group" aria-label="View">
          <span className="sp4-filter-label">View</span>
          <Chip on={!isStores} onClick={() => setView("board")} n={open.length}>In the workshop</Chip>
          <Chip on={isStores} onClick={() => setView("stores")}>Stores</Chip>
        </div>
        {isStores ? (
          <div className="sp4-filter-group fsw-group" role="group" aria-label="Stock">
            <span className="sp4-filter-label">Stock</span>
            <Chip on={!low} onClick={() => setLow(false)}>All</Chip>
            <Chip on={low} onClick={() => setLow(true)}>Below minimum</Chip>
          </div>
        ) : (
          <>
            <div className="sp4-filter-group fsw-group" role="group" aria-label="State">
              <span className="sp4-filter-label">State</span>
              <Chip on={state === "all"} onClick={() => setState("all")} n={nState("all")}>All</Chip>
              {STATES.map((s) => (
                <Chip key={s.key} on={state === s.key} onClick={() => setState(s.key)} n={nState(s.key)}>{s.label}</Chip>
              ))}
            </div>
            <div className="sp4-filter-group fsw-group" role="group" aria-label="Priority">
              <span className="sp4-filter-label">Priority</span>
              <Chip on={!urgentOnly} onClick={() => setUrgentOnly(false)}>Any</Chip>
              <Chip on={urgentOnly} onClick={() => setUrgentOnly(true)} n={nUrgent}>Urgent</Chip>
            </div>
          </>
        )}
      </FilterBar>

      {isStores ? (
        <>
          <p className="wf-muted fsw-note">Stock as FactorySuite last counted it, read every hour. FactorySuite serves at most 1,000 parts, so a part can be missing here.</p>
          {partRows.length === 0 && parts.loading ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Stores">Parts and stock from FactorySuite.</EmptyNote>
          ) : partRows.length === 0 && parts.error ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="The Stores Could Not Be Loaded" action={{ label: "Try again", onClick: parts.read }}>{parts.error}</EmptyNote>
          ) : partRows.length === 0 ? (
            <EmptyNote icon="ti-search" title="No Parts">{partsTerm || low ? "Nothing matches." : "FactorySuite has sent no parts yet."}</EmptyNote>
          ) : (
            <StoresTable rows={partRows} />
          )}
        </>
      ) : open.length === 0 && board.loading ? (
        <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Workshop">Job cards open in FactorySuite.</EmptyNote>
      ) : open.length === 0 && board.error ? (
        <EmptyNote icon="ti-alert-triangle" tone="error" title="The Workshop Could Not Be Loaded" action={{ label: "Try again", onClick: board.read }}>{board.error}</EmptyNote>
      ) : open.length === 0 ? (
        <EmptyNote icon="ti-circle-check" title="Nothing in the Workshop">No job card is open in FactorySuite.</EmptyNote>
      ) : rows.length === 0 ? (
        <EmptyNote icon="ti-search" title="No Machines Match"
                   action={{ label: "Clear the filters", onClick: () => { setBoardQ(""); setState("all"); setUrgentOnly(false); } }}>
          Nothing in the workshop matches the search and filters picked.
        </EmptyNote>
      ) : (
        <BoardTable rows={rows} onOpen={onOpen} openId={openId} />
      )}
    </div>
  );
}
