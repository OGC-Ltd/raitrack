import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePermissions } from "../../hooks/usePermissions";
import { listAllUserLoginActivity, listLoginActivityAcrossOrgs } from "../../api/users";
import { makeReportDoc } from "../../api/reports";
import { saveFile } from "../../api/tripReport";
import { savePdfAsJpeg } from "../../api/pdfJpeg";
import { toCsv, exportFilename, downloadCsv } from "../../lib/rosterExport";
import { nextSort, paginate, sortRows } from "../../lib/rosterView";
import { groupLoginActivity } from "../../lib/loginActivityView";
import { loginActivityDoc, LOGIN_ACTIVITY_PDF_LIMIT } from "../../lib/reportDocs";
import { firstMessage } from "../../lib/formErrors";
import PdfPreview from "../shared/PdfPreview";
import EmptyNote from "../shared/EmptyNote";
import { companyMark } from "../../lib/companyLogos";
import TablePager, { PAGE_STEP } from "./TablePager";
import JpegButton from "../shared/JpegButton";
import DetailSidebar, {
  DetailSidebarFacts,
  DetailSidebarIdent,
  DetailSidebarSection,
} from "../shared/DetailSidebar";
import { useReportEditor } from "../screens/ReportEditor";
import "./UserLoginActivityPanel.css";

/** The picker's "All organisations": every organisation this account reads users in. */
const ALL = "__all__";

/** An organisation's mark: its logo, a building for "All", its initial when it has no logo. */
function OrgMark({ org, all = false }) {
  if (all) {
    return <span className="ua-login__orgmark ua-login__orgmark--all" aria-hidden="true"><i className="ti ti-building-community" /></span>;
  }
  const mark = companyMark(org);
  return mark
    ? <img className="ua-login__orgmark" src={mark} alt="" />
    : <span className="ua-login__orgmark ua-login__orgmark--letter" aria-hidden="true">{(org?.name ?? "?").charAt(0)}</span>;
}

/** An organisation as the page names it: its mark, then its name. */
function OrgName({ org }) {
  return (
    <span className="ua-login__orgname">
      <OrgMark org={org} />
      <span className="ua-login__orgtext">{org?.name ?? "Organisation"}</span>
    </span>
  );
}
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

/** Where a moment falls in the Nairobi day, 0 at midnight to 1 at the next. */
function dayFraction(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, Number(part)]));
  return (values.hour * 60 + values.minute) / 1440;
}

function clockWords(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown time"
    : new Intl.DateTimeFormat("en-GB", {
      timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(date);
}

function rangeWords(from, to) {
  return from === to ? dayWords(from) : `${dayWords(from)} to ${dayWords(to)}`;
}

/** The day as a 24-hour strip, one mark per sign-in: when people sign in, not just how often. */
function DayStrip({ events, large = false }) {
  const marks = events
    .map((event) => ({ id: event.id, at: dayFraction(event.loggedInAt), time: clockWords(event.loggedInAt) }))
    .filter((mark) => mark.at != null);
  const label = marks.length
    ? `Signed in at ${marks.map((mark) => mark.time).reverse().join(", ")}`
    : "No sign-in times";
  return (
    <span className={large ? "ua-login__strip ua-login__strip--large" : "ua-login__strip"} role="img" aria-label={label}>
      {marks.map((mark) => (
        <span className="ua-login__mark" key={mark.id} style={{ "--at": mark.at }} />
      ))}
    </span>
  );
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

  // A stable key for the readable organisations: orgsWhere returns a new array each render
  const readableKey = readableOrgs.map((item) => item.id).join(",");
  const readableIds = useMemo(() => (readableKey ? readableKey.split(",") : []), [readableKey]);
  const allowAll = readableIds.length > 1;
  const isAll = selectedOrgId === ALL;

  useEffect(() => {
    if (selectedOrgId === ALL ? !allowAll : !readableIds.includes(selectedOrgId) && readableIds.length) {
      setSelectedOrgId(readableIds.includes(orgId) ? orgId : readableIds[0] ?? "");
    }
  }, [readableIds, allowAll, selectedOrgId, orgId]);

  useEffect(() => {
    setAllRows(null);
    setSort(null);
    setSelectedDay(null);
    setPage(1);
  }, [selectedOrgId, from, to]);

  const org = isAll ? null : readableOrgs.find((item) => item.id === selectedOrgId);
  const orgName = isAll ? "All organisations" : org?.name ?? "Organisation";
  const orgById = useMemo(
    () => new Map(readableOrgs.map((item) => [item.id, item])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readableKey],
  );
  const orgNameById = useMemo(
    () => new Map(readableOrgs.map((item) => [item.id, item.name])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [readableKey],
  );
  const rowOrgIds = (row) => (row.orgIds ?? row.events?.flatMap((event) => event.orgIds ?? []) ?? [])
    .filter((id, i, all) => all.indexOf(id) === i);
  const rowOrgs = (row) => rowOrgIds(row).map((id) => orgNameById.get(id) ?? "Organisation");
  // Up to three marks overlapping, then the names on one line: the first, and how many more
  const orgList = (row, { full = false } = {}) => {
    const orgs = rowOrgIds(row).map((id) => orgById.get(id) ?? { name: "Organisation" });
    const names = orgs.map((item) => item.name);
    const more = orgs.length - 1;
    return (
      <span className="ua-login__orglist" title={names.join(", ")}>
        <span className="ua-login__orgstack" aria-hidden="true">
          {orgs.slice(0, 3).map((item, i) => <OrgMark key={item.id ?? i} org={item} />)}
        </span>
        <span className="ua-login__orgtext">
          {full || more < 1 ? names.join(", ") : <>{names[0]} <span className="ua-login__orgmore">+{more}</span></>}
        </span>
      </span>
    );
  };
  // The letterhead and the report store are per organisation: "All" draws on this account's own
  const docOrgId = isAll ? (readableIds.includes(orgId) ? orgId : readableIds[0]) : selectedOrgId;
  const fetchReport = useCallback(
    () => (isAll
      ? listLoginActivityAcrossOrgs(readableIds, { from, to })
      : listAllUserLoginActivity(selectedOrgId, { from, to })),
    [isAll, readableIds, selectedOrgId, from, to],
  );
  const reportOptions = {
    organisation: isAll ? "All organisations" : org?.name ?? "Fleet",
    orgCode: isAll ? "ALL" : org?.code ?? org?.slug ?? selectedOrgId,
    from,
    to,
  };
  const editor = useReportEditor({
    orgId: docOrgId,
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
    fetchReport()
      .then((data) => {
        if (active) {
          setReport(data);
          setAllRows(data.rows);
        }
      })
      .catch((err) => { if (active) setError(firstMessage(err)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [selectedOrgId, from, to, fetchReport]);

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
    const complete = await fetchReport();
    if (complete.rows.length > LOGIN_ACTIVITY_PDF_LIMIT) {
      throw new Error(`This PDF supports up to ${LOGIN_ACTIVITY_PDF_LIMIT.toLocaleString()} successful sign-ins. Narrow the date range.`);
    }
    return complete;
  }, [report?.total, fetchReport]);

  const exportReport = useCallback(async () => {
    if (!selectedOrgId || !from || !to || from > to) return;
    setExporting(true);
    setError("");
    try {
      const { rows } = await fetchReport();
      const columns = [
        ...(isAll ? [{ key: "organisations", label: "Organisation", value: (row) => rowOrgs(row).join("; ") }] : []),
        { key: "loggedInAt", label: "Date and time (Africa/Nairobi)", value: (row) => fmtDateTime(row.loggedInAt) },
        { key: "fullName", label: "Full name", value: (row) => row.user?.fullName ?? "" },
        { key: "email", label: "Email", value: (row) => row.user?.email ?? "" },
        { key: "roles", label: "Role", value: (row) => row.user?.roles?.join(", ") ?? "" },
        { key: "groups", label: "Groups", value: (row) => row.user?.groups?.join("; ") ?? "" },
      ];
      const filename = exportFilename(`login-activity-${isAll ? "all-organisations" : org?.name ?? "organisation"}-${from}-${to}`);
      downloadCsv(toCsv(rows, columns), filename);
    } catch (err) {
      setError(firstMessage(err));
    } finally {
      setExporting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrgId, from, to, org, isAll, fetchReport]);

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

  const makePdf = async (landscape) => {
    if (editor.edited) return editor.make(landscape);
    const complete = await loadCompleteReport();
    return makeReportDoc({
      orgId: docOrgId,
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
    // The app's one pager and its step (TablePager), as Users and Groups turn
    () => paginate(sortedRows, page, PAGE_STEP),
    [sortedRows, page],
  );
  const visibleRows = completePage.slice;
  const noRange = !from || !to || from > to;
  const figure = (value) => (Number.isFinite(value) ? value.toLocaleString() : null);
  const activePreset = from === today && to === today ? "today"
    : from === shiftDay(today, -1) && to === from ? "yesterday"
      : from === shiftDay(today, -6) && to === today ? "7days" : null;
  const busyAny = loading || exporting || preparingEdit || Boolean(file.busy);
  const noReport = !report?.total || noRange;

  return (
    <section className="ua-login" aria-labelledby="ua-login-title">
      <div className="ua-login__inner">
        <header className="ua-login__masthead">
          {/* Read, not seen: the section rail names the page, as on Users and Groups. */}
          <h1 id="ua-login-title" className="ua-login__visually-hidden">Login Activity</h1>
          <dl className="ua-login__kpis" aria-live="polite" aria-busy={loading}>
            {[
              ["System accounts", report?.systemUsers, "accounts"],
              ["Ever logged in", report?.everLoggedIn, "ever"],
              ["Sign-ins in this period", report?.total, "signins"],
            ].map(([label, value, tone]) => (
              <div className={`ua-login__kpi ua-login__kpi--${tone}`} key={label}>
                <dd>{figure(value) ?? "–"}</dd>
                <dt>{label}</dt>
              </div>
            ))}
          </dl>
          {(org || isAll) && (
            <label className="ua-login__org">
              <span className="ua-login__org-label">Organisation</span>
              <OrgMark org={org} all={isAll} />
              <select value={selectedOrgId} onChange={(event) => editor.guard("Change the organisation", () => {
                setSelectedOrgId(event.target.value);
                setPage(1);
              })}>
                {allowAll && <option value={ALL}>All organisations</option>}
                {readableOrgs.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            </label>
          )}
        </header>

        <div className="ua-login__toolbar">
          <div className="ua-login__controls">
              <div className="ua-login__presets" role="group" aria-label="Date range presets">
                <button type="button" className="ua-login__preset" aria-pressed={activePreset === "today"} onClick={() => choosePreset("today")}>Today</button>
                <button type="button" className="ua-login__preset" aria-pressed={activePreset === "yesterday"} onClick={() => choosePreset("yesterday")}>Yesterday</button>
                <button type="button" className="ua-login__preset" aria-pressed={activePreset === "7days"} onClick={() => choosePreset("7days")}>7 days</button>
              </div>
              <label className="ua-login__date">
                <span className="ua-login__visually-hidden">From</span>
                <input type="date" value={from} max={today} onChange={(event) => changeRange(event.target.value, to)} />
              </label>
              <span className="ua-login__to" aria-hidden="true">to</span>
              <label className="ua-login__date">
                <span className="ua-login__visually-hidden">To</span>
                <input type="date" value={to} max={today} onChange={(event) => changeRange(from, event.target.value)} />
              </label>
          </div>
          <div className="ua-login__tools">
            {editor.problem && <span className="ua-login__error" role="alert">{editor.problem}</span>}
            <div className="ua-login__toolset" role="group" aria-label="Report">
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
                        disabled={loading || preparingEdit || exporting || noReport}>
                  <i className="ti ti-pencil" aria-hidden="true" /> {preparingEdit ? "Loading all sign-ins…" : "Edit"}
                </button>
              )}
              <button type="button" className="ua-login__button" onClick={previewPdf}
                      disabled={busyAny || noReport}
                      title="Preview the PDF before saving it">
                <i className="ti ti-eye" aria-hidden="true" /> Preview
              </button>
            </div>
            <div className="ua-login__toolset" role="group" aria-label="Download">
              <button type="button" className="ua-login__button" onClick={exportReport}
                      disabled={loading || exporting || preparingEdit || noReport}
                      title="Export every successful sign-in in this date range">
                {exporting ? "Preparing CSV…" : "CSV"}
              </button>
              <JpegButton className="ua-login__button" onSave={(landscape) => save("jpeg", landscape)} disabled={busyAny || noReport}
                          busy={file.busy === "jpeg"} title="The PDF report as an image" />
              <JpegButton className="ua-login__button" word="PDF" icon="ti-file-type-pdf" onSave={(landscape) => save("pdf", landscape)}
                          disabled={busyAny || noReport}
                          busy={file.busy === "pdf"} title="The report as a PDF" />
            </div>
          </div>
        </div>

        {(noRange || !readableOrgs.length || error || file.error) && (
          <div className="ua-login__notices">
            {noRange && <p className="ua-login__message" role="alert">The start date must be on or before the end date.</p>}
            {!readableOrgs.length && <p className="ua-login__message">No organisations are available with user read access.</p>}
            {error && <p className="ua-login__error" role="alert">{error}</p>}
            {file.error && <p className="ua-login__error" role="alert">{file.error}</p>}
          </div>
        )}
        {report?.failures?.length > 0 && (
          <div className="ua-login__notices">
            <p className="ua-login__message" role="status">
              Could not load {report.failures.map((f) => orgNameById.get(f.orgId) ?? "an organisation").join(", ")}.
              {" "}Their sign-ins are not shown.
            </p>
          </div>
        )}

        {preview && (
          <PdfPreview
            state={preview}
            title="Login Activity Report"
            caption={`${orgName}, ${rangeWords(from, to)}`}
            edited={editor.edited ? 1 : 0}
            onRetry={previewPdf}
            onClose={closePreview}
          />
        )}

        <div className="ua-login__tablewrap">
          {loading ? (
            <EmptyNote icon="ti-loader-2" tone="busy" title="Loading login activity">
              {isAll
                ? `Reading sign-ins from ${readableIds.length} organisations.`
                : `Reading sign-ins for ${orgName}, ${rangeWords(from, to)}.`}
            </EmptyNote>
          ) : error ? (
            <EmptyNote icon="ti-alert-triangle" tone="error" title="Login activity could not be loaded">
              {error}
            </EmptyNote>
          ) : !report?.rows?.length ? (
            <EmptyNote icon="ti-login" tone="info" title="No sign-ins">
              No successful sign-ins in this date range.
            </EmptyNote>
          ) : (
            <table className="ua-login__table">
              <thead>
                <tr>
                  {isAll && <th scope="col">Organisation</th>}
                  {[
                    ["day", "Date"],
                    ["user", "User"],
                    ["email", "Email"],
                    ["role", "Role"],
                  ].map(([key, label]) => (
                    <th
                      key={key}
                      scope="col"
                      aria-sort={sort?.key === key
                        ? sort.dir === "asc" ? "ascending" : "descending"
                        : "none"}
                    >
                      <button
                        type="button"
                        className="ua-login__sort"
                        disabled={loading}
                        onClick={() => sortBy(key)}
                        aria-label={`Sort by ${label}`}
                      >
                        {label}
                        {sort?.key === key && (
                          <i className={`ti ${sort.dir === "asc" ? "ti-arrow-up" : "ti-arrow-down"}`} aria-hidden="true" />
                        )}
                      </button>
                    </th>
                  ))}
                  <th scope="col" className="ua-login__daycol">
                    <span className="ua-login__dayhead" aria-hidden="true">
                      <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
                    </span>
                    <span className="ua-login__visually-hidden">Times of day</span>
                  </th>
                  <th
                    scope="col"
                    className="ua-login__num"
                    aria-sort={sort?.key === "count"
                      ? sort.dir === "asc" ? "ascending" : "descending"
                      : "none"}
                  >
                    <button
                      type="button"
                      className="ua-login__sort"
                      disabled={loading}
                      onClick={() => sortBy("count")}
                      aria-label="Sort by Sign-ins"
                    >
                      Sign-ins
                      {sort?.key === "count" && (
                        <i className={`ti ${sort.dir === "asc" ? "ti-arrow-up" : "ti-arrow-down"}`} aria-hidden="true" />
                      )}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    className="ua-login__row"
                    key={row.key}
                    tabIndex={0}
                    aria-current={selectedDay?.key === row.key ? "true" : undefined}
                    aria-label={`${row.user?.fullName ?? "Unknown user"}, ${dayWords(row.day)}, ${row.events.length} sign-ins. Open details.`}
                    onClick={() => setSelectedDay(row)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setSelectedDay(row);
                      }
                    }}
                  >
                    {isAll && <td className="ua-login__orgcell" data-label="Organisation">{orgList(row)}</td>}
                    <td className="ua-login__daycell" data-label="Date">{dayWords(row.day)}</td>
                    <td className="ua-login__user" data-label="User">{row.user?.fullName ?? "Unknown user"}</td>
                    <td className="ua-login__quiet" data-label="Email">{row.user?.email ?? "No email"}</td>
                    <td className="ua-login__quiet" data-label="Role">{roleWords(row.user)}</td>
                    <td className="ua-login__daycol" data-label="Times of day"><DayStrip events={row.events} /></td>
                    <td className="ua-login__num" data-label="Sign-ins">{row.events.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* The app's one pager (TablePager), always drawn here (operator, 10 Nov 2026) */}
        {!loading && (
          <TablePager
            always
            label="Login activity pages"
            pager={{
              page: completePage.page - 1,
              pageCount: completePage.pageCount,
              total: completePage.total,
              from: completePage.from,
              to: completePage.to,
              setPage: (n) => setPage(n + 1),
            }}
          />
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
            sub={`${isAll ? rowOrgs(selectedDay).join(", ") : orgName}, ${dayWords(selectedDay.day)}`}
          />
          <DetailSidebarFacts facts={[
            { label: "Sign-ins", value: selectedDay.events.length },
            { label: "Role", value: roleWords(selectedDay.user) },
            { label: "Groups", value: selectedDay.user?.groups?.length ? selectedDay.user.groups.join(", ") : "Ungrouped" },
          ]} />
          <DetailSidebarSection title="Sign-in times">
            <div className="ua-login__sidestrip">
              <DayStrip events={selectedDay.events} large />
              <span className="ua-login__dayhead" aria-hidden="true">
                <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
              </span>
            </div>
            <ol className="ua-login__times">
              {[...selectedDay.events].reverse().map((event) => (
                <li key={event.id}><time dateTime={event.loggedInAt}>{clockWords(event.loggedInAt)}</time></li>
              ))}
            </ol>
            <p className="ua-login__tz">Times are in Africa/Nairobi.</p>
          </DetailSidebarSection>
          <DetailSidebarSection title="Account">
            <dl className="ua-login__account">
              <dt>Email</dt>
              <dd>{selectedDay.user?.email ?? "No email"}</dd>
              <dt>Organisation</dt>
              <dd>{isAll ? orgList(selectedDay, { full: true }) : <OrgName org={org} />}</dd>
            </dl>
          </DetailSidebarSection>
        </DetailSidebar>
      )}
      {editor.overlay}
    </section>
  );
}
