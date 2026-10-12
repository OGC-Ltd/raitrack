/**
 * Alerts: fuel and overspeeding alerts from every organisation this account
 * holds, on one page, escalated and de-escalated there.
 *
 * Asked for 2026-10-12: "The fuel alerts and over speeding alerts we need to
 * have them on a centralized page that we can easily track, and manage —
 * escalate & de-escalate … it should list all organizations alerts and we can
 * filter so that it ease the pain of navigating from one organization to the
 * next." So the page does not follow the company in the header: it lists
 * every organisation the server says this account may read (fuel where it
 * holds fuel_theft:read, overspeeding where it holds analytics:read), and the
 * Organisation chips narrow it.
 *
 * A fuel alert is what the map announces as a possible theft; unlike the map,
 * it stays here after 24 hours and after a decision, listed under it. An
 * overspeeding alert is one completed episode. Deciding one posts to its own
 * organisation's route, and only that organisation's administrators (or the
 * platform administrator) are offered the buttons: `canDecide` per
 * organisation, from the server.
 *
 * Built from the Fuel Audit's parts (SensorPanel's table, the Fuel report's
 * cards), so the fuel pages read alike.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../body/SensorPanel.css";
import "./SystemScreen.css";
import "./FuelReportScreen.css";
import "./AuditScreen.css";
import "./AlertsScreen.css";
import { useAppActions, useAppSelector, useCompanies } from "../../context/AppContext";
import { usePermissions } from "../../hooks/usePermissions";
import { useApiData } from "../../hooks/useApiData";
import { fetchAlerts, decideAlert } from "../../api/alerts";
import {
  KINDS, OVER_BY, PERIODS, STATUSES, choiceWords, companyForOrgCode, countWhere, decisionWords, duration,
  headline, kmh, litres, periodFrom, ruleWords, statusOf, when,
} from "../../lib/alertsView";
import { Card, Gauge } from "./FuelReportOverview";
import TableToolbar from "../body/TableToolbar";
import FilterBar from "../body/FilterBar";
import EmptyNote from "../shared/EmptyNote";
import { watchTableLabels } from "../../lib/tableLabels";

const POLL_MS = 60_000;
const rowKey = (a) => `${a.kind}:${a.id}`;

const EMPTY = {
  open: { icon: "ti-circle-check", title: "No Open Alerts", sub: "Every alert in this period has been escalated or de-escalated." },
  escalated: { icon: "ti-alert-triangle", title: "Nothing Escalated", sub: "No alert in this period has been escalated." },
  deescalated: { icon: "ti-circle-check", title: "Nothing De-escalated", sub: "No alert in this period has been de-escalated." },
  all: { icon: "ti-bell", title: "No Alerts", sub: "No fuel or overspeeding alert in this period." },
};

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The choices an alert takes after a decision, as the server would answer (alerts.rules). */
function choicesAfter(alert, outcome, reason) {
  if (alert.kind === "speeding") return [{ outcome: outcome === "ESCALATED" ? "DEESCALATED" : "ESCALATED", reason: null }];
  if (reason === "probe_fault") return [];
  const all = [
    { outcome: "ESCALATED", reason: "theft" },
    { outcome: "ESCALATED", reason: "probe_fault" },
    { outcome: "DEESCALATED", reason: null },
  ];
  return all.filter((c) => !(c.outcome === outcome && c.reason === (outcome === "ESCALATED" ? reason : null)));
}

/** One figure as a gauge against the period's whole, like the Fuel Audit's cards. */
function StatCard({ title, n, of, color, note, loading }) {
  const shown = n == null ? "—" : n;
  const unit = of > 0 ? `of ${of} alert${of === 1 ? "" : "s"}` : loading ? "reading" : "no alerts";
  return (
    <Card title={title} note={note} className="aud-stat">
      <Gauge ratio={of > 0 && n != null ? n / of : 0} color={color} value={shown} unit={unit}
             ariaLabel={`${title}: ${shown} of ${of ?? 0} alerts.`} />
    </Card>
  );
}

function Chip({ on, onClick, children, n, title }) {
  return (
    <button type="button" className={"sp4-filter-chip" + (on ? " sp4-filter-chip--on" : "")}
            aria-pressed={on} onClick={onClick} title={title}>
      {children}
      {n != null && <span className="sys-chip-n">{n}</span>}
    </button>
  );
}

/**
 * Escalate or de-escalate one alert: ONE Escalate button with what it is
 * escalated as chosen under it (the operator's rule for fuel), a reason, and
 * a confirm button that says what will happen.
 */
function DecisionPanel({ alert, start, onDecided, onCancel, onToast }) {
  const escalations = alert.choices.filter((c) => c.outcome === "ESCALATED");
  const deescalation = alert.choices.find((c) => c.outcome === "DEESCALATED") ?? null;
  const [outcome, setOutcome] = useState(start && alert.choices.some((c) => c.outcome === start) ? start : null);
  const [reason, setReason] = useState(escalations[0]?.reason ?? null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const noteRef = useRef(null);

  const choice = outcome === "ESCALATED"
    ? escalations.find((c) => c.reason === reason) ?? escalations[0]
    : outcome === "DEESCALATED" ? deescalation : null;
  const words = choice ? choiceWords(alert.kind, choice) : null;
  const ok = note.trim().length >= 3;

  useEffect(() => { if (outcome) noteRef.current?.focus(); }, [outcome]);

  const run = async () => {
    if (!choice || !ok || busy) return;
    setBusy(true);
    try {
      const review = await decideAlert(alert, choice.outcome, note.trim(), choice.reason);
      onDecided(alert, choice, note.trim(), review);
    } catch (err) {
      onToast({ tone: "crit", text: err?.message || "The decision could not be saved. Try again." });
      setBusy(false);
    }
  };

  return (
    <div className="alr-decide">
      <div className="alr-decide-row" role="group" aria-label="Decision">
        {escalations.length > 0 && (
          <button type="button" aria-pressed={outcome === "ESCALATED"}
                  className={"sp4-ghost-btn alr-pick alr-pick--esc" + (outcome === "ESCALATED" ? " is-on" : "")}
                  onClick={() => setOutcome("ESCALATED")} disabled={busy}>
            <i className="ti ti-arrow-big-up-line" aria-hidden="true" /> Escalate
          </button>
        )}
        {deescalation && (
          <button type="button" aria-pressed={outcome === "DEESCALATED"}
                  className={"sp4-ghost-btn alr-pick alr-pick--de" + (outcome === "DEESCALATED" ? " is-on" : "")}
                  onClick={() => setOutcome("DEESCALATED")} disabled={busy}>
            <i className="ti ti-arrow-big-down-line" aria-hidden="true" /> De-escalate
          </button>
        )}
      </div>

      {outcome === "ESCALATED" && escalations.length > 1 && (
        <div className="sp4-filter-group alr-as" role="radiogroup" aria-label="Escalate as">
          <span className="sp4-filter-label">As</span>
          {escalations.map((c) => (
            <button key={c.reason} type="button" role="radio" aria-checked={reason === c.reason}
                    className={"sp4-filter-chip" + (reason === c.reason ? " sp4-filter-chip--on" : "")}
                    onClick={() => setReason(c.reason)} disabled={busy}>
              {choiceWords(alert.kind, c).label}
            </button>
          ))}
        </div>
      )}

      {words && (
        <>
          <label className="sp4-field">
            <span className="sp4-label">Reason</span>
            <textarea ref={noteRef} className="sp4-textarea alr-note" rows={3} maxLength={2000} value={note}
                      disabled={busy} placeholder={words.placeholder} onChange={(e) => setNote(e.target.value)} />
          </label>
          <p className="alr-hint">{words.hint}</p>
          <div className="aud-raise-foot">
            {!ok && <span className="sp4-repair-pending">Give a reason to continue</span>}
            <button type="button" className="sp4-ghost-btn" onClick={() => { setOutcome(null); onCancel?.(); }} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={"sp4-submit-btn" + (choice.outcome === "ESCALATED" ? " alr-submit--esc" : "")}
                    onClick={run} disabled={!ok || busy}>
              {busy ? "Saving…" : words.confirm}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function Facts({ alert, org }) {
  const rows = [];
  if (alert.kind === "fuel") {
    const f = alert.fuel;
    rows.push(["Lost", litres(f.litres)]);
    if (f.tankBeforeL != null && f.tankAfterL != null) rows.push(["Tank", `${litres(f.tankBeforeL)} → ${litres(f.tankAfterL)}`]);
    rows.push(["Rule", ruleWords(f.rule)]);
    if (f.confidence != null) rows.push(["Confidence", `${Math.round(f.confidence * 100)}%`]);
    rows.push(["Began", when(alert.at)], ["Reported", when(f.detectedAt)]);
    if (f.location) rows.push(["Where", f.location]);
    if (f.driverName) rows.push(["Driver", f.driverName]);
    if (f.probeHold) rows.push(["Probe", "Held for a probe repair: no alerts on the map until it is fixed"]);
  } else {
    const s = alert.speeding;
    rows.push(["Peak", kmh(s.peakKmh)], ["Limit", `${kmh(s.limitKmh)}${s.limitSource === "zone" ? " (zone)" : s.limitSource === "road" ? " (road)" : ""}`]);
    rows.push(["Over by", `${Math.round(s.overByKmh)} km/h`]);
    if (s.avgKmh != null) rows.push(["Average", kmh(s.avgKmh)]);
    rows.push(["Lasted", duration(s.durationSec)]);
    if (s.distanceM != null) rows.push(["Distance", `${(s.distanceM / 1000).toFixed(1)} km`]);
    rows.push(["From", when(alert.at)], ["To", when(s.endedAt)]);
    if (s.place) rows.push(["Where", s.place]);
    else if (s.lat != null && s.lng != null) rows.push(["Where", `${s.lat.toFixed(5)}, ${s.lng.toFixed(5)}`]);
    rows.push(["Driver", s.driverName ?? "Not recorded"]);
    rows.push(["Evidence", `${s.frames} reading${s.frames === 1 ? "" : "s"} over the limit`]);
  }
  rows.push(["Organisation", org?.name ?? "—"]);
  return (
    <dl className="alr-facts">
      {rows.map(([k, v]) => (
        <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>
      ))}
    </dl>
  );
}

function AlertDetail({ alert, org, start, canMap, onDecided, onToast, onShowOnMap, onOpenAudit }) {
  const st = statusOf(alert);
  const canDecide = org?.canDecide && alert.choices.length > 0;
  const why = !org?.canDecide
    ? `Only an administrator of ${org?.name ?? "this organisation"} can escalate or de-escalate this alert.`
    : alert.kind === "fuel" && alert.decision?.reason === "probe_fault"
      ? "Escalated as a faulty fuel probe: the case is in Fuel Audit and closes when its repair is signed off fixed."
      : "This alert was decided in its case and cannot be changed here.";
  const place = alert.kind === "speeding" && alert.speeding.lat != null
    ? `https://www.openstreetmap.org/?mlat=${alert.speeding.lat}&mlon=${alert.speeding.lng}#map=15/${alert.speeding.lat}/${alert.speeding.lng}`
    : null;
  return (
    <div className="aud-detail alr-detail">
      <section className="frv-card aud-card">
        <div className="aud-card__head">
          <h3 className="frv-card__t">{alert.kind === "fuel" ? "Fuel alert" : "Overspeeding"} · {alert.plate}</h3>
          <span className="alr-detail-actions">
            {canMap && (
              <button type="button" className="sp4-ghost-btn" onClick={() => onShowOnMap(alert)}>
                <i className="ti ti-map-pin" aria-hidden="true" />
                {alert.kind === "fuel" && alert.fuel.live ? " Open on the map" : " Show unit on the map"}
              </button>
            )}
            {place && (
              <a className="sp4-ghost-btn" href={place} target="_blank" rel="noreferrer noopener">
                <i className="ti ti-external-link" aria-hidden="true" /> Where it happened
              </a>
            )}
          </span>
        </div>
        <Facts alert={alert} org={org} />
      </section>

      <section className="frv-card aud-card">
        <div className="aud-card__head">
          <h3 className="frv-card__t">Decision</h3>
          <span className={`sp4-pill sp4-pill--${st.tone}`} title={st.meaning}>{st.label}</span>
        </div>
        {alert.history.length > 0 ? (
          <ol className="alr-history">
            {[...alert.history].reverse().map((d, i) => (
              <li key={`${d.at}-${i}`} className={i === 0 ? "is-current" : ""}>
                <span className="alr-history-what">{decisionWords(alert.kind, d)}</span>
                <span className="aud-unit"> · {d.by ?? "Someone"} · {when(d.at)}{i > 0 ? " · replaced" : ""}</span>
                {d.note && <p className="aud-case-note">{d.note}</p>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="frv-none">Not decided yet{alert.cleared ? `: ${st.meaning}` : ""}.</p>
        )}
        {canDecide ? (
          <DecisionPanel alert={alert} start={start} onDecided={onDecided} onToast={onToast} />
        ) : (
          <p className="alr-why">
            {why}
            {alert.kind === "fuel" && alert.decision?.reason === "probe_fault" && onOpenAudit && (
              <> <button type="button" className="aud-link" onClick={onOpenAudit}>Open Fuel Audit</button></>
            )}
          </p>
        )}
      </section>
    </div>
  );
}

export default function AlertsScreen() {
  const { companies } = useCompanies();
  const activeCompanyId = useAppSelector((a) => a.activeCompanyId);
  const {
    setActiveCompanyId, setDesktopActiveTab, setSelectedVehicleId, setPendingFocusId, setMobileActiveTab, requestIncident,
  } = useAppActions();
  const { canIn, can } = usePermissions();

  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("open");
  const [orgs, setOrgs] = useState([]);
  const [period, setPeriod] = useState("7d");
  const [overBy, setOverBy] = useState(0);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [open, setOpen] = useState(null); // { key, start }
  const [toast, setToast] = useState(null);
  const [epoch, setEpoch] = useState(0);

  // The period starts at a fleet midnight; Refresh moves it on past one.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const from = useMemo(() => periodFrom(period), [period, epoch]);
  const filters = useMemo(() => ({
    kind, status, orgs, from, q, minOverKmh: kind === "fuel" ? 0 : overBy,
  }), [kind, status, orgs, from, q, overBy]);
  const key = JSON.stringify(filters);

  // Further pages, for the filters they were read under. While any are
  // loaded the first page stops polling: a refresh under them would shift the
  // boundary between the pages.
  const [more, setMore] = useState({ key: null, rows: [], cursor: null, hasNext: false, loading: false });
  const paged = more.key === key && more.rows.length > 0;
  const first = useApiData(() => fetchAlerts(filters), [key], { pollMs: paged ? 0 : POLL_MS, keepPreviousData: true });
  const page = first.data;

  // Decisions made here, laid over the rows until the server's next answer.
  const [decided, setDecided] = useState(() => new Map());
  useEffect(() => { setDecided(new Map()); }, [page]);

  const rows = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const r of [...(page?.data ?? []), ...(more.key === key ? more.rows : [])]) {
      const k = rowKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(decided.get(k) ?? r);
    }
    return out;
  }, [page, more, key, decided]);
  const hasNext = more.key === key ? more.hasNext : Boolean(page?.hasNextPage);
  const cursor = more.key === key ? more.cursor : page?.cursor ?? null;

  const loadMore = async () => {
    if (!cursor || more.loading) return;
    setMore((m) => ({ ...(m.key === key ? m : { rows: [] }), key, cursor, hasNext: true, loading: true }));
    try {
      const next = await fetchAlerts({ ...filters, cursor });
      setMore((m) => ({
        key, rows: [...(m.key === key ? m.rows : []), ...(next?.data ?? [])],
        cursor: next?.cursor ?? null, hasNext: Boolean(next?.hasNextPage), loading: false,
      }));
    } catch (err) {
      setMore((m) => ({ ...m, loading: false }));
      setToast({ tone: "crit", text: err?.message ? `Could not load more alerts: ${err.message}` : "Could not load more alerts." });
    }
  };

  const refresh = useCallback(() => {
    setMore({ key: null, rows: [], cursor: null, hasNext: false, loading: false });
    setEpoch((n) => n + 1);
    first.revalidate();
  }, [first]);

  useEffect(() => {
    if (first.error) setToast({ tone: "crit", text: first.error.message ? `Could not load the alerts: ${first.error.message}` : "Could not load the alerts." });
  }, [first.error]);

  const rootRef = useRef(null);
  useEffect(() => watchTableLabels(rootRef.current), []);

  const orgList = useMemo(() => page?.orgs ?? [], [page]);
  const orgById = useMemo(() => new Map(orgList.map((o) => [o.id, o])), [orgList]);
  const shortName = (o) => {
    const c = companies.find((x) => x.id === companyForOrgCode(o?.code));
    return c?.short || o?.name || "—";
  };
  const kindsHeld = new Set(orgList.flatMap((o) => o.kinds));
  // The speed filter only where overspeeding can be listed: Kasulu alone has none.
  const speedingHere = orgList.some((o) => (orgs.length === 0 || orgs.includes(o.id)) && o.kinds.includes("speeding"));
  const counts = page?.counts ?? null;

  // Every chip's number under the OTHER filters (lib/alertsView countWhere).
  const nStatus = (s) => countWhere(counts, { orgs, kind, status: s });
  const nKind = (k) => countWhere(counts, { orgs, kind: k, status });
  const nOrg = (id) => countWhere(counts, { orgs: [id], kind, status });
  const total = nStatus("all");

  const activeCount = (kind !== "all") + (status !== "open") + (orgs.length > 0) + (period !== "7d") + (overBy > 0);

  const onDecided = (alert, choice, note, review) => {
    const next = {
      ...alert,
      status: choice.outcome === "ESCALATED" ? "escalated" : "deescalated",
      decision: { outcome: choice.outcome, reason: choice.reason, note, by: review?.by ?? null, at: review?.at ?? new Date().toISOString() },
      history: [...alert.history, { outcome: choice.outcome, reason: choice.reason, note, by: review?.by ?? null, at: review?.at ?? new Date().toISOString() }],
      choices: choicesAfter(alert, choice.outcome, choice.reason),
      cleared: null,
      ...(alert.kind === "fuel" ? { fuel: { ...alert.fuel, live: false } } : {}),
    };
    setDecided((m) => new Map(m).set(rowKey(alert), next));
    setMore((m) => ({ ...m, rows: m.rows.map((r) => (rowKey(r) === rowKey(alert) ? next : r)) }));
    setOpen(null);
    setToast({ tone: "ok", text: `${alert.plate}: ${decisionWords(alert.kind, next.decision).toLowerCase()}.` });
    first.revalidate();
  };

  const showOnMap = (alert) => {
    const org = orgById.get(alert.orgId);
    const company = companyForOrgCode(org?.code);
    if (!company) {
      setToast({ tone: "crit", text: `${org?.name ?? "This organisation"} is not on this dashboard.` });
      return;
    }
    if (company !== activeCompanyId) setActiveCompanyId(company);
    setSelectedVehicleId(alert.plate);
    setPendingFocusId(alert.plate);
    if (alert.kind === "fuel" && alert.fuel.live) requestIncident(alert.plate);
    setMobileActiveTab("map");
    setDesktopActiveTab("fleet");
  };

  const toggle = (alert, start = null) => {
    const k = rowKey(alert);
    setOpen((o) => (o?.key === k && !start ? null : { key: k, start }));
  };

  const pickOrg = (id) => setOrgs((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const maxFigure = Math.max(1, ...rows.map((r) => (r.kind === "fuel" ? r.fuel.litres : r.speeding.overByKmh)));

  return (
    <div className="sp4-root sys-root aud-root alr-root" ref={rootRef}>
      {toast && (
        <div className={`sp4-toast sp4-toast--${toast.tone}`} role="status" aria-live="polite">
          <span className="sp4-toast-text">{toast.text}</span>
          <button type="button" className="sp4-toast-x" aria-label="Dismiss notification" onClick={() => setToast(null)}>×</button>
        </div>
      )}

      {/* Where the period stands, for the organisations and kind picked. */}
      <div className="aud-stats alr-stats">
        <StatCard title="Open" n={nStatus("open")} of={total} color="var(--frv-s2)" loading={first.loading}
                  note="Waiting for somebody to escalate or de-escalate them." />
        <StatCard title="Escalated" n={nStatus("escalated")} of={total} color="var(--frv-crit)" loading={first.loading}
                  note="Confirmed: a theft, a faulty probe, or a real overspeed." />
        <StatCard title="De-escalated" n={nStatus("deescalated")} of={total} color="var(--frv-s3)" loading={first.loading}
                  note="Looked at and found not to be one." />
      </div>

      <div className="sp4-body">
        <TableToolbar
          summary={
            <>
              <b>{rows.length}</b>{hasNext ? "+" : ""} alert{rows.length === 1 ? "" : "s"}
              {orgs.length > 0 && <> · {orgs.map((id) => shortName(orgById.get(id))).join(", ")}</>}
              {first.stale && <span className="sp4-muted"> · updating…</span>}
            </>
          }
          loading={first.loading}
          onReload={refresh}
        />

        <FilterBar
          label="Filters"
          activeCount={activeCount}
          peek={(
            <div className="sp4-search-wrap alr-search">
              <svg className="sp4-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input className="sp4-search" type="text" placeholder="Search a plate or unit…" aria-label="Search a plate or unit"
                     value={search} onChange={(e) => setSearch(e.target.value)} />
              {search && <button type="button" className="sp4-search-clear" aria-label="Clear search" onClick={() => setSearch("")}>✕</button>}
            </div>
          )}
        >
          {orgList.length > 1 && (
            <div className="sp4-filter-group alr-orgs">
              <span className="sp4-filter-label">Organisation</span>
              <Chip on={orgs.length === 0} onClick={() => setOrgs([])} n={countWhere(counts, { kind, status })}>All</Chip>
              {orgList.map((o) => (
                <Chip key={o.id} on={orgs.includes(o.id)} onClick={() => pickOrg(o.id)} n={nOrg(o.id)} title={o.name}>
                  {shortName(o)}
                </Chip>
              ))}
            </div>
          )}
          {kindsHeld.size > 1 && (
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Alert</span>
              {KINDS.map((k) => (
                <Chip key={k.id} on={kind === k.id} onClick={() => setKind(k.id)} n={nKind(k.id)}>{k.label}</Chip>
              ))}
            </div>
          )}
          <div className="sp4-filter-group">
            <span className="sp4-filter-label">State</span>
            {STATUSES.map((s) => (
              <Chip key={s.id} on={status === s.id} onClick={() => setStatus(s.id)} n={nStatus(s.id)}>{s.label}</Chip>
            ))}
          </div>
          <div className="sp4-filter-group">
            <span className="sp4-filter-label">Period</span>
            {PERIODS.map((p) => (
              <Chip key={p.id} on={period === p.id} onClick={() => setPeriod(p.id)}>{p.label}</Chip>
            ))}
          </div>
          {kind !== "fuel" && speedingHere && (
            <div className="sp4-filter-group">
              <span className="sp4-filter-label">Over the limit by</span>
              {OVER_BY.map((v) => (
                <Chip key={v} on={overBy === v} onClick={() => setOverBy(v)}>{v === 0 ? "Any" : `${v}+ km/h`}</Chip>
              ))}
            </div>
          )}
        </FilterBar>

        {rows.length === 0 && first.loading ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Reading the Alerts">
            Fuel and overspeeding alerts from every organisation you hold.
          </EmptyNote>
        ) : rows.length === 0 && first.error ? (
          <EmptyNote icon="ti-alert-triangle" tone="error" title="The Alerts Could Not Be Loaded"
                     action={{ label: "Try again", onClick: first.retry }}>
            {first.error.message}
          </EmptyNote>
        ) : page && orgList.length === 0 ? (
          <EmptyNote icon="ti-lock" tone="warn" title="No Alerts Open to Your Role">
            Fuel alerts need fuel theft access, overspeeding needs analytics access, in an organisation you belong to.
          </EmptyNote>
        ) : rows.length === 0 && (
          <EmptyNote icon={EMPTY[status].icon} title={EMPTY[status].title}>
            {q ? `Nothing matches “${q}”.` : EMPTY[status].sub}
          </EmptyNote>
        )}

        {rows.length > 0 && (
          <div className={"sp4-table-scroll aud-units alr-table" + (first.stale ? " alr-table--stale" : "")}>
            <table className="sp4-table sp4-probe-table sp4-probe-table--comfortable">
              <thead>
                <tr>
                  <th className="sp4-th--left sp4-th--pin">Unit</th>
                  <th className="sp4-th--left">When</th>
                  <th className="sp4-th--left">Alert</th>
                  <th className="sp4-th--left">Details</th>
                  <th className="sp4-th--left">State</th>
                  <th className="sp4-th--right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const k = rowKey(a);
                  const org = orgById.get(a.orgId);
                  const expanded = open?.key === k;
                  const st = statusOf(a);
                  const h = headline(a);
                  const canDecide = org?.canDecide && a.choices.length > 0;
                  const figure = a.kind === "fuel" ? a.fuel.litres : a.speeding.overByKmh;
                  const offers = new Set(a.choices.map((c) => c.outcome));
                  return (
                    <Fragment key={k}>
                      <tr
                        className={"sp4-tr aud-tr" + (expanded ? " aud-tr--open" : "")}
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={() => toggle(a)}
                        onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); toggle(a); } }}
                      >
                        <td className="sp4-td--left sp4-td--pin">
                          <span className="sp4-reg">{a.plate}</span>
                          <span className="alr-org">{shortName(org)}</span>
                        </td>
                        <td className="sp4-td--left sys-num">{when(a.at)}</td>
                        <td className="sp4-td--left">
                          <span className={`alr-kind alr-kind--${a.kind}`}>
                            <i className={`ti ${a.kind === "fuel" ? "ti-droplet" : "ti-gauge"}`} aria-hidden="true" />
                            {a.kind === "fuel" ? "Fuel" : "Speed"}
                          </span>
                          <span className="aud-cellbar alr-figure">
                            <span><b className="sys-num">{h.figure}</b> <span className="aud-unit">{h.words}</span></span>
                            <i aria-hidden="true"><b className="aud-cellbar--alert" style={{ width: `${Math.max(2, Math.min(1, figure / maxFigure) * 100)}%` }} /></i>
                          </span>
                        </td>
                        <td className="sp4-td--left alr-details">
                          {a.kind === "fuel"
                            ? <>{ruleWords(a.fuel.rule)}{a.fuel.driverName ? ` · ${a.fuel.driverName}` : ""}</>
                            : <>+{Math.round(a.speeding.overByKmh)} km/h for {duration(a.speeding.durationSec)}{a.speeding.driverName ? ` · ${a.speeding.driverName}` : ""}</>}
                        </td>
                        <td className="sp4-td--left">
                          <span className="alr-state">
                            <span className={`sp4-pill sp4-pill--${st.tone}`} title={st.meaning}>{st.label}</span>
                            <span className="alr-state-sub">
                              {a.decision ? `${st.meaning}${a.decision.by ? ` · ${a.decision.by}` : ""}` : st.meaning}
                            </span>
                          </span>
                        </td>
                        <td className="sp4-td--right">
                          <span className="alr-actions">
                            {canDecide && offers.has("ESCALATED") && (
                              <button type="button" className="sp4-ghost-btn sp4-ghost-btn--crit"
                                      onClick={(e) => { e.stopPropagation(); toggle(a, "ESCALATED"); }}>Escalate</button>
                            )}
                            {canDecide && offers.has("DEESCALATED") && (
                              <button type="button" className="sp4-ghost-btn"
                                      onClick={(e) => { e.stopPropagation(); toggle(a, "DEESCALATED"); }}>De-escalate</button>
                            )}
                            {!canDecide && (
                              <button type="button" className="sp4-ghost-btn" onClick={(e) => { e.stopPropagation(); toggle(a); }}>
                                {expanded ? "Hide" : "Details"}
                              </button>
                            )}
                          </span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="aud-detail-row">
                          <td colSpan={6}>
                            <AlertDetail
                              key={`${k}:${open.start ?? ""}`}
                              alert={a}
                              org={org}
                              start={open.start}
                              canMap={canIn(a.orgId, "map:read")}
                              onDecided={onDecided}
                              onToast={setToast}
                              onShowOnMap={showOnMap}
                              onOpenAudit={can("fuel_audit:read") && companyForOrgCode(org?.code) === activeCompanyId
                                ? () => setDesktopActiveTab("audit") : null}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {hasNext && (
              <div className="alr-more">
                <button type="button" className="sp4-ghost-btn" onClick={loadMore} disabled={more.loading}>
                  {more.loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
