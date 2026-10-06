/**
 * Fuel > Audit: the fuel theft alerts that turned out to be a faulty probe.
 *
 * A case lands here when its reviewer decides it as "Faulty fuel probe" in the
 * case window (lib/fuelFollowUps, probeFaultFollowUp). That decision raises a
 * pending probe job for the unit in Maintenance > Repairs, or joins the one
 * already open, and the case stays open until a technician signs that job off
 * fixed. A sign-off without a fix leaves it here, to have a new job raised.
 *
 * One row per UNIT, not per case: the question this page answers is "which
 * probes keep raising false thefts, and where is each repair". A row opens to
 * the unit's cases, the live repair ladder (RepairTrackingLine, read-only:
 * the work itself happens in Repairs), and its probe record: every probe job
 * it has had and every time the probe went dead.
 *
 * Built from the Sensor Monitor's parts, like Cases and Repairs.
 */

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import "../body/SensorPanel.css";
import "./SystemScreen.css";
import "./FuelReportScreen.css";
import "./AuditScreen.css";
import { useAppActions } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import { fetchFuelAudit, openFollowUp, reraiseProbeRepair } from "../../lib/fuelFollowUps";
import { STAGE_LABEL as REPAIR_STAGE, STAGE_PILL as REPAIR_PILL, STAGE_ORDER, OUTCOME_LABEL, REPAIRS_CHANGED, mayWorkJob } from "../../api/repairs";
import { useAuth } from "../../context/AuthContext";
import { litres, when } from "../body/FuelFollowUp";
import { persistChoice } from "../../lib/navMemory";
import RepairTrackingLine from "../body/RepairTrackingLine";
import AuditOverhaul from "./AuditOverhaul";
import { Card, Gauge } from "./FuelReportOverview";
import TableToolbar from "../body/TableToolbar";
import FilterBar from "../body/FilterBar";
import EmptyNote from "../shared/EmptyNote";
import { watchTableLabels } from "../../lib/tableLabels";

const STATES = [
  ["open",     "Waiting on repair"],
  ["repaired", "Repaired"],
  ["all",      "All"],
];

const EMPTY = {
  open:     { icon: "ti-tool", title: "Nothing Waiting on a Repair",
              sub: "No faulty probe is waiting on a repair." },
  repaired: { icon: "ti-circle-check", title: "No Repairs Yet",
              sub: "No probe found faulty by a fuel case has been repaired yet." },
  all:      { icon: "ti-gauge", title: "No Faulty Probes Found",
              sub: "No fuel case has been found to be a faulty probe yet. Decide one as “Faulty fuel probe” in its case window." },
};

const day = (v) => (v ? String(v).slice(0, 10) : "—");
const hours = (sec) => (sec == null ? "ongoing" : sec < 3600 ? `${Math.round(sec / 60)} min` : `${(sec / 3600).toFixed(1)} h`);

/** Where the unit's audit stands, from its open cases' current job. */
function unitState(u) {
  const open = u.cases.filter((c) => c.status === "PROBE_FAULT");
  if (open.length === 0) return { key: "repaired", label: "Repaired", pill: "con", job: u.cases[0]?.repairItem ?? null };
  const job = open.find((c) => c.repairItem)?.repairItem ?? null;
  if (!job || (job.resolvedAt && job.stage !== "fixed")) {
    return { key: "failed", label: job ? "Repair unsuccessful" : "No repair job", pill: "inc", job };
  }
  return { key: "open", label: REPAIR_STAGE[job.stage] ?? job.stage, pill: REPAIR_PILL[job.stage] ?? "warn", job };
}

/**
 * Where the unit's repair has got to, as four short rungs (Pending → Spare
 * outsourced → Fixing → Fixed): filled up to the job's stage, the last rung
 * critical when it was signed off without a fix. Beside the pill that names
 * the stage, so it is never read by colour alone.
 */
function Ladder({ st }) {
  const stage = st.job?.stage;
  const reached = st.key === "repaired" ? STAGE_ORDER.length - 1
    : stage === "failed" ? STAGE_ORDER.length - 1
    : Math.max(-1, STAGE_ORDER.indexOf(stage));
  const tone = st.key === "repaired" ? "done" : st.key === "failed" ? "fail" : "work";
  return (
    <span className={`aud-ladder aud-ladder--${tone}`} aria-hidden="true">
      {STAGE_ORDER.map((k, i) => <i key={k} className={i <= reached ? "is-on" : ""} />)}
    </span>
  );
}

/** A value over a hairline bar, against the column's largest. */
function CellBar({ children, ratio, tone }) {
  return (
    <span className="aud-cellbar">
      <span>{children}</span>
      <i aria-hidden="true"><b className={`aud-cellbar--${tone}`} style={{ width: `${Math.max(2, Math.min(1, ratio) * 100)}%` }} /></i>
    </span>
  );
}

/** What the reviewer said the probe does wrong: the PROBE_FAULT log entry. */
function finding(c) {
  return [...(c.actions ?? [])].reverse().find((a) => a.kind === "PROBE_FAULT") ?? null;
}

/** One figure as a gauge: n of the whole it belongs to. */
function StatCard({ title, n, of, what, color, note, loading }) {
  const shown = loading && !of ? "—" : n;
  const ratio = of > 0 ? n / of : 0;
  const unit = of > 0 ? `of ${of} ${what}${of === 1 ? "" : "s"}` : loading ? "reading" : `no ${what}s yet`;
  return (
    <Card title={title} note={note} className="aud-stat">
      <Gauge ratio={ratio} color={color} value={shown} unit={unit}
             ariaLabel={`${title}: ${n} of ${of} ${what}${of === 1 ? "" : "s"}.`} />
    </Card>
  );
}

function openInRepairs(ctx) {
  // The Sensor Monitor restores its tab on mount, and it mounts fresh when
  // the Maintenance tab is opened, so saving the choice first lands on Repairs.
  persistChoice("ft-sensor-tab", "repairs");
  ctx.setMaintenanceView("sensors");
  ctx.setDesktopActiveTab("maintenance");
}

function RaiseJob({ orgId, c, onDone, onToast }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const ok = note.trim().length >= 3;
  const run = async () => {
    if (!ok || busy) return;
    setBusy(true);
    onToast(null);
    try {
      await reraiseProbeRepair(orgId, c.id, note.trim());
      setNote("");
      onToast({ tone: "ok", text: `A new probe repair for ${c.incident.plate} is pending in Maintenance › Repairs.` });
      onDone();
    } catch (err) {
      onToast({ tone: "crit", text: err?.message || "Could not raise the repair job. Try again." });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="aud-raise">
      <label className="sp4-field">
        <span className="sp4-label">Raise a new repair job</span>
        <textarea
          className="sp4-textarea"
          rows={2}
          maxLength={2000}
          value={note}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What the technician should know: what was tried, what the probe still does"
        />
      </label>
      <div className="aud-raise-foot">
        {!ok && <span className="sp4-repair-pending">Say what the technician should know</span>}
        <button type="button" className="sp4-submit-btn" onClick={run} disabled={!ok || busy}>
          {busy ? "Raising…" : "Send to Repairs"}
        </button>
      </div>
    </div>
  );
}

function UnitDetail({ u, orgId, canTriage, canRepairs, canWork: canResolve, canWorkAny, userId, canAssign, ctx, onChanged, onToast }) {
  const st = unitState(u);
  // A technician works only an accepted job of their own (mayWorkJob).
  const canWork = mayWorkJob(st.job, { canResolve, canWorkAny, userId });
  const failedCase = st.key === "failed" ? u.cases.find((c) => c.status === "PROBE_FAULT") : null;
  const maxMl = Math.max(1, ...u.cases.map((c) => c.incident.volumeMl ?? 0));
  return (
    <div className="aud-detail">
        <section className="frv-card aud-card">
          <div className="aud-card__head">
            <h3 className="frv-card__t">Alerts raised by this probe <span className="sp4-tab-n">{u.cases.length}</span></h3>
          </div>
          <ul className="aud-cases">
            {u.cases.map((c) => {
              const f = finding(c);
              const fixed = c.status === "PROBE_FIXED";
              return (
                // One line per alert, its columns shared with the rows under it
                // (subgrid): when, how much, what the reviewer found, where the
                // case stands, and the way into it. A full-width card with the
                // note on a second line left the middle of the row empty.
                <li key={c.id} className="aud-case">
                  <span className="aud-case-when sys-num">{when(c.incident.beganAt)}</span>
                  <CellBar ratio={(c.incident.volumeMl ?? 0) / maxMl} tone="alert">
                    <b className="sys-num">{litres(c.incident.volumeMl)}</b> <span className="aud-unit">reported lost</span>
                  </CellBar>
                  <p className="aud-case-note">
                    {f ? <><strong>{f.actor?.fullName ?? "The reviewer"}</strong> <span className="aud-unit">{when(f.at)}</span> · {f.note}</>
                       : <span className="aud-unit">No finding recorded.</span>}
                  </p>
                  <span className={"sp4-pill sp4-pill--" + (fixed ? "con" : "warn")}>
                    {fixed ? "Closed · repaired" : "Open · waiting on repair"}
                  </span>
                  {canTriage ? (
                    <button type="button" className="sp4-ghost-btn aud-case-open" onClick={() => openFollowUp(c.id)}>
                      Open case
                    </button>
                  ) : <span />}
                </li>
              );
            })}
          </ul>
        </section>

        <section className="frv-card aud-card aud-card--repair">
          <div className="aud-card__head">
            <h3 className="frv-card__t">Current repair</h3>
            {canRepairs && (
              <button type="button" className="sp4-ghost-btn" onClick={() => openInRepairs(ctx)}>
                Open in Maintenance › Repairs
              </button>
            )}
          </div>
          {st.job ? (
            <>
              {/* No facts above the ladder: it carries the fix date in its own
                  head and each rung's date and who moved it; the technician
                  is set in the overhaul below. */}
              <RepairTrackingLine
                item={st.job}
                orgId={orgId}
                canResolve={canWork}
                onChanged={onChanged}
                onError={(text) => onToast({ tone: "crit", text })}
                title="Progress"
              />
              {st.job.fixNote && <p className="aud-case-note"><strong>Sign-off:</strong> {st.job.fixNote}</p>}
            </>
          ) : (
            <p className="frv-none">No repair job is linked to this unit&rsquo;s open case.</p>
          )}
          {canTriage && failedCase && <RaiseJob orgId={orgId} c={failedCase} onDone={onChanged} onToast={onToast} />}
        </section>

      {st.job && (
        <AuditOverhaul
          orgId={orgId}
          job={st.job}
          overhaul={u.overhaul?.[st.job.id]}
          plate={u.plate}
          suppliers={[...new Set(Object.values(u.overhaul ?? {}).flatMap((o) => o.parts.map((x) => x.supplier)).filter(Boolean))]}
          canWork={canWork && !st.job.resolvedAt}
          canAssign={canAssign && !st.job.resolvedAt}
          onToast={onToast}
          onChanged={onChanged}
        />
      )}

      <section className="frv-card aud-card">
        <h3 className="frv-card__t">Probe record</h3>
        {u.repairs.length === 0 && u.probeFaults.length === 0 && (
          <p className="frv-none">Nothing else on record for this probe.</p>
        )}
        {/* Cards on a phone (SensorPanel's ≤599px table layout), not a grid
            scrolling sideways inside the unit's detail. */}
        {u.repairs.length > 0 && (
          <div className="sp4-table-scroll">
            <table className="sp4-table sp4-probe-table">
              <thead>
                <tr>
                  <th className="sp4-th--left">Raised</th>
                  <th className="sp4-th--left">By</th>
                  <th className="sp4-th--left">Source</th>
                  <th className="sp4-th--left">Stage</th>
                  <th className="sp4-th--left">What was found / done</th>
                  <th className="sp4-th--right">Closed</th>
                </tr>
              </thead>
              <tbody>
                {u.repairs.map((r) => (
                  <tr key={r.id} className="sp4-tr">
                    <td className="sp4-td--left sys-num">{day(r.createdAt)}</td>
                    <td className="sp4-td--left">{r.report?.reportedBy?.fullName ?? "—"}</td>
                    <td className="sp4-td--left">{OUTCOME_LABEL[r.outcome] ?? r.outcome}</td>
                    <td className="sp4-td--left">
                      <span className={"sp4-pill sp4-pill--" + (REPAIR_PILL[r.stage] ?? "none")}>{REPAIR_STAGE[r.stage] ?? r.stage}</span>
                    </td>
                    <td className="sp4-td--left aud-wrap">
                      {[r.problemNote, r.sparePart && `Spare: ${r.sparePart}`, r.fixNote && `Fix: ${r.fixNote}`].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="sp4-td--right sys-num">{r.resolvedAt ? day(r.resolvedAt) : "open"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {u.probeFaults.length > 0 && (
          <p className="aud-dead">
            Probe stopped reporting {u.probeFaults.length} time{u.probeFaults.length === 1 ? "" : "s"}:{" "}
            {u.probeFaults.slice(0, 6).map((e) => `${day(e.startedAt)} (${hours(e.durationSec)})`).join(", ")}
            {u.probeFaults.length > 6 && ", …"}
          </p>
        )}
      </section>
    </div>
  );
}

export default function AuditScreen() {
  const ctx = useAppActions();
  const { orgId, can } = usePermissions();
  // Reading the audit (fuel_audit:read, the named roles) and holding a case
  // (triage) are separate: an analyst reads it without acting on a case.
  const canRead = can("fuel_audit:read");
  const canTriage = can("fuel_theft:triage");
  const canRepairs = can("sensor:read");
  // Working the job from here: the same grants the Repairs tab asks for.
  const canWork = can("repair:resolve");
  const canWorkAny = can("repair:work_any");
  const { user } = useAuth();
  const canAssign = can("repair:assign");
  const [s, setS] = useState({ units: [], loading: true, error: null });
  const [state, setState] = useState("open");
  const [openId, setOpenId] = useState(null);
  const [toast, setToast] = useState(null);

  const read = useCallback(() => {
    if (!orgId || !canRead) return;
    setS((p) => ({ ...p, loading: true }));
    fetchFuelAudit(orgId)
      .then((units) => setS({ units, loading: false, error: null }))
      .catch((e) => {
        setS((p) => ({ ...p, loading: false, error: e?.message || "Could not load" }));
        setToast({ tone: "crit", text: e?.message ? `Could not load the fuel audit: ${e.message}` : "Could not load the fuel audit." });
      });
  }, [orgId, canRead]);

  // Every case change arrives as `fuel_followup` over SSE (useFleetLive) and
  // lands here as this event, repair sign-offs included.
  useEffect(() => {
    read();
    window.addEventListener("ft-fuel-followup-changed", read);
    // Repairs moved a job, ordered a part or signed one off: same jobs here.
    window.addEventListener(REPAIRS_CHANGED, read);
    return () => {
      window.removeEventListener("ft-fuel-followup-changed", read);
      window.removeEventListener(REPAIRS_CHANGED, read);
    };
  }, [read]);

  const rootRef = useRef(null);
  useEffect(() => watchTableLabels(rootRef.current), []);

  const states = s.units.map((u) => ({ u, st: unitState(u) }));
  const waiting = states.filter((x) => x.st.key !== "repaired");
  const failed = states.filter((x) => x.st.key === "failed").length;
  const repaired = states.length - waiting.length;
  const openCases = s.units.reduce((n, u) => n + u.openCases, 0);
  const rows = state === "open" ? waiting : state === "repaired" ? states.filter((x) => x.st.key === "repaired") : states;
  const totalCases = s.units.reduce((n, u) => n + u.cases.length, 0);
  const unitsWithOpen = s.units.filter((u) => u.openCases > 0).length;
  const falseLitres = rows.reduce((n, x) => n + x.u.cases.reduce((m, c) => m + (c.incident.volumeMl ?? 0), 0), 0);

  return (
    <div className="sp4-root sys-root aud-root" ref={rootRef}>
      {toast && (
        <div className={`sp4-toast sp4-toast--${toast.tone}`} role="status" aria-live="polite">
          <span className="sp4-toast-text">{toast.text}</span>
          <button type="button" className="sp4-toast-x" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button>
        </div>
      )}
      {/* The four figures as the Fuel report draws its own: a card each, the
          count in a gauge against what it is a share of. Probes to repair and
          Repaired split the same units; Failed repairs is the part of the
          first that needs a new job. */}
      <div className="aud-stats">
        <StatCard title="Probes to repair" n={waiting.length} of={states.length} what="probe"
                  color="var(--frv-s2)" loading={s.loading}
                  note="Raised a false theft and not yet fixed." />
        <StatCard title="Open cases" n={openCases} of={totalCases} what="case"
                  color="var(--frv-s1)" loading={s.loading}
                  note={openCases ? `Held open on ${unitsWithOpen} unit${unitsWithOpen === 1 ? "" : "s"} until the probe is fixed.` : "Every case has closed on its sign-off."} />
        <StatCard title="Failed repairs" n={failed} of={states.length} what="probe"
                  color="var(--frv-crit)" loading={s.loading}
                  note={failed ? "Signed off without a fix, or no job: raise a new one." : "No repair has been signed off without a fix."} />
        <StatCard title="Repaired" n={repaired} of={states.length} what="probe"
                  color="var(--frv-s3)" loading={s.loading}
                  note="Fixed; their cases closed on the sign-off." />
      </div>

      <div className="sp4-body">
        <TableToolbar
          summary={
            <>
              <b>{rows.length}</b> unit{rows.length === 1 ? "" : "s"}
              {rows.length > 0 && <> · {litres(falseLitres)} of false alerts</>}
            </>
          }
          loading={s.loading}
          onReload={read}
          disabled={!rows.length}
        />

        <FilterBar label="State" activeCount={state !== "open" ? 1 : 0}>
          <div className="sp4-filter-group">
            <span className="sp4-filter-label">State</span>
            {STATES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={"sp4-filter-chip" + (state === id ? " sp4-filter-chip--on" : "")}
                aria-pressed={state === id}
                onClick={() => setState(id)}
              >
                {label}
                <span className="sys-chip-n">{id === "open" ? waiting.length : id === "repaired" ? repaired : states.length}</span>
              </button>
            ))}
          </div>
        </FilterBar>

        {!canRead ? (
          <EmptyNote icon="ti-lock" tone="warn" title="Fuel Audit Is Not Open to Your Role">
            Ask an administrator for access if you need to follow faulty probes to repair.
          </EmptyNote>
        ) : rows.length === 0 && s.loading ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Audit">
            Faulty-probe cases and their repairs.
          </EmptyNote>
        ) : rows.length === 0 && s.error ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Audit Could Not Be Loaded"
                     action={{ label: "Try again", onClick: read }}>
            {s.error}
          </EmptyNote>
        ) : rows.length === 0 && (
          <EmptyNote icon={EMPTY[state].icon} title={EMPTY[state].title}>{EMPTY[state].sub}</EmptyNote>
        )}

        {/* One card per unit on a phone: seven columns scrolled sideways put
            the repair state and the button off-screen. */}
        {rows.length > 0 && (
          <div className="sp4-table-scroll aud-units">
            <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
              <thead>
                <tr>
                  <th className="sp4-th--left sp4-th--pin">Unit Reg</th>
                  <th className="sp4-th--right aud-th--bar">False alerts</th>
                  <th className="sp4-th--left">Last alert</th>
                  <th className="sp4-th--left">Repair</th>
                  <th className="sp4-th--left">Technician</th>
                  <th className="sp4-th--right">Probe record</th>
                  <th className="sp4-th--right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ u, st }) => {
                  const maxVol = Math.max(1, ...rows.map((x) => x.u.cases.reduce((m, c) => m + (c.incident.volumeMl ?? 0), 0)));
                  const expanded = openId === u.vehicleId;
                  const toggle = () => setOpenId(expanded ? null : u.vehicleId);
                  const vol = u.cases.reduce((m, c) => m + (c.incident.volumeMl ?? 0), 0);
                  return (
                    <Fragment key={u.vehicleId}>
                      <tr
                        className={"sp4-tr sp4-tr--incident aud-tr" + (expanded ? " aud-tr--open" : "")}
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={toggle}
                        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } }}
                      >
                        <td className="sp4-td--left sp4-td--pin"><span className="sp4-reg">{u.plate ?? "—"}</span></td>
                        <td className="sp4-td--right">
                          <CellBar ratio={vol / maxVol} tone="alert">
                            <b className="sys-num">{litres(vol)}</b> <span className="aud-unit">in {u.cases.length}</span>
                          </CellBar>
                        </td>
                        <td className="sp4-td--left sys-num">{when(u.lastAlertAt)}</td>
                        <td className="sp4-td--left">
                          <span className="aud-repair">
                            <span className={"sp4-pill sp4-pill--" + st.pill}>{st.label}</span>
                            <Ladder st={st} />
                          </span>
                        </td>
                        <td className="sp4-td--left">{st.job?.assignedTo?.fullName ?? <span className="sp4-muted">—</span>}</td>
                        <td className="sp4-td--right sys-num">
                          {u.repairs.length} job{u.repairs.length === 1 ? "" : "s"}
                          {u.probeFaults.length > 0 && <> · {u.probeFaults.length} dead</>}
                        </td>
                        <td className="sp4-td--right">
                          <button type="button" className="sp4-ghost-btn" onClick={(e) => { e.stopPropagation(); toggle(); }}>
                            {expanded ? "Hide" : st.key === "failed" ? "Raise job" : st.key === "open" ? "Overhaul" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="aud-detail-row">
                          <td colSpan={7}>
                            <UnitDetail u={u} orgId={orgId} canTriage={canTriage} canRepairs={canRepairs} canWork={canWork} canWorkAny={canWorkAny} userId={user?.id ?? null} canAssign={canAssign} ctx={ctx} onChanged={read} onToast={setToast} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
