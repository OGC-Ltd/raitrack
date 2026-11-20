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
import { usePager } from "../body/TablePager";
import { WfFilters, WfGrid, Reload, rowProps, Badge, Ident } from "./WorkshopParts";
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
            head={[["Machine"], ["Fault"], ["Card"], ["Repair job"], ["Checked in"], ["In for", true]]}>
          {pager.pageRows.map((c) => {
            const [label, pill] = CARD_STATUS[c.status] ?? [c.status, "none"];
            const job = c.repairItem;
            const go = () => job && onOpen(job.id);
            return (
              <tr key={c.id} {...(job ? rowProps(openId === job.id, go) : { tabIndex: -1, className: "wf-row--still" })}>
                <td>
                  <Ident name={c.machine} sub={c.vehicle?.registrationPlate && c.vehicle.registrationPlate !== c.machine ? c.vehicle.registrationPlate : null} />
                </td>
                <td>
                  <span className="wf-cell-fault">{c.reportedFault ?? "-"}</span>
                  {c.diagnosis && <span className="wf-cell-sub">{c.diagnosis}</span>}
                </td>
                <td>
                  <span className="wf-cell-stage">
                    <Badge tone={pill}>{label}</Badge>
                    <span className="wf-cell-sub"><span className="dr-veh">{shortCard(c.cardNumber)}</span>{c.priority === "Urgent" ? ", urgent" : ""}{c.source ? `, ${(CARD_SOURCE[c.source] ?? c.source).toLowerCase()}` : ""}</span>
                  </span>
                </td>
                <td>
                  {job
                    ? <span className="wf-cell-stage"><Badge tone={STAGE_PILL[job.stage]}>{STAGE_LABEL[job.stage] ?? job.stage}</Badge>{job.ticketNo && job.ticketNo !== shortCard(c.cardNumber) && <span className="wf-cell-sub dr-veh">{job.ticketNo}</span>}</span>
                    : <span className="sp4-muted" title="The machine on this card is not one of our tracked units">Not tracked</span>}
                </td>
                <td className="sys-num">{at(c.checkedInAt)}</td>
                <td className="dr-num sys-num">{span(hoursSince(c.checkedInAt))}</td>
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

  const narrowed = !!boardQ.trim() || state !== "all" || urgentOnly;

  return (
    <div className="fsw-tab">
      <WorkshopStrip open={open} summary={summary} loading={board.loading && !board.data} />

      <WfFilters
        label={isStores ? "Search parts" : "Search the workshop"}
        placeholder={isStores ? "Search a part number or description…" : "Search a machine, card or fault…"}
        search={isStores ? partsQ : boardQ} onSearch={isStores ? setPartsQ : setBoardQ}
        groups={[
          { label: "View", value: view, onPick: setView, options: [["board", "In the workshop", open.length], ["stores", "Stores"]] },
          ...(isStores
            ? [{ label: "Stock", value: low ? "low" : "all", onPick: (id) => setLow(id === "low"), options: [["all", "All"], ["low", "Below minimum"]] }]
            : [
              { label: "State", value: state, onPick: setState, options: [["all", "All", nState("all")], ...STATES.map((x) => [x.key, x.label, nState(x.key)])] },
              { label: "Priority", value: urgentOnly ? "urgent" : "any", onPick: (id) => setUrgentOnly(id === "urgent"), options: [["any", "Any"], ["urgent", "Urgent", nUrgent]] },
            ]),
        ]}
        tools={<Reload loading={isStores ? parts.loading : board.loading} onReload={() => { board.read(); if (isStores) parts.read(); }} />}
      />
      <p className="wf-count">{isStores ? (
        <><b>{partRows.length}</b> {plural(partRows.length, "part")}{partsTerm ? <> matching “{partsTerm}”</> : null}{low ? " below minimum" : ""}{partRows.length >= STORES_LIMIT ? `, the first ${STORES_LIMIT.toLocaleString()}` : ""}</>
      ) : narrowed ? (
        <><b>{rows.length}</b> of {open.length} {plural(open.length, "machine")} in the workshop</>
      ) : (
        <><b>{open.length}</b> {plural(open.length, "machine")} in the workshop{waiting ? <>, <b>{waiting}</b> awaiting parts</> : null}</>
      )}</p>

      {isStores ? (
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
                   action={{ label: "Clear the filters", onClick: () => { setBoardQ(""); setState("all"); setUrgentOnly(false); } }}>
          Nothing in the workshop matches the search and filters picked.
        </EmptyNote>
      ) : (
        <BoardTable rows={rows} onOpen={onOpen} openId={openId} resetKey={`${boardQ}|${state}|${urgentOnly}`} />
      )}
    </div>
  );
}
