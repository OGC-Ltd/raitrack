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
import { REPAIRS_CHANGED } from "../../api/repairs";
import { fetchFactoryBoard, fetchStoresParts, CARD_STATUS, shortCard } from "../../api/repairWorkflow";
import { usePager } from "../body/TablePager";
import { WfFilters, WfGrid, Reload, rowProps, Badge, Ident } from "./WorkshopParts";
import EmptyNote from "../shared/EmptyNote";
import { at } from "../body/RepairWorkflowJob";
import WorkshopStrip, { STATES, stateOf, backByOf, pastEta, REPAIR_KIND } from "./WorkshopStrip";

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
const BACK_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const BACK_DATE = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short" });

/** The ETA cell: past it by how long, or due in how long; and where the date came from. */
function BackBy({ card }) {
  const b = backByOf(card);
  if (!b) return <span className="sp4-muted">-</span>;
  const h = (b.at.getTime() - Date.now()) / 3_600_000;
  const when = b.set ? BACK_DATE.format(b.at) : BACK_DAY.format(b.at);
  const kind = (REPAIR_KIND[card.category]?.[0] ?? "minor").toLowerCase();
  return (
    <span className="wf-cell-stage" title={b.set ? "The date set on the repair job" : `No date set: the usual stay for a ${kind} repair`}>
      {h < 0 ? <Badge tone="inc">Overdue {span(-h)}</Badge> : <Badge tone="none">Due in {span(h)}</Badge>}
      <span className="wf-cell-sub">{when}{b.set ? "" : ", usual"}</span>
    </span>
  );
}
const span = (h) => (h == null ? "-" : h < 1 ? `${Math.max(0, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);
/** 14 days: the strip's charts compare the last week with the one before. */
const BOARD_DAYS = 14;
const STORES_LIMIT = 1000;
const qty = (n) => (n == null ? "-" : Number(n).toLocaleString("en-GB", { maximumFractionDigits: 1 }));
const plural = (n, one, many = `${one}s`) => (n === 1 ? one : many);

/** One card against the search: machine, plate, card number, fault or diagnosis. */
const cardMatches = (c, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return [c.machine, c.vehicle?.registrationPlate, c.vehicle?.name, c.cardNumber, c.reportedFault, c.diagnosis, c.repairItem?.ticketNo]
    .some((v) => v && String(v).toLowerCase().includes(t));
};

function BoardTable({ rows, onOpen, openId, resetKey }) {
  const pager = usePager(rows, resetKey);
  return (
    <WfGrid label="Machine pages" pager={pager}
            head={[["Machine"], ["Fault"], ["Repair"], ["Priority"], ["Ticket"], ["Status"], ["In for", true], ["ETA"]]}>
          {pager.pageRows.map((c) => {
            const [label, pill] = CARD_STATUS[c.status] ?? [c.status, "none"];
            const job = c.repairItem;
            const go = () => job && onOpen(job.id);
            return (
              <tr key={c.id} {...(job ? rowProps(openId === job.id, go) : { tabIndex: -1, className: "wf-row--still" })}>
                <td>
                  <Ident name={c.machine} sub={c.vehicle?.registrationPlate && c.vehicle.registrationPlate !== c.machine ? c.vehicle.registrationPlate : null} />
                </td>
                <td title={[c.reportedFault, c.diagnosis].filter(Boolean).join("\n") || undefined}>
                  <span className="wf-cell-fault wf-cell-fault--short">{c.reportedFault ?? "-"}</span>
                  {c.diagnosis && <span className="wf-cell-sub wf-cell-fault--short">{c.diagnosis}</span>}
                </td>
                <td>{c.category ? <Badge tone={REPAIR_KIND[c.category]?.[1] ?? "none"}>{REPAIR_KIND[c.category]?.[0] ?? c.category}</Badge> : <span className="sp4-muted">-</span>}</td>
                <td>{c.priority === "Urgent" ? <Badge tone="inc">Urgent</Badge> : <span className="sp4-muted">{c.priority ? c.priority.charAt(0) + c.priority.slice(1).toLowerCase() : "-"}</span>}</td>
                <td><span className="dr-veh" title={c.cardNumber}>{shortCard(c.cardNumber)}</span></td>
                <td><Badge tone={pill}>{label}</Badge></td>
                <td className="dr-num sys-num">
                  <span className="wf-cell-stage wf-cell-stage--end">
                    <span>{span(hoursSince(c.checkedInAt))}</span>
                    <span className="wf-cell-sub" title={at(c.checkedInAt)}>since {c.checkedInAt ? BACK_DATE.format(new Date(c.checkedInAt)) : "-"}</span>
                  </span>
                </td>
                <td><BackBy card={c} /></td>
              </tr>
            );
          })}
    </WfGrid>
  );
}

/** East Africa day of a time, for grouping the moves: "2026-11-21". */
const EAT_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" });
const eatDay = (iso) => (iso ? EAT_DAY.format(new Date(iso)) : "");
const hoursBetween = (a, b) => (a && b ? (new Date(b).getTime() - new Date(a).getTime()) / 3_600_000 : null);

/** A move against the search: machine, plate, card number or fault. */
const moveMatches = (m, term) => {
  if (!term) return true;
  const t = term.toLowerCase();
  return [m.machine, m.vehicle?.registrationPlate, m.vehicle?.name, m.cardNumber, m.reportedFault]
    .some((v) => v && String(v).toLowerCase().includes(t));
};

/**
 * Every booking into the workshop and every release, newest first, as
 * FactorySuite's webhook reports them (the server re-reads the cards on each
 * jobcard event). A booked row says whether that machine is out yet; a
 * released row says how long it was in.
 */
function MovesTable({ rows, resetKey }) {
  const pager = usePager(rows, resetKey);
  return (
    <WfGrid label="Move pages" pager={pager}
            head={[["When"], ["Move"], ["Machine"], ["Fault"], ["Card"], ["Now"]]}>
          {pager.pageRows.map((m) => {
            const booked = m.kind === "booked";
            const out = !!m.releasedAt;
            const [label, pill] = CARD_STATUS[m.status] ?? [m.status, "none"];
            return (
              <tr key={`${m.kind}-${m.cardId}`} className="wf-row--still">
                <td className="sys-num">{at(m.at)}</td>
                <td><Badge tone={booked ? "warn" : "con"}>{booked ? "Booked in" : "Released"}</Badge></td>
                <td>
                  <Ident name={m.machine} sub={m.vehicle?.registrationPlate && m.vehicle.registrationPlate !== m.machine ? m.vehicle.registrationPlate : null} />
                </td>
                <td title={m.reportedFault || undefined}><span className="wf-cell-fault wf-cell-fault--short">{m.reportedFault ?? "-"}</span></td>
                <td><span className="dr-veh">{shortCard(m.cardNumber)}</span></td>
                <td>
                  {out
                    ? <span className="wf-cell-stage"><span>Out</span><span className="wf-cell-sub">after {span(hoursBetween(m.checkedInAt, m.releasedAt))} in</span></span>
                    : <span className="wf-cell-stage"><Badge tone={pill}>{label}</Badge><span className="wf-cell-sub">in for {span(hoursSince(m.checkedInAt))}</span></span>}
                </td>
              </tr>
            );
          })}
    </WfGrid>
  );
}

/** Where a part's stock stands: none, under its minimum, or enough. */
const stockOf = (r) => ((r.quantityOnHand ?? 0) <= 0 ? ["Out of stock", "inc"]
  : r.belowMinimum ? ["Below minimum", "warn"] : ["In stock", "con"]);

/**
 * One row a part, in the same cells as the board beside it: the part number
 * where the machine sits, the description where the fault sits (clipped, in
 * full on hover), the stock state as a pill with how far short under it, as
 * the card's status carries its number, then the two quantities.
 */
function StoresTable({ rows, resetKey }) {
  const pager = usePager(rows, resetKey);
  return (
    <WfGrid label="Part pages" pager={pager}
            head={[["Part number"], ["Description"], ["Stock"], ["On hand", true], ["Minimum", true], ["Unit"]]}>
          {pager.pageRows.map((r) => {
            const name = r.description?.trim();
            const [state, pill] = stockOf(r);
            const short = r.minimumLevel != null ? r.minimumLevel - (r.quantityOnHand ?? 0) : null;
            return (
              <tr key={r.id} className="wf-row--still">
                <td><Ident name={r.partNumber} /></td>
                <td title={name || undefined}>
                  {name && name !== r.partNumber ? <span className="wf-cell-fault">{name}</span> : <span className="sp4-muted">-</span>}
                </td>
                <td>
                  <span className="wf-cell-stage">
                    <Badge tone={pill}>{state}</Badge>
                    {pill !== "con" && short > 0 && <span className="wf-cell-sub">{qty(short)} short of the minimum</span>}
                  </span>
                </td>
                <td className="dr-num sys-num">{qty(r.quantityOnHand)}</td>
                <td className="dr-num sys-num">{qty(r.minimumLevel)}</td>
                <td>{r.unit ?? "-"}</td>
              </tr>
            );
          })}
    </WfGrid>
  );
}

export default function FactoryWorkshopTab({ orgId, onOpen, openId }) {
  const [view, setView] = useState("board");
  // Each view keeps its own search: a part number typed in Stores is no machine.
  const [boardQ, setBoardQ] = useState("");
  const [state, setState] = useState("all");
  const [urgentOnly, setUrgentOnly] = useState(false);
  const [lateOnly, setLateOnly] = useState(false);
  const [kind, setKind] = useState("any");
  const [partsQ, setPartsQ] = useState("");
  const [partsTerm, setPartsTerm] = useState("");
  const [low, setLow] = useState(false);
  const [movesQ, setMovesQ] = useState("");
  const [moveKind, setMoveKind] = useState("all");
  const [movePeriod, setMovePeriod] = useState("today");
  useEffect(() => { const t = setTimeout(() => setPartsTerm(partsQ), 250); return () => clearTimeout(t); }, [partsQ]);

  const board = useRead(() => fetchFactoryBoard(orgId, BOARD_DAYS), [orgId]);
  const isStores = view === "stores";
  // Read only once the Stores view is open; the board alone answers the strip.
  const parts = useRead(() => (isStores ? fetchStoresParts(orgId, { q: partsTerm, low, limit: STORES_LIMIT }) : null), [orgId, partsTerm, low, isStores]);

  const open = useMemo(() => board.data?.open ?? [], [board.data]);
  const summary = board.data?.summary;
  const searched = useMemo(() => open.filter((c) => cardMatches(c, boardQ.trim())), [open, boardQ]);
  const kindOk = (c) => kind === "any" || c.category === kind;
  const urgentPicked = searched.filter((c) => (!urgentOnly || c.priority === "Urgent") && (!lateOnly || pastEta(c)) && kindOk(c));
  const rows = urgentPicked.filter((c) => state === "all" || stateOf(c) === state);
  const nState = (key) => urgentPicked.filter((c) => key === "all" || stateOf(c) === key).length;
  const stateOk = (c) => state === "all" || stateOf(c) === state;
  const nUrgent = searched.filter((c) => stateOk(c) && c.priority === "Urgent" && (!lateOnly || pastEta(c)) && kindOk(c)).length;
  const nLate = searched.filter((c) => stateOk(c) && pastEta(c) && (!urgentOnly || c.priority === "Urgent") && kindOk(c)).length;
  const nRepair = (k) => searched.filter((c) => stateOk(c) && (!urgentOnly || c.priority === "Urgent") && (!lateOnly || pastEta(c)) && c.category === k).length;
  const late = open.filter((c) => pastEta(c)).length;
  const waiting = open.filter((c) => stateOf(c) === "parts").length;
  const partRows = parts.data ?? [];

  const narrowed = !!boardQ.trim() || state !== "all" || urgentOnly || lateOnly || kind !== "any";

  // Booked and released: today (East Africa) or the board's whole window.
  const isMoves = view === "moves";
  const today = eatDay(new Date().toISOString());
  const periodMoves = useMemo(() => (board.data?.moves ?? []).filter((m) => movePeriod !== "today" || eatDay(m.at) === today), [board.data, movePeriod, today]);
  const movesSearched = periodMoves.filter((m) => moveMatches(m, movesQ.trim()));
  const moveRows = movesSearched.filter((m) => moveKind === "all" || m.kind === moveKind);
  const nKind = (k) => movesSearched.filter((m) => k === "all" || m.kind === k).length;
  const bookedHere = periodMoves.filter((m) => m.kind === "booked");
  const bookedOut = bookedHere.filter((m) => m.releasedAt).length;
  const periodWords = movePeriod === "today" ? "today" : `in the last ${BOARD_DAYS} days`;

  return (
    <div className="fsw-tab">
      <WorkshopStrip open={open} summary={summary} loading={board.loading && !board.data} />

      <WfFilters
        label={isStores ? "Search parts" : "Search the workshop"}
        placeholder={isStores ? "Search a part number or description…" : "Search a machine, card or fault…"}
        search={isStores ? partsQ : isMoves ? movesQ : boardQ} onSearch={isStores ? setPartsQ : isMoves ? setMovesQ : setBoardQ}
        groups={[
          { label: "View", value: view, onPick: setView, options: [["board", "In the workshop", open.length], ["moves", "Booked and released"], ["stores", "Stores"]] },
          ...(isMoves
            ? [
              { label: "Period", value: movePeriod, onPick: setMovePeriod, options: [["today", "Today"], ["window", `${BOARD_DAYS} days`]] },
              { label: "Move", value: moveKind, onPick: setMoveKind, options: [["all", "All", nKind("all")], ["booked", "Booked in", nKind("booked")], ["released", "Released", nKind("released")]] },
            ]
            : isStores
            ? [{ label: "Stock", value: low ? "low" : "all", onPick: (id) => setLow(id === "low"), options: [["all", "All"], ["low", "Below minimum"]] }]
            : [
              { label: "State", value: state, onPick: setState, options: [["all", "All", nState("all")], ...STATES.map((x) => [x.key, x.label, nState(x.key)])] },
              { label: "Repair", value: kind, onPick: setKind, options: [["any", "Any"], ["MAJOR", "Major", nRepair("MAJOR")], ["MINOR", "Minor", nRepair("MINOR")]] },
              { label: "ETA", value: lateOnly ? "late" : "any", onPick: (id) => setLateOnly(id === "late"), options: [["any", "Any"], ["late", "Past ETA", nLate]] },
              { label: "Priority", value: urgentOnly ? "urgent" : "any", onPick: (id) => setUrgentOnly(id === "urgent"), options: [["any", "Any"], ["urgent", "Urgent", nUrgent]] },
            ]),
        ]}
        tools={<Reload loading={isStores ? parts.loading : board.loading} onReload={() => { board.read(); if (isStores) parts.read(); }} />}
      />
      <p className="wf-count">{isMoves ? (
        <><b>{bookedHere.length}</b> {plural(bookedHere.length, "machine")} booked in {periodWords}{bookedHere.length ? <>, <b>{bookedOut} / {bookedHere.length}</b> fixed and out</> : null}, <b>{periodMoves.length - bookedHere.length}</b> released</>
      ) : isStores ? (
        <><b>{partRows.length}</b> {plural(partRows.length, "part")}{partsTerm ? <> matching “{partsTerm}”</> : null}{low ? " below minimum" : ""}{partRows.length >= STORES_LIMIT ? `, the first ${STORES_LIMIT.toLocaleString()}` : ""}</>
      ) : narrowed ? (
        <><b>{rows.length}</b> of {open.length} {plural(open.length, "machine")} in the workshop</>
      ) : (
        <><b>{open.length}</b> {plural(open.length, "machine")} in the workshop{late ? <>, <b>{late}</b> past their ETA</> : null}{waiting ? <>, <b>{waiting}</b> awaiting parts</> : null}</>
      )}</p>

      {isMoves ? (
        moveRows.length === 0 && board.loading ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Workshop">Bookings and releases from FactorySuite.</EmptyNote>
        ) : moveRows.length === 0 && board.error ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Workshop Could Not Be Loaded" action={{ label: "Try again", onClick: board.read }}>{board.error}</EmptyNote>
        ) : moveRows.length === 0 ? (
          <EmptyNote icon="ti-calendar-event" title={movesQ.trim() || moveKind !== "all" ? "No Moves Match" : "No Bookings or Releases"}>
            {movesQ.trim() || moveKind !== "all" ? "Nothing matches the search and filters picked." : `FactorySuite has booked in or released no machine ${periodWords}.`}
          </EmptyNote>
        ) : (
          <MovesTable rows={moveRows} resetKey={`${movesQ}|${moveKind}|${movePeriod}`} />
        )
      ) : isStores ? (
        <>
          {partRows.length === 0 && parts.loading ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Stores">Parts and stock from FactorySuite.</EmptyNote>
          ) : partRows.length === 0 && parts.error ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="The Stores Could Not Be Loaded" action={{ label: "Try again", onClick: parts.read }}>{parts.error}</EmptyNote>
          ) : partRows.length === 0 ? (
            <EmptyNote icon="ti-search" title="No Parts">{partsTerm || low ? "Nothing matches." : "FactorySuite has sent no parts yet."}</EmptyNote>
          ) : (
            <StoresTable rows={partRows} resetKey={`${partsTerm}|${low}`} />
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
                   action={{ label: "Clear the filters", onClick: () => { setBoardQ(""); setState("all"); setUrgentOnly(false); setLateOnly(false); setKind("any"); } }}>
          Nothing in the workshop matches the search and filters picked.
        </EmptyNote>
      ) : (
        <BoardTable rows={rows} onOpen={onOpen} openId={openId} resetKey={`${boardQ}|${state}|${urgentOnly}|${lateOnly}|${kind}`} />
      )}
    </div>
  );
}
