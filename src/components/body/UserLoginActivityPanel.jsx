import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "../../hooks/usePermissions";
import { listAllUserLoginActivity } from "../../api/users";
import { makeReportDoc } from "../../api/reports";
import { saveFile } from "../../api/tripReport";
import { savePdfAsJpeg } from "../../api/pdfJpeg";
import { toCsv, exportFilename, downloadCsv } from "../../lib/rosterExport";
import { nextSort, paginate, sortRows } from "../../lib/rosterView";
import { groupLoginActivity } from "../../lib/loginActivityView";
import { companyMark } from "../../lib/companyLogos";
import { loginActivityDoc, LOGIN_ACTIVITY_PDF_LIMIT } from "../../lib/reportDocs";
import { firstMessage } from "../../lib/formErrors";
import PdfPreview from "../shared/PdfPreview";
import JpegButton from "../shared/JpegButton";
import DetailSidebar, {
  DetailSidebarFacts,
  DetailSidebarIdent,
  DetailSidebarSection,
} from "../shared/DetailSidebar";
import { useReportEditor } from "../screens/ReportEditor";
import "./UserLoginActivityPanel.css";

const PAGE_SIZE = 50;
const TZ = "Africa/Nairobi";
const SORT_ACCESSORS = {
  day: (row) => Date.parse(`${row.day}T00:00:00Z`),
  user: (row) => row.user?.fullName ?? null,
  email: (row) => row.user?.email ?? null,
  role: (row) => row.user?.roles?.join(", ") || null,
  count: (row) => row.events.length,
};

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

function dayWords(day) {
  const date = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? day
    : new Intl.DateTimeFormat("en-GB", {
      timeZone: "UTC", day: "numeric", month: "short", year: "numeric",
    }).format(date);
}

function roleWords(user) {
  return user?.roles?.length ? user.roles.join(", ") : "No role assigned";
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
  const [allRows, setAllRows] = useState(null);
  const [selectedDay, setSelectedDay] = useState(null);
  const [sort, setSort] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [preparingEdit, setPreparingEdit] = useState(false);
  const [file, setFile] = useState({ busy: false, error: null });
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");
  const previewId = useRef(0);

  useEffect(() => {
    if (!readableOrgs.some((org) => org.id === selectedOrgId) && readableOrgs.length) {
      setSelectedOrgId(readableOrgs.find((org) => org.id === orgId)?.id ?? readableOrgs[0].id);
    }
  }, [readableOrgs, selectedOrgId, orgId]);

  useEffect(() => {
    setAllRows(null);
    setSort(null);
    setSelectedDay(null);
    setPage(1);
  }, [selectedOrgId, from, to]);

  const org = readableOrgs.find((item) => item.id === selectedOrgId);
  const reportOptions = {
    organisation: org?.name ?? "Fleet",
    orgCode: org?.code ?? org?.slug ?? selectedOrgId,
    from,
    to,
  };
  const editor = useReportEditor({
    orgId: selectedOrgId,
    source: `${selectedOrgId}|${from}|${to}`,
    build: () => loginActivityDoc(report ?? { rows: [] }, reportOptions),
  });

  useEffect(() => {
    if (!selectedOrgId || !from || !to || from > to) {
      setReport(null);
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    setError("");
    setReport(null);
    setAllRows(null);
    listAllUserLoginActivity(selectedOrgId, { from, to })
      .then((data) => {
        if (active) {
          setReport(data);
          setAllRows(data.rows);
        }
      })
      .catch((err) => { if (active) setError(firstMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedOrgId, from, to]);

  const choosePreset = (preset) => {
    const end = dayKey();
    const start = preset === "yesterday" ? shiftDay(end, -1)
      : preset === "7days" ? shiftDay(end, -6) : end;
    editor.guard("Change the date range", () => {
      setFrom(start);
      setTo(preset === "yesterday" ? start : end);
      setPage(1);
    });
  };

  const loadCompleteReport = useCallback(async () => {
    if ((report?.total ?? 0) > LOGIN_ACTIVITY_PDF_LIMIT) {
      throw new Error(`This PDF supports up to ${LOGIN_ACTIVITY_PDF_LIMIT.toLocaleString()} successful sign-ins. Narrow the date range.`);
    }
    const complete = await listAllUserLoginActivity(selectedOrgId, { from, to });
    if (complete.rows.length > LOGIN_ACTIVITY_PDF_LIMIT) {
      throw new Error(`This PDF supports up to ${LOGIN_ACTIVITY_PDF_LIMIT.toLocaleString()} successful sign-ins. Narrow the date range.`);
    }
    return complete;
  }, [report?.total, selectedOrgId, from, to]);

  const exportReport = useCallback(async () => {
    if (!selectedOrgId || !from || !to || from > to) return;
    setExporting(true);
    setError("");
    try {
      const { rows } = await listAllUserLoginActivity(selectedOrgId, { from, to });
      const columns = [
        { key: "loggedInAt", label: "Date and time (Africa/Nairobi)", value: (row) => fmtDateTime(row.loggedInAt) },
        { key: "fullName", label: "Full name", value: (row) => row.user?.fullName ?? "" },
        { key: "email", label: "Email", value: (row) => row.user?.email ?? "" },
        { key: "roles", label: "Role", value: (row) => row.user?.roles?.join(", ") ?? "" },
        { key: "groups", label: "Groups", value: (row) => row.user?.groups?.join("; ") ?? "" },
      ];
      const filename = exportFilename(`login-activity-${org?.name ?? "organisation"}-${from}-${to}`);
      downloadCsv(toCsv(rows, columns), filename);
    } catch (err) {
      setError(firstMessage(err));
    } finally {
      setExporting(false);
    }
  }, [selectedOrgId, from, to, org]);

  const editReport = async () => {
    if (editor.doc) {
      editor.startEditing();
      return;
    }
    setPreparingEdit(true);
    setError("");
    try {
      const complete = await loadCompleteReport();
      editor.startEditing(loginActivityDoc(complete, reportOptions));
    } catch (err) {
      setError(firstMessage(err));
    } finally {
      setPreparingEdit(false);
    }
  };

  const makePdf = async (landscape = false) => {
    if (editor.edited) return editor.make(landscape);
    const complete = await loadCompleteReport();
    return makeReportDoc({
      orgId: selectedOrgId,
      doc: loginActivityDoc(complete, reportOptions),
      landscape,
    });
  };

  const save = async (as, landscape = false) => {
    if (!report || file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makePdf(landscape);
      if (as === "jpeg") await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({
        busy: false,
        error: `The ${as === "jpeg" ? "JPEG" : "PDF"} could not be made: ${err?.message ?? err}`,
      });
    }
  };

  const previewPdf = async () => {
    if (!report) return;
    const id = ++previewId.current;
    setPreview({ status: "loading" });
    try {
      const made = await makePdf();
      if (id === previewId.current) setPreview({ status: "done", ...made });
    } catch (err) {
      if (id === previewId.current) setPreview({ status: "error", message: err?.message ?? String(err) });
    }
  };

  const closePreview = () => {
    previewId.current += 1;
    setPreview(null);
  };

  const changeRange = (nextFrom, nextTo) => editor.guard("Change the date range", () => {
    setFrom(nextFrom);
    setTo(nextTo);
    setPage(1);
  });

  const sortBy = (key) => {
    const next = nextSort(sort, key);
    setPage(1);
    setSort(next);
  };

  const dailyRows = useMemo(() => groupLoginActivity(allRows ?? []), [allRows]);
  const sortedRows = useMemo(
    () => sortRows(dailyRows, sort, SORT_ACCESSORS),
    [dailyRows, sort],
  );
  const completePage = useMemo(
    () => paginate(sortedRows, page, PAGE_SIZE),
    [sortedRows, page],
  );
  const visibleRows = completePage.slice;
  const totalPages = completePage.pageCount;
  const noRange = !from || !to || from > to;
  const selectedOrgMark = companyMark(org);
  const statValues = [
    report?.systemUsers,
    report?.everLoggedIn,
    report?.total,
  ];
  const statMax = Math.max(0, ...statValues.filter(Number.isFinite));
  const stats = [
    { key: "accounts", label: "System accounts", value: report?.systemUsers },
    { key: "logged-in", label: "Accounts ever logged in", value: report?.everLoggedIn },
    { key: "sign-ins", label: "Successful sign-ins · selected period", value: report?.total },
  ];

  return (
    <section className="ua-login" aria-labelledby="ua-login-title">
      <div className="ua-login__inner">
        <header className="ua-login__head">
          <div>
            <h1 id="ua-login-title" className="ua-login__title">Login Activity</h1>
          </div>
          {org && (
            <label className="ua-login__org">
              <span>Organisation</span>
              <select value={selectedOrgId} onChange={(event) => editor.guard("Change the organisation", () => {
                setSelectedOrgId(event.target.value);
                setPage(1);
              })}>
                {readableOrgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
        </header>

        <div className="ua-login__stats" aria-live="polite">
          {stats.map(({ key, label, value }) => {
            const width = Number.isFinite(value) && statMax > 0
              ? `${(value / statMax) * 100}%`
              : "0%";
            return (
              <article className={`ua-login__stat ua-login__stat--${key}`} key={key}>
                <span className="ua-login__stat-label">{label}</span>
                <strong className="ua-login__stat-value">
                  {Number.isFinite(value) ? value.toLocaleString() : "—"}
                </strong>
                <div className="ua-login__stat-track" aria-hidden="true">
                  <span className="ua-login__stat-fill" style={{ width }} />
                </div>
              </article>
            );
          })}
        </div>

        <div className="ua-login__filters">
          <div className="ua-login__presets" role="group" aria-label="Date range presets">
            <button type="button" className="ua-login__button" onClick={() => choosePreset("today")}>Today</button>
            <button type="button" className="ua-login__button" onClick={() => choosePreset("yesterday")}>Yesterday</button>
            <button type="button" className="ua-login__button" onClick={() => choosePreset("7days")}>7 days</button>
          </div>
          <label className="ua-login__date">
            <span>From</span>
            <input type="date" value={from} max={today} onChange={(event) => changeRange(event.target.value, to)} />
          </label>
          <label className="ua-login__date">
            <span>To</span>
            <input type="date" value={to} max={today} onChange={(event) => changeRange(from, event.target.value)} />
          </label>
        </div>

        {noRange && <p className="ua-login__message" role="alert">The start date must be on or before the end date.</p>}
        {!readableOrgs.length && <p className="ua-login__message">No organisations are available with user read access.</p>}
        {error && <p className="ua-login__error" role="alert">{error}</p>}

        <div className="ua-login__tablehead">
          <p>
            {report?.total?.toLocaleString() ?? "—"} successful sign-ins
            <span>{` · ${org?.name ?? "Organisation"} · ${dayWords(from)}${from === to ? "" : ` – ${dayWords(to)}`}`}</span>
          </p>
          <div className="ua-login__tools">
            {editor.problem && <span className="ua-login__error" role="alert">{editor.problem}</span>}
            {editor.doc ? (
              <>
                {editor.edited && (
                  <button type="button" className="ua-login__button" onClick={editor.undo} disabled={loading || preparingEdit || Boolean(file.busy)}>
                    Undo edits
                  </button>
                )}
                <button type="button" className="ua-login__button" onClick={() => editor.startEditing()}
                        disabled={loading || preparingEdit || Boolean(file.busy)} title="Edit the complete report document">
                  <i className="ti ti-pencil" aria-hidden="true" /> {editor.edited ? "Edited" : "Edit"}
                </button>
              </>
            ) : (
              <button type="button" className="ua-login__button" onClick={editReport}
                      disabled={loading || preparingEdit || exporting || !report?.total || noRange}>
                <i className="ti ti-pencil" aria-hidden="true" /> {preparingEdit ? "Loading all sign-ins…" : "Edit"}
              </button>
            )}
            <button type="button" className="ua-login__button" onClick={exportReport}
                    disabled={loading || exporting || preparingEdit || !report?.total || noRange}
                    title="Export every successful sign-in in this date range">
              {exporting ? "Preparing CSV…" : "CSV"}
            </button>
            <JpegButton onSave={(landscape) => save("jpeg", landscape)} disabled={loading || exporting || preparingEdit || Boolean(file.busy) || !report?.total || noRange}
                        busy={file.busy === "jpeg"} title="The PDF report as an image" />
            <JpegButton word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save("pdf", landscape)}
                        disabled={loading || exporting || preparingEdit || Boolean(file.busy) || !report?.total || noRange}
                        busy={file.busy === "pdf"} title="The report as a PDF" />
            <button type="button" className="ua-login__button" onClick={previewPdf}
                    disabled={loading || exporting || preparingEdit || Boolean(file.busy) || !report?.total || noRange}
                    title="Preview the PDF before saving it">
              <i className="ti ti-eye" aria-hidden="true" /> Preview
            </button>
          </div>
        </div>
        {file.error && <p className="ua-login__error" role="alert">{file.error}</p>}

        {preview && (
          <PdfPreview
            state={preview}
            title="Login Activity Report"
            caption={`${dayWords(from)}${from === to ? "" : ` – ${dayWords(to)}`} · ${org?.name ?? "Organisation"}`}
            edited={editor.edited ? 1 : 0}
            onRetry={previewPdf}
            onClose={closePreview}
          />
        )}

        <div className="ua-login__tablewrap ua-table-scroll">
          {loading ? (
            <p className="ua-login__empty" role="status">Loading login activity…</p>
          ) : error ? (
            <p className="ua-login__empty">Login activity could not be loaded.</p>
          ) : !report?.rows?.length ? (
            <p className="ua-login__empty">No successful sign-ins in this date range.</p>
          ) : (
            <table className="ua-table">
              <thead>
                <tr>
                  <th scope="col">Organisation</th>
                  {[
                    ["day", "Date"],
                    ["user", "User"],
                    ["email", "Email"],
                    ["role", "Role"],
                    ["count", "Sign-ins"],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      aria-sort={sort?.key === key
                        ? sort.dir === "asc" ? "ascending" : "descending"
                        : "none"}
                    >
                      <button
                        type="button"
                        className="ua-sort"
                        disabled={loading}
                        onClick={() => sortBy(key)}
                        aria-label={`Sort by ${label}`}
                      >
                        {label}
                        {sort?.key === key && (
                          <span className="ua-sort__dir" aria-hidden="true">
                            {sort.dir === "asc" ? "▲" : "▼"}
                          </span>
                        )}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    className="ua-row ua-login__row"
                    key={row.key}
                    tabIndex={0}
                    aria-label={`${row.user?.fullName ?? "Unknown user"}, ${dayWords(row.day)}, ${row.events.length} sign-ins. Open details.`}
                    onClick={() => setSelectedDay(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedDay(row);
                      }
                    }}
                  >
                    <td className="ua-login__orgcell" data-label="Organisation">
                      {selectedOrgMark
                        ? <img className="ua-login__orgmark" src={selectedOrgMark} alt="" />
                        : <span className="ua-login__orgmark ua-login__orgmark--letter" aria-hidden="true">
                          {org?.name?.trim()[0]?.toUpperCase() ?? "?"}
                        </span>}
                      <span>{org?.name ?? "Organisation"}</span>
                    </td>
                    <td className="ua-row__num" data-label="Date">{dayWords(row.day)}</td>
                    <td data-label="User">{row.user?.fullName ?? "Unknown user"}</td>
                    <td data-label="Email">{row.user?.email ?? "—"}</td>
                    <td data-label="Role">{roleWords(row.user)}</td>
                    <td className="ua-row__num" data-label="Sign-ins">
                      <span className="ua-login__count">{row.events.length}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {report?.total > 0 && (
          <footer className="ua-login__pager">
            <button type="button" className="ua-login__button" disabled={page <= 1 || loading}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}>← Prev</button>
            <span aria-live="polite">
              Page {page} of {totalPages}
              <small>{` · ${dailyRows.length.toLocaleString()} user-days · ${report.total.toLocaleString()} sign-ins`}</small>
            </span>
            <button type="button" className="ua-login__button" disabled={page >= totalPages || loading}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}>Next →</button>
          </footer>
        )}
      </div>
      {selectedDay && (
        <DetailSidebar
          title="Login Activity"
          label={`Login details for ${selectedDay.user?.fullName ?? "user"} on ${dayWords(selectedDay.day)}`}
          itemKey={selectedDay.key}
          onClose={() => setSelectedDay(null)}
        >
          <DetailSidebarIdent
            kind="User sign-in summary"
            name={selectedDay.user?.fullName ?? "Unknown user"}
            sub={`${org?.name ?? "Organisation"} · ${dayWords(selectedDay.day)}`}
          />
          <DetailSidebarFacts facts={[
            { label: "Sign-ins", value: selectedDay.events.length },
            { label: "Role", value: roleWords(selectedDay.user) },
            { label: "Groups", value: selectedDay.user?.groups?.length ? selectedDay.user.groups.join(", ") : "Ungrouped" },
          ]} />
          <DetailSidebarSection title="Account">
            <ul className="dsb__cards">
              <li className="dsb__card">
                <dl>
                  <dt>Email</dt>
                  <dd>{selectedDay.user?.email ?? "—"}</dd>
                  <dt>Organisation</dt>
                  <dd>{org?.name ?? "Organisation"}</dd>
                </dl>
              </li>
            </ul>
          </DetailSidebarSection>
          <DetailSidebarSection title="Sign-in times">
            <ul className="dsb__cards dsb__cards--timeline">
              {selectedDay.events.map((event) => (
                <li className="dsb__card" key={event.id}>
                  <div className="dsb__card-head">{fmtDateTime(event.loggedInAt)}</div>
                  <dl>
                    <dt>Date</dt>
                    <dd>{dayWords(selectedDay.day)}</dd>
                    <dt>Time zone</dt>
                    <dd>Africa/Nairobi</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </DetailSidebarSection>
        </DetailSidebar>
      )}
      {editor.overlay}
    </section>
  );
}
