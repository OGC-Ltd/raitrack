// A unit's tracker readings now, as words (Wialon view's unit report; operator, 2026-11-27:
// "all the messages a tracker sends ... with their status as per the time the report is
// generated"). The server sends every sensor the installer set up in Wialon, Wialon's value for
// it, the installer's label and a verdict (fleet-server incidents tracker-readings). Pure.

const ON_OFF = new Set(["engine operation", "digital"]);

/** The value as the reader expects it: On / Off for a switch, the figure with its unit otherwise. */
export function readingValue(r) {
  if (r?.value == null) return "No reading";
  if (ON_OFF.has(String(r.type).toLowerCase()) || /^on\/off$/i.test(r.unit ?? "")) return r.value ? "On" : "Off";
  const n = Number(r.value);
  const text = Number.isInteger(n) ? n.toLocaleString("en-GB") : n.toLocaleString("en-GB", { maximumFractionDigits: 3 });
  return r.unit ? `${text} ${r.unit}` : text;
}

/**
 * The site's own word on a label the server leaves unjudged (operator, 2026-11-27): "Critical", as
 * on GNSS Jamming, is a fault, drawn red and counted. Applied as the readings arrive, so the panel
 * and the PDF agree. The server's verdict, where it gives one, stands.
 */
export function withSiteVerdicts(data) {
  if (!data?.readings) return data;
  return {
    ...data,
    readings: data.readings.map((r) => (r.verdict == null && /\bcritical\b/i.test(r.label ?? "") ? { ...r, verdict: "fault" } : r)),
  };
}

/** The verdict as words: Fault, OK, or blank where the installer's label says neither. */
export const readingVerdict = (r) => (r?.verdict === "fault" ? "Fault" : r?.verdict === "ok" ? "OK" : "");

/** The reading's name without the installer's running number ("14.GNSS Status" -> "GNSS Status"). */
export const readingName = (r) => String(r?.name ?? "").replace(/^\s*\d+\.\s*/, "");

/** How many readings are faulty, and how many have no value. */
export function readingCounts(readings) {
  let faults = 0, none = 0;
  for (const r of readings ?? []) {
    if (r.verdict === "fault") faults += 1;
    if (r.value == null) none += 1;
  }
  return { total: readings?.length ?? 0, faults, none };
}

/** The PDF section: every reading, faults first, then the rest in the installer's order. */
export function readingsSection(data, when) {
  const rows = [...(data?.readings ?? [])].sort((a, b) => (b.verdict === "fault") - (a.verdict === "fault"));
  const c = readingCounts(rows);
  return {
    title: "Tracker status now",
    small: `${when}${c.faults ? ` · ${c.faults} fault${c.faults === 1 ? "" : "s"}` : ""}`,
    // Two columns side by side, so a unit's 25-30 readings fit the first page (operator, 2026-11-27).
    columns: 2,
    head: ["Reading", "Value", "Label in Wialon", "Status"],
    body: rows.map((r) => [readingName(r), readingValue(r), r.label ?? "-", readingVerdict(r) || "-"]),
  };
}
