/**
 * Order a spare part for a repair job: the order card at the top of the
 * overhaul panel's spare-parts column (Fuel Audit).
 *
 * Built from the Sensor Monitor's parts, the same fields, labels, inputs and
 * buttons as the job sign-off, and coloured only through the sp4 tokens, so it
 * follows the theme the rest of the panel is in.
 *
 * The part is picked from the usual probe-repair parts, "Other…" for the rest.
 * A summary line reads the order back before it is placed. Failures go to the
 * page's toast (`onToast`) and the card keeps everything filled in.
 */

import { useId, useMemo, useState } from "react";
import { addRepairSparePart, localDayISO } from "../../api/repairs";
import "./OrderSparePartForm.css";

/* The parts a probe repair usually needs, so ordering one is a pick rather
   than typing. "Other…" opens a box for anything not listed. */
export const COMMON_PARTS = [
  "FLS capacitive fuel probe",
  "Probe cable",
  "Probe connector",
  "Cable gland",
  "Probe mounting flange & seal",
  "Tank bracket",
  "Tracker / FLS unit",
  "Fuse & fuse holder",
];
/* The usual parts for each kind of fault, so the pick list matches the job
   (operator, 2026-10-01: specific to what was picked). A fuel probe job and a
   dead-probe fault share the probe list; anything unknown gets the common
   wiring parts. */
const TRACKER_PARTS = ["GPS antenna", "GSM antenna", "SIM card", "Tracker / FLS unit", "Power harness", "Backup battery", "Fuse & fuse holder"];
const PARTS_BY_FAULT = {
  fuel_probe_dead: COMMON_PARTS,
  gps_not_reporting: TRACKER_PARTS,
  signal_lost: TRACKER_PARTS,
  ignition_not_reporting: ["Ignition sense wire", "Relay", "Connector", "Tracker / FLS unit", "Fuse & fuse holder"],
  odometer_not_reporting: ["CAN reader", "Wiring harness", "Connector", "Tracker / FLS unit", "Fuse & fuse holder"],
  engine_hours_not_reporting: ["CAN reader", "Wiring harness", "Connector", "Tracker / FLS unit", "Fuse & fuse holder"],
};
const GENERIC_PARTS = ["Wiring harness", "Connector", "Tracker / FLS unit", "Fuse & fuse holder"];
export function partsFor(job) {
  if (!job || job.targetKind === "probe" || job.outcome === "audit") return COMMON_PARTS;
  return PARTS_BY_FAULT[job.faultKind] ?? GENERIC_PARTS;
}
const REPAIR_NAME = {
  fuel_probe_dead: "probe repair",
  gps_not_reporting: "GPS repair",
  signal_lost: "tracker repair",
  ignition_not_reporting: "ignition repair",
  odometer_not_reporting: "odometer repair",
  engine_hours_not_reporting: "engine-hours repair",
};
const repairName = (job) => {
  if (!job || job.targetKind === "probe" || job.outcome === "audit") return "probe repair";
  return REPAIR_NAME[job.faultKind] ?? "repair";
};
const OTHER = "__other";
const EMPTY = { pick: "", custom: "", quantity: 1, supplier: "", costKes: "", expectedAt: "", note: "" };

const QUICK_DATES = [["+1d", 1, "Tomorrow"], ["+3d", 3, "In 3 days"], ["+1w", 7, "In 1 week"], ["+2w", 14, "In 2 weeks"]];
const LONG = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
export const longDay = (iso) => (iso ? LONG.format(new Date(`${String(iso).slice(0, 10)}T00:00:00Z`)) : null);
const kes = (n) => `KES ${Number(n).toLocaleString("en-KE")}`;

export default function OrderSparePartForm({ orgId, job, plate, suppliers = [], onCancel, onDone, onToast }) {
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const titleId = useId();
  const supplierListId = useId();

  const name = (f.pick === OTHER ? f.custom : f.pick).trim();
  const qty = Math.max(1, Math.min(1000, Number(f.quantity) || 1));
  const today = localDayISO();
  const dateBad = f.expectedAt && f.expectedAt < today;
  const missing = !name ? (f.pick === OTHER ? "Name the part" : "Choose a part") : dateBad ? "The delivery date has passed" : null;

  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }));
  const step = (d) => setF((p) => ({ ...p, quantity: Math.max(1, Math.min(1000, (Number(p.quantity) || 1) + d)) }));

  const summary = useMemo(() => {
    if (!name) return null;
    const bits = [`${qty} × ${name}`];
    if (f.supplier.trim()) bits.push(`from ${f.supplier.trim()}`);
    if (f.costKes !== "") bits.push(kes(f.costKes));
    if (f.expectedAt) bits.push(`due ${longDay(f.expectedAt)}`);
    return bits.join(" · ");
  }, [name, qty, f.supplier, f.costKes, f.expectedAt]);

  async function submit(e) {
    e.preventDefault();
    if (busy || missing) return;
    setBusy(true);
    try {
      await addRepairSparePart({
        orgId, itemId: job.id,
        part: { name, quantity: qty, supplier: f.supplier, costKes: f.costKes, expectedAt: f.expectedAt, note: f.note },
      });
      onToast?.({ tone: "ok", text: `${qty > 1 ? `${qty} × ` : ""}${name} ordered. ${plate} is now waiting on spares.` });
      setF(EMPTY);
      onDone?.();
    } catch (err) {
      onToast?.({ tone: "crit", text: err?.message || "Could not order that part. Try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="osp-card" onSubmit={submit} noValidate aria-labelledby={titleId}
          onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel?.(); }}>
      <div className="osp-card-head">
        <span className="osp-head-icon" aria-hidden="true"><i className="ti ti-truck-delivery" /></span>
        <span className="osp-head-text">
          <span className="osp-title" id={titleId}>New spare part order</span>
          <span className="osp-sub">{plate} · {repairName(job)}</span>
        </span>
      </div>

      <div className="osp-body">
        <label className="sp4-field osp-f-part">
          <span className="sp4-label">Part</span>
          <span className="osp-select-wrap">
            <select className="sp4-input osp-select" value={f.pick} onChange={set("pick")} disabled={busy} autoFocus>
              <option value="">Choose a part…</option>
              {partsFor(job).map((n) => <option key={n} value={n}>{n}</option>)}
              <option value={OTHER}>Other…</option>
            </select>
            <i className="ti ti-chevron-down osp-select-chev" aria-hidden="true" />
          </span>
        </label>
        <div className="sp4-field osp-f-qty">
          <span className="sp4-label">Qty</span>
          <div className="osp-stepper" role="group" aria-label="Quantity">
            <button type="button" className="osp-step" onClick={() => step(-1)} disabled={busy || qty <= 1} aria-label="One fewer">−</button>
            <input className="sp4-input osp-qty" inputMode="numeric" value={f.quantity}
                   onChange={(e) => setF((p) => ({ ...p, quantity: e.target.value.replace(/\D/g, "").slice(0, 4) }))}
                   onBlur={() => setF((p) => ({ ...p, quantity: qty }))} aria-label="Quantity" disabled={busy} />
            <button type="button" className="osp-step" onClick={() => step(1)} disabled={busy || qty >= 1000} aria-label="One more">+</button>
          </div>
        </div>
        {f.pick === OTHER && (
          <label className="sp4-field osp-f-full osp-f-custom">
            <span className="sp4-label">Part name</span>
            <input className="sp4-input" value={f.custom} onChange={set("custom")} maxLength={200}
                   placeholder="As the supplier lists it" disabled={busy} autoFocus />
          </label>
        )}

        <label className="sp4-field osp-f-half osp-f-supplier">
          <span className="sp4-label">Supplier</span>
          <input className="sp4-input" value={f.supplier} onChange={set("supplier")} maxLength={200}
                 list={supplierListId} placeholder="Who supplies it" disabled={busy} />
          {suppliers.length > 0 && (
            <datalist id={supplierListId}>{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
          )}
        </label>
        <label className="sp4-field osp-f-half">
          <span className="sp4-label">Total cost</span>
          <span className="osp-affix">
            <span className="osp-affix-pre" aria-hidden="true">KES</span>
            <input className="sp4-input osp-affix-input" inputMode="numeric" value={f.costKes}
                   onChange={(e) => setF((p) => ({ ...p, costKes: e.target.value.replace(/\D/g, "").slice(0, 9) }))}
                   placeholder="0" disabled={busy} aria-label="Total cost in KES" />
          </span>
        </label>

        <div className="sp4-field osp-f-full">
          <span className="sp4-label">Expected delivery</span>
          <div className="osp-date-row">
            <input className="sp4-input sp4-input--date osp-date" type="date" min={today} value={f.expectedAt}
                   onChange={set("expectedAt")} disabled={busy} aria-label="Expected delivery date" />
            <div className="osp-quick" role="group" aria-label="Quick dates">
              {QUICK_DATES.map(([label, n, title]) => {
                const d = localDayISO(n);
                return (
                  <button key={n} type="button" disabled={busy} title={title}
                          className={"sp4-filter-chip osp-chip" + (f.expectedAt === d ? " sp4-filter-chip--on" : "")}
                          aria-pressed={f.expectedAt === d} aria-label={title}
                          onClick={() => setF((p) => ({ ...p, expectedAt: d }))}>{label}</button>
                );
              })}
            </div>
          </div>
        </div>

        <label className="sp4-field osp-f-full">
          <span className="sp4-label">Order reference or note (optional)</span>
          <textarea className="sp4-textarea" rows={2} value={f.note} onChange={set("note")} maxLength={1000}
                    placeholder="PO number, courier, contact: anything to chase it by" disabled={busy} />
        </label>

        <div className={"osp-summary osp-f-full" + (summary ? "" : " osp-summary--empty")} aria-live="polite">
          <i className="ti ti-receipt" aria-hidden="true" />
          <span>{summary ?? "Choose a part to see the order."}</span>
        </div>
      </div>

      <div className="osp-foot">
        {missing && <span className="sp4-repair-pending">{missing}</span>}
        <button type="button" className="sp4-ghost-btn" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="sp4-submit-btn osp-submit" disabled={busy || !!missing}>
          {busy ? "Ordering…" : "Place order"}
        </button>
      </div>
    </form>
  );
}
