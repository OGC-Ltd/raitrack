import { useCallback, useEffect, useMemo, useState } from "react";
import { usePermissions } from "../../hooks/usePermissions";
import { listUserLoginActivity } from "../../api/users";
import { toCsv, exportFilename, downloadCsv } from "../../lib/rosterExport";
import { firstMessage } from "../../lib/formErrors";
import "./UserLoginActivityPanel.css";

const PAGE_SIZE = 50;
const EXPORT_SIZE = 100;
const TZ = "Africa/Nairobi";

function dayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftDay(day, offset) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function fmtDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat(undefined, {
      timeZone: TZ, day: "numeric", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(date);
}

export default function UserLoginActivityPanel() {
  const { orgId, orgsWhere } = usePermissions();
  const readableOrgs = orgsWhere("user:read");
  const today = useMemo(() => dayKey(), []);
  const [selectedOrgId, setSelectedOrgId] = useState(orgId ?? "");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!readableOrgs.some((org) => org.id === selectedOrgId) && readableOrgs.length) {
      setSelectedOrgId(readableOrgs.find((org) => org.id === orgId)?.id ?? readableOrgs[0].id);
    }
  }, [readableOrgs, selectedOrgId, orgId]);

  const org = readableOrgs.find((item) => item.id === selectedOrgId);

  useEffect(() => {
    if (!selectedOrgId || !from || !to || from > to) {
      setReport(null);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError("");
    listUserLoginActivity(selectedOrgId, { from, to, page, limit: PAGE_SIZE })
      .then((data) => { if (active) setReport(data); })
      .catch((err) => { if (active) setError(firstMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedOrgId, from, to, page]);

  const choosePreset = useCallback((preset) => {
    const end = dayKey();
    const start = preset === "yesterday" ? shiftDay(end, -1)
      : preset === "7days" ? shiftDay(end, -6) : end;
    setFrom(start);
    setTo(preset === "yesterday" ? start : end);
    setPage(1);
  }, []);

  const exportReport = useCallback(async () => {
    if (!selectedOrgId || !from || !to || from > to) return;
    setExporting(true);
    setError("");
    try {
      const first = await listUserLoginActivity(selectedOrgId, {
        from, to, page: 1, limit: EXPORT_SIZE,
      });
      const rows = [...(first?.rows ?? [])];
      const pages = Math.ceil((first?.total ?? rows.length) / EXPORT_SIZE);
      for (let nextPage = 2; nextPage <= pages; nextPage += 1) {
        const next = await listUserLoginActivity(selectedOrgId, {
          from, to, page: nextPage, limit: EXPORT_SIZE,
        });
        rows.push(...(next?.rows ?? []));
      }
      const columns = [
        { key: "loggedInAt", label: "Date and time (Africa/Nairobi)", value: (row) => fmtDateTime(row.loggedInAt) },
        { key: "fullName", label: "Full name", value: (row) => row.user.fullName },
        { key: "email", label: "Email", value: (row) => row.user.email ?? "" },
        { key: "groups", label: "Groups", value: (row) => row.user.groups.join("; ") },
      ];
      const filename = exportFilename(`login-activity-${org?.name ?? "organisation"}-${from}-${to}`);
      downloadCsv(toCsv(rows, columns), filename);
    } catch (err) {
      setError(firstMessage(err));
    } finally {
      setExporting(false);
    }
  }, [selectedOrgId, from, to, org]);

  const totalPages = Math.max(1, Math.ceil((report?.total ?? 0) / PAGE_SIZE));
  const noRange = from > to;

  return (
    <section className="ua-login" aria-labelledby="ua-login-title">
      <header className="ua-login__head">
        <div>
          <h1 id="ua-login-title" className="ua-login__title">Login activity</h1>
          <p className="ua-login__hint">
            Successful sign-ins only · East Africa Time. Before this was enabled, last-login dates use the latest stored session; earlier individual sign-ins are unavailable.
          </p>
        </div>
        {org && (
          <label className="ua-login__org">
            <span>Organisation</span>
            <select value={selectedOrgId} onChange={(event) => {
              setSelectedOrgId(event.target.value);
              setPage(1);
            }}>
              {readableOrgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
        )}
      </header>

      <div className="ua-login__filters">
        <div className="ua-login__presets" role="group" aria-label="Date range presets">
          <button type="button" className="ua-login__button" onClick={() => choosePreset("today")}>Today</button>
          <button type="button" className="ua-login__button" onClick={() => choosePreset("yesterday")}>Yesterday</button>
          <button type="button" className="ua-login__button" onClick={() => choosePreset("7days")}>7 days</button>
        </div>
        <label className="ua-login__date">
          <span>From</span>
          <input type="date" value={from} max={today} onChange={(event) => {
            setFrom(event.target.value);
            setPage(1);
          }} />
        </label>
        <label className="ua-login__date">
          <span>To</span>
          <input type="date" value={to} max={today} onChange={(event) => {
            setTo(event.target.value);
            setPage(1);
          }} />
        </label>
        <button type="button" className="ua-login__button ua-login__export"
                onClick={exportReport} disabled={loading || exporting || !report || report.total === 0 || noRange}>
          {exporting ? "Preparing CSV…" : "Export CSV"}
        </button>
      </div>

      {noRange && <p className="ua-login__message" role="alert">The start date must be on or before the end date.</p>}
      {error && <p className="ua-login__error" role="alert">{error}</p>}

      <div className="ua-login__stats" aria-live="polite">
        <article className="ua-login__stat">
          <span className="ua-login__stat-label">System accounts</span>
          <strong>{report?.systemUsers ?? "—"}</strong>
        </article>
        <article className="ua-login__stat">
          <span className="ua-login__stat-label">Ever logged in</span>
          <strong>{report?.everLoggedIn ?? "—"}</strong>
        </article>
        <article className="ua-login__stat">
          <span className="ua-login__stat-label">Never logged in</span>
          <strong>{report ? report.systemUsers - report.everLoggedIn : "—"}</strong>
        </article>
      </div>

      <div className="ua-login__tablewrap">
        {loading ? (
          <p className="ua-login__empty" role="status">Loading login activity…</p>
        ) : error ? (
          <p className="ua-login__empty">Login activity could not be loaded.</p>
        ) : !report?.rows?.length ? (
          <p className="ua-login__empty">No successful sign-ins in this date range.</p>
        ) : (
          <table className="ua-login__table">
            <thead>
              <tr><th>Date and time</th><th>User</th><th>Email</th><th>Groups</th></tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Date and time">{fmtDateTime(row.loggedInAt)}</td>
                  <td data-label="User">{row.user.fullName}</td>
                  <td data-label="Email">{row.user.email ?? "—"}</td>
                  <td data-label="Groups">{row.user.groups.length ? row.user.groups.join(", ") : "ungrouped"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {report?.total > 0 && (
        <footer className="ua-login__pager">
          <span>{report.total.toLocaleString()} sign-ins</span>
          <div>
            <button type="button" className="ua-login__button" disabled={page <= 1 || loading}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button>
            <span>Page {page} of {totalPages}</span>
            <button type="button" className="ua-login__button" disabled={page >= totalPages || loading}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next</button>
          </div>
        </footer>
      )}
    </section>
  );
}
