/*
 * Users › IAM › Deactivated Units (operator, 2026-11-20): the units Wialon
 * (Controltech) has deactivated, and those already removed from it. The
 * server's `missing` list is not shown (operator: no "Not in Wialon" tab). Read-only: fleet-server
 * iam/wialon-deactivated, System Administrator only on both sides. Since
 * fleet-server #137 the registry sync hides deactivated units by itself, so
 * this page is the record of what was hidden and why.
 *
 * Laid out as Login Activity (UserLoginActivityPanel): a masthead of figures
 * and the organisation, a toolbar, then one full-bleed grid whose heads stay
 * pinned while its rows scroll.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchDeactivatedUnits } from "../../api/iam";
import { downloadTableCsv, exportExcelVia } from "../../utils/tableExport";
import EmptyNote from "../shared/EmptyNote";
import "./UserDeactivatedUnitsPanel.css";

const when = (iso) => (iso
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso))
  : "-");
const whenFull = (iso) => (iso
  ? new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Nairobi", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso))
  : "-");

/** A plate the sync qualified to keep it unique ("NAME · wialon:123") reads as the name alone. */
const plateText = (plate, name) => {
  const p = String(plate ?? "").replace(/\s*·\s*wialon:\d+$/, "").trim();
  return !p || p === String(name ?? "").trim() ? "-" : p;
};

const VIEWS = [
  { id: "deactivated", label: "Deactivated in Wialon" },
  { id: "removed", label: "Removed from Wialon" },
];

export default function UserDeactivatedUnitsPanel() {
  const [state, setState] = useState({ status: "loading", data: null, error: null });
  const [org, setOrg] = useState("all");
  const [view, setView] = useState("deactivated");
  const [query, setQuery] = useState("");
  const [excel, setExcel] = useState({ busy: false, error: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, status: "loading", error: null }));
    try {
      setState({ status: "done", data: await fetchDeactivatedUnits(), error: null });
    } catch (err) {
      setState((s) => ({ status: "error", data: s.data, error: err?.message ?? String(err) }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const data = state.data;
  const companies = useMemo(() => data?.companies ?? [], [data]);
  const shown = useMemo(() => companies.filter((c) => org === "all" || c.orgCode === org), [companies, org]);
  const rows = useMemo(() => {
    const tag = (list) => shown.flatMap((c) => (c[list] ?? []).map((u) => ({ ...u, company: c.orgName })));
    return { deactivated: tag("deactivated"), removed: tag("removed") };
  }, [shown]);

  const failed = shown.filter((c) => c.error);
  const loading = state.status === "loading";

  // Every view in one file, a row per unit, for the sites to confirm.
  const fileRows = [
    ...rows.deactivated.map((u) => [u.company, u.name, plateText(u.plate, u.name), "Deactivated in Wialon", when(u.deactivatedAt), when(u.lastMessageAt)]),
    ...rows.removed.map((u) => [u.company, u.name, plateText(u.plate, u.name), "Removed from Wialon", "-", "-"]),
  ];
  const exportCsv = () => downloadTableCsv({
    head: ["Organisation", "Unit", "Plate", "Status", "Deactivated", "Last message"],
    body: fileRows,
    filenameSlug: "deactivated-units",
    title: "Deactivated Units",
    sheetName: "Deactivated units",
  });
  const exportExcel = async () => {
    setExcel({ busy: true, error: null });
    try {
      await exportExcelVia(exportCsv);
      setExcel({ busy: false, error: null });
    } catch (err) {
      setExcel({ busy: false, error: err?.message ?? String(err) });
    }
  };

  // Unit, plate or organisation, ignoring case and spacing ("kcv071a" finds "KCV 071A").
  const squash = (s) => String(s ?? "").toLowerCase().replace(/[\s\-·:]+/g, "");
  const q = squash(query);
  const list = q
    ? rows[view].filter((u) => [u.name, u.plate, u.company].some((f) => squash(f).includes(q)))
    : rows[view];

  return (
    <section className="dua" aria-labelledby="dua-title">
      <header className="dua__masthead">
        <h1 id="dua-title" className="dua__visually-hidden">Deactivated Units</h1>
        <dl className="dua__kpis" aria-live="polite" aria-busy={loading}>
          <div className="dua__kpi dua__kpi--crit"><dd>{data ? rows.deactivated.length : "–"}</dd><dt>Deactivated</dt></div>
          <div className="dua__kpi"><dd>{data ? rows.removed.length : "–"}</dd><dt>Removed</dt></div>
        </dl>
        <label className="dua__org">
          <span className="dua__label">Organisation</span>
          <select value={org} onChange={(e) => setOrg(e.target.value)} disabled={!companies.length}>
            <option value="all">All organisations</option>
            {companies.map((c) => <option key={c.orgCode} value={c.orgCode}>{c.orgName}</option>)}
          </select>
        </label>
      </header>

      <div className="dua__toolbar">
        <div className="dua__views" role="tablist" aria-label="Units">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" role="tab" className="dua__view"
                    aria-selected={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
        <label className="dua__search">
          <i className="ti ti-search" aria-hidden="true" />
          <span className="dua__visually-hidden">Search units</span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search unit or plate" />
        </label>
        <div className="dua__tools">
          {data?.checkedAt && <span className="dua__checked">Checked {whenFull(data.checkedAt)}</span>}
          <button type="button" className="dua__btn" onClick={load} disabled={loading}>
            <i className="ti ti-refresh" aria-hidden="true" /> {loading ? "Checking…" : "Refresh"}
          </button>
          <button type="button" className="dua__btn" onClick={exportCsv} disabled={!fileRows.length}>
            <i className="ti ti-file-type-csv" aria-hidden="true" /> CSV
          </button>
          <button type="button" className="dua__btn" onClick={exportExcel} disabled={!fileRows.length || excel.busy}>
            <i className="ti ti-file-spreadsheet" aria-hidden="true" /> {excel.busy ? "Preparing…" : "Excel"}
          </button>
        </div>
      </div>

      {(state.error || excel.error || data?.activationError || failed.length > 0) && (
        <div className="dua__notices" role="alert">
          {state.error && <p className="dua__error">Could not check Wialon: {state.error}</p>}
          {excel.error && <p className="dua__error">Excel file not prepared: {excel.error}</p>}
          {data?.activationError && <p className="dua__error">Activation status not read: {data.activationError}</p>}
          {failed.map((c) => <p key={c.orgCode} className="dua__error">{c.orgName}: {c.error}</p>)}
        </div>
      )}

      <div className="dua__tablewrap">
        {!data && loading ? (
          <EmptyNote icon="ti-loader-2" tone="busy" title="Checking Wialon" />
        ) : list.length === 0 ? (
          <EmptyNote icon={q ? "ti-search" : "ti-circle-check"} tone={q ? "info" : "ok"} title={q ? "No matching units" : "No units"} />
        ) : (
          <table className="dua__table">
            <thead>
              {view === "deactivated" && (
                <tr><th>Organisation</th><th>Unit</th><th>Plate</th><th>Deactivated</th><th>Last message</th></tr>
              )}
              {view === "removed" && (
                <tr><th>Organisation</th><th>Unit</th><th>Plate</th></tr>
              )}
            </thead>
            <tbody>
              {view === "deactivated" && list.map((u) => (
                <tr key={`${u.company}-${u.unitId}`}>
                  <td>{u.company}</td><td className="dua__unit">{u.name}</td><td>{plateText(u.plate, u.name)}</td>
                  <td>{when(u.deactivatedAt)}</td><td>{when(u.lastMessageAt)}</td>
                </tr>
              ))}
              {view === "removed" && list.map((u) => (
                <tr key={u.externalId}>
                  <td>{u.company}</td><td className="dua__unit">{u.name}</td><td>{plateText(u.plate, u.name)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
