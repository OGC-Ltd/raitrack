// Client-side Fleet Analytics Report — works for both plant fleets (Kasulu)
// and haulage fleets (Sukari). Supports light and dark mode, and embeds
// chart screenshots for plant fleets.

import { jsPDF } from "jspdf";
import autoTableModule from "jspdf-autotable";
import html2canvas from "html2canvas";
import { splitDrained } from "../lib/fuelTheftSplit";

const autoTable =
  typeof autoTableModule === "function"
    ? autoTableModule
    : autoTableModule.default;

// ── Browser scheduling helpers ────────────────────────────────────────────────

/**
 * Yield to the browser twice so React can commit and paint UI changes before
 * expensive canvas/PDF work starts.
 */
function waitForBrowserPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(resolve);
    });
  });
}

// ── Palettes ──────────────────────────────────────────────────────────────────

const LIGHT = {
  bg: "#f7f4ee",
  card: "#ffffff",
  border: "#e9e3d8",
  ink: "#1d1a16",
  sub: "#7d766b",
  faint: "#a9a294",
  green: "#1e6f4e",
  greenDeep: "#173d2f",
  greenSoft: "#cfe0d6",
  amber: "#d97706",
  chipInk: "#8a6a3a",
  hairline: "#f0ebe1",
  red: "#cf4a3d",
};

const DARK = {
  bg: "#000000",
  card: "#111111",
  border: "#2a3044",
  // White throughout, by request.
  //
  // `sub` and `faint` were #8892a4 and #5a6478 — greys chosen for a screen,
  // carried onto a page that is usually PRINTED. On paper the second measured
  // barely above the card it sat on, and it is what section titles, table
  // headers, the footer and every caption are set in, so the parts of the
  // report that say what a number MEANS were the least legible parts of it.
  //
  // The hierarchy does not disappear with the greys: titles are 7pt bold
  // uppercase with letter-spacing, headers 6.5pt bold, body 8pt regular. That
  // separation survives a photocopier, which a 20% lightness step does not.
  //
  // LIGHT is deliberately untouched — white on #f7f4ee is nothing at all.
  ink: "#ffffff",
  sub: "#ffffff",
  faint: "#ffffff",
  green: "#34d399",
  greenDeep: "#064e3b",
  greenSoft: "#6ee7b7",
  amber: "#fbbf24",
  chipInk: "#fbbf24",
  hairline: "#1e2538",
  red: "#ef4444",
};

const MARGIN = 34;
const FOOTER_H = 54;

/** Add a new page if the next block of `neededPts` points won't fit. */
function checkNewPage(doc, C, neededPts) {
  const h = doc.internal.pageSize.getHeight();

  if (
    doc._y + neededPts >
    h - FOOTER_H - 10
  ) {
    doc.addPage();
    paintPage(doc, C);
    doc._y = MARGIN + 20;
  }
}

const fmt = (n, d = 0) =>
  Number(n ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });

const dash = (n, d = 0) =>
  n == null ? "-" : fmt(n, d);

const fmtDay = (iso) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(
    "en-US",
    {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    },
  );

/**
 * An instant on the FLEET's own wall clock — Africa/Nairobi.
 *
 * Not the reader's timezone. A drain at 01:00 EAT is a night-shift event, and a
 * report opened in London that prints it as 22:00 the previous day sends
 * somebody to the wrong shift. The rest of the system buckets on the same
 * clock (lib/provider-time), so this has to agree with it.
 */
const fmtStamp = (iso) => {
  if (iso == null) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", {
    timeZone: "Africa/Nairobi",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
};

/** A measured fall duration. Null stays a dash — it is not a zero-minute fall. */
const fmtMins = (seconds) =>
  seconds == null ? "-" : `${Math.max(1, Math.round(seconds / 60))}`;

// ── Page chrome ───────────────────────────────────────────────────────────────

function paintPage(
  doc,
  C,
  { first = false } = {},
) {
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();

  doc.setFillColor(C.bg);
  doc.rect(0, 0, w, h, "F");

  if (first) {
    doc.setFillColor(C.greenDeep);
    doc.rect(0, 0, w * 0.74, 4, "F");

    doc.setFillColor(C.amber);
    doc.rect(
      w * 0.74,
      0,
      w * 0.26,
      4,
      "F",
    );
  }
}

function addFooters(
  doc,
  C,
  companyName,
  windowLabel,
) {
  const pageCount =
    doc.internal.getNumberOfPages();

  const w =
    doc.internal.pageSize.getWidth();

  const h =
    doc.internal.pageSize.getHeight();

  for (
    let i = 1;
    i <= pageCount;
    i++
  ) {
    doc.setPage(i);

    doc.setDrawColor(C.border);
    doc.setLineWidth(1);

    doc.line(
      MARGIN,
      h - 38,
      w - MARGIN,
      h - 38,
    );

    doc.setFont(
      "helvetica",
      "normal",
    );

    doc.setFontSize(7.5);
    doc.setTextColor(C.faint);

    doc.setCharSpace(1);

    doc.text(
      "FLEET TRACKING: CONFIDENTIAL",
      MARGIN,
      h - 24,
    );

    doc.setCharSpace(0);

    doc.text(
      `${(
        companyName || "Fleet"
      ).toUpperCase()} · ${windowLabel}`,
      w / 2,
      h - 24,
      { align: "center" },
    );

    doc.text(
      `Page ${i} of ${pageCount}`,
      w - MARGIN,
      h - 24,
      { align: "right" },
    );

    doc.setFillColor(C.greenDeep);

    doc.rect(
      0,
      h - 4,
      w,
      4,
      "F",
    );
  }
}

// ── Section helpers ───────────────────────────────────────────────────────────

function sectionTitle(
  doc,
  C,
  title,
) {
  checkNewPage(
    doc,
    C,
    30,
  );

  const w =
    doc.internal.pageSize.getWidth();

  const y = doc._y;

  doc.setFont(
    "helvetica",
    "bold",
  );

  doc.setFontSize(7);
  doc.setTextColor(C.faint);

  doc.setCharSpace(1.5);

  doc.text(
    title.toUpperCase(),
    MARGIN,
    y,
  );

  doc.setCharSpace(0);

  doc.setDrawColor(C.border);
  doc.setLineWidth(0.5);

  doc.line(
    MARGIN,
    y + 4,
    w - MARGIN,
    y + 4,
  );

  doc._y = y + 16;
}

/**
 * A wrapped sentence under a section title, for a caveat that changes how the
 * numbers below it should be read.
 *
 * Not the title itself: `sectionTitle` uppercases, sets no maxWidth, and runs
 * off the page rather than wrapping, so anything longer than a few words has to
 * live here. Set in sentence case at reading size, because a caveat rendered as
 * 7pt uppercase tracking is a caveat nobody reads.
 */
function sectionNote(
  doc,
  C,
  text,
) {
  const w =
    doc.internal.pageSize.getWidth();

  doc.setFont(
    "helvetica",
    "normal",
  );

  doc.setFontSize(8);
  doc.setTextColor(C.sub);

  const lines =
    doc.splitTextToSize(
      text,
      w - MARGIN * 2,
    );

  const lineH = 11;

  checkNewPage(
    doc,
    C,
    lines.length * lineH + 8,
  );

  doc.text(
    lines,
    MARGIN,
    doc._y,
  );

  doc._y +=
    lines.length * lineH + 8;
}

function kpiTiles(
  doc,
  C,
  tiles,
) {
  const tileH = 68;

  checkNewPage(
    doc,
    C,
    tileH + 20,
  );

  const w =
    doc.internal.pageSize.getWidth();

  const gap = 10;

  const tileW =
    (w -
      MARGIN * 2 -
      gap *
      (tiles.length - 1)) /
    tiles.length;

  const y = doc._y;

  tiles.forEach(
    (t, i) => {
      const x =
        MARGIN +
        i *
        (tileW + gap);

      const dark =
        i ===
        tiles.length - 1;

      doc.setFillColor(
        dark
          ? C.greenDeep
          : C.card,
      );

      doc.setDrawColor(C.border);

      doc.roundedRect(
        x,
        y,
        tileW,
        tileH,
        6,
        6,
        dark
          ? "F"
          : "FD",
      );

      doc.setFont(
        "helvetica",
        "bold",
      );

      doc.setFontSize(6.5);

      doc.setTextColor(
        dark
          ? C.greenSoft
          : C.faint,
      );

      doc.setCharSpace(1);

      doc.text(
        String(
          t.label,
        ).toUpperCase(),
        x + 12,
        y + 14,
        {
          maxWidth:
            tileW - 24,
        },
      );

      doc.setCharSpace(0);

      doc.setFont(
        "helvetica",
        "bold",
      );

      doc.setFontSize(16);

      doc.setTextColor(
        dark
          ? "#ffffff"
          : C.ink,
      );

      doc.text(
        String(t.value),
        x + 12,
        y + 46,
        {
          maxWidth:
            tileW - 24,
        },
      );

      if (
        t.unit ||
        t.sub
      ) {
        doc.setFont(
          "helvetica",
          "normal",
        );

        doc.setFontSize(7);

        doc.setTextColor(
          dark
            ? C.greenSoft
            : C.sub,
        );

        doc.text(
          String(
            t.unit ||
            t.sub,
          ),
          x + 12,
          y + 64,
          {
            maxWidth:
              tileW - 24,
          },
        );
      }
    },
  );

  doc._y =
    y +
    tileH +
    14;
}

function twoColStats(
  doc,
  C,
  rows,
) {
  const w =
    doc.internal.pageSize.getWidth();

  const colW =
    (w -
      MARGIN * 2 -
      20) /
    2;

  let x = MARGIN;
  let y = doc._y;

  const lineH = 16;

  rows.forEach(
    (r, i) => {
      if (
        i > 0 &&
        i % 2 === 0
      ) {
        y += lineH;
        x = MARGIN;
      }

      if (
        i % 2 === 1
      ) {
        x =
          MARGIN +
          colW +
          20;
      }

      doc.setFont(
        "helvetica",
        "normal",
      );

      doc.setFontSize(8);
      doc.setTextColor(C.sub);

      doc.text(
        r.label,
        x,
        y,
      );

      doc.setFont(
        "helvetica",
        "bold",
      );

      doc.setTextColor(C.ink);

      doc.text(
        r.value,
        x + colW,
        y,
        {
          align: "right",
        },
      );

      if (
        i % 2 === 1 ||
        i ===
        rows.length - 1
      ) {
        doc.setDrawColor(
          C.hairline,
        );

        doc.setLineWidth(
          0.4,
        );

        doc.line(
          MARGIN,
          y + 4,
          w - MARGIN,
          y + 4,
        );
      }
    },
  );

  doc._y =
    y +
    lineH +
    8;
}

// ── AutoTable with pill support ──────────────────────────────────────────────

function addAutoTable(
  doc,
  C,
  {
    head,
    body,
    columnStyles,
    columnWidths,
    fontSize: fs,
    cellPadding = {
      top: 4,
      bottom: 4,
      left: 4,
      right: 4,
    },
  },
) {
  const w =
    doc.internal.pageSize.getWidth();

  const usable =
    w - MARGIN * 2;

  const finalColStyles = {
    ...(columnStyles ?? {}),
  };

  if (columnWidths) {
    columnWidths.forEach(
      (frac, i) => {
        finalColStyles[i] = {
          ...(finalColStyles[i] ??
            {}),
          cellWidth:
            usable * frac,
        };
      },
    );
  }

  const stateColIndex =
    head.findIndex(
      (h) =>
        String(
          h,
        ).toLowerCase() ===
        "state",
    );

  const statusColIndex =
    head.findIndex(
      (h) =>
        String(
          h,
        ).toLowerCase() ===
        "status",
    );

  const stateColors = {
    WORKING: "#1e6f4e",
    STATIONARY: "#4a3aa7",
    IDLING: "#eda100",
    PARKED: "#7d766b",
    OFFLINE: "#cf4a3d",
  };

  autoTable(doc, {
    startY: doc._y,

    head: [
      head.map(
        (h) =>
          String(
            h,
          ).toUpperCase(),
      ),
    ],

    body,

    columnStyles:
      finalColStyles,

    theme: "plain",

    styles: {
      font: "helvetica",
      fontSize: fs ?? 8,
      textColor: C.ink,
      fillColor: C.card,
      cellPadding,
    },

    headStyles: {
      fillColor: C.bg,
      textColor: C.faint,
      fontStyle: "bold",
      fontSize:
        (fs ?? 8) - 1.5,
    },

    margin: {
      left: MARGIN,
      right: MARGIN,
      top:
        MARGIN + 10,
      bottom:
        FOOTER_H,
    },

    willDrawPage: (d) => {
      if (
        d.pageNumber >
        1
      ) {
        paintPage(
          doc,
          C,
        );
      }
    },

    didDrawCell:
      function (d) {
        if (
          d.section ===
          "body" &&
          d.column.index ===
          stateColIndex
        ) {
          const state =
            d.cell.raw;

          const color =
            stateColors[
            state
            ] ||
            "#7d766b";

          const x =
            d.cell.x + 5;

          const y =
            d.cell.y +
            d.cell.height /
            2;

          doc.setFillColor(
            color,
          );

          doc.circle(
            x,
            y,
            3,
            "F",
          );
        }

        if (
          d.section ===
          "body" &&
          d.column.index ===
          statusColIndex
        ) {
          const status =
            d.cell.raw;

          const isOp =
            status ===
            "Operational";

          const color =
            isOp
              ? C.green
              : C.red;

          const x =
            d.cell.x + 5;

          const y =
            d.cell.y +
            d.cell.height /
            2;

          doc.setFillColor(
            color,
          );

          doc.circle(
            x,
            y,
            3,
            "F",
          );
        }

        if (
          d.section ===
          "body" &&
          d.column.index ===
          0
        ) {
          doc.setDrawColor(
            C.hairline,
          );

          doc.setLineWidth(
            0.4,
          );

          doc.line(
            MARGIN,
            d.cell.y +
            d.cell.height,
            w - MARGIN,
            d.cell.y +
            d.cell.height,
          );
        }
      },
  });

  doc._y =
    doc.lastAutoTable.finalY +
    20;
}

// ── Chart capture helpers ─────────────────────────────────────────────────────

async function captureChart(
  node,
  bg,
) {
  if (!node) {
    return null;
  }

  try {
    const canvas =
      await html2canvas(
        node,
        {
          backgroundColor:
            bg,
          scale: 2,
          useCORS: true,
          logging: false,
        },
      );

    return canvas.toDataURL(
      "image/jpeg",
      0.92,
    );
  } catch {
    return null;
  }
}

/**
 * Capture charts one at a time instead of four large html2canvas operations
 * competing for the main thread simultaneously.
 *
 * A browser yield is inserted between each capture so the page remains
 * responsive for as long as the browser can schedule work.
 */
async function captureAllCharts(
  chartRefs,
  bg,
) {
  const operational =
    await captureChart(
      chartRefs?.operational,
      bg,
    );

  await waitForBrowserPaint();

  const sensor =
    await captureChart(
      chartRefs?.sensor,
      bg,
    );

  await waitForBrowserPaint();

  const fuelHistogram =
    await captureChart(
      chartRefs?.fuelHistogram,
      bg,
    );

  await waitForBrowserPaint();

  const fuelConsumption =
    await captureChart(
      chartRefs?.fuelConsumption,
      bg,
    );

  return {
    operational,
    sensor,
    fuelHistogram,
    fuelConsumption,
  };
}

// ── Main export ───────────────────────────────────────────────────────────────

function addChartImage(
  doc,
  C,
  imgData,
  node,
) {
  if (
    !imgData ||
    !node
  ) {
    return;
  }

  const w =
    doc.internal.pageSize.getWidth();

  const h =
    doc.internal.pageSize.getHeight();

  const usable =
    w - MARGIN * 2;

  const maxH =
    (h - FOOTER_H) *
    0.55;

  const naturalW =
    node.offsetWidth ||
    usable;

  const naturalH =
    node.offsetHeight ||
    200;

  const imgW =
    usable;

  const imgH = Math.min(
    (naturalH /
      naturalW) *
    imgW,
    maxH,
  );

  checkNewPage(
    doc,
    C,
    imgH + 10,
  );

  doc.addImage(
    imgData,
    "JPEG",
    MARGIN,
    doc._y,
    imgW,
    imgH,
  );

  doc._y +=
    imgH + 16;
}

/**
 * Every drain in the window, one row each, with the unit it came off.
 *
 * The section the fuel figures above it could not answer. "412 L lost across 9
 * drains" tells an operator there is a problem and nothing about where to go;
 * this names the machine, the night, and how much left it.
 *
 * ## What is in it, and what is not
 *
 * Exactly the rows the totals were summed from — the server returns them from
 * that same query, so the litres column always adds to the "Litres lost" figure
 * printed above. Reported drops the adjudicator decided were NOT a loss are
 * already excluded upstream and are not silently folded in here: fuel that came
 * back, a sensor fault, and — since 2026-08-28 — falls whose SHAPE says the
 * probe moved rather than the tank, slosh and settling.
 *
 * Ordinary engine burn IS included, by the operator's decision the same day,
 * and so is theft. The figure is the DRAIN: every litre that left the tank,
 * whatever took it. The only rows kept out are the ones where no fuel moved at
 * all — which is why "not a finding of theft" was the wrong disclaimer to
 * carry here. It disclaimed the very thing the column is meant to include; what
 * separates a suspicious drop from an ordinary one is the announced count, not
 * the total.
 *
 * `Fall` is the MEASURED duration of the drop where the adjudicator could
 * measure it. It is blank on drains judged before 2026-08-28, and blank is the
 * honest answer: those rows were never measured, and printing 0 would claim an
 * instantaneous fall that nothing observed.
 *
 * Long windows are capped so one section cannot run to thirty pages. The cap is
 * stated in the caption when it bites, rather than the table just stopping.
 */
const DRAIN_ROWS_MAX = 120;

function fuelDrainTable(doc, C, drains) {
  if (!drains?.length) return;

  const shown = drains.slice(0, DRAIN_ROWS_MAX);
  const omitted = drains.length - shown.length;

  // How many of the rows on the page carry a MEASURED fall.
  //
  // Said out loud because otherwise the column reads as broken. The adjudicator
  // only began recording the duration of a fall on 2026-08-28; every drain
  // judged before that has none, and on a 30-day window that is very nearly all
  // of them — 7 of 3,271 when this was written.
  //
  // The tempting fix is to print `detectedAt - beganAt` instead. That is the
  // PROVIDER's window, not a measurement: it is the figure PLATEAU_TOLERANCE
  // exists to reject, and the one removed from DriverIncident.minutes for being
  // a lie about what was observed. A blank that explains itself beats a number
  // that cannot be trusted.
  const measured = shown.filter(
    (d) => d.fallSeconds != null,
  ).length;

  const announced = drains.filter(
    (d) => d.announced,
  ).length;

  const uncaused = drains.filter(
    (d) => d.cause == null,
  ).length;

  sectionTitle(
    doc,
    C,
    omitted > 0
      ? `Fuel drains: ${fmt(drains.length)} recorded, ${fmt(DRAIN_ROWS_MAX)} most recent shown`
      : `Fuel drains: ${fmt(drains.length)} recorded`,
  );

  // RECORDED is not ANNOUNCED, and the gap is a factor of thirty-six.
  //
  // The ledger records every fall it cannot explain from consumption; the
  // classifier announces only the few it can stand behind. Printing 3,275 rows
  // under a "litres lost" total reads as an itemised theft ledger unless this
  // says otherwise — and it is not one. Half of them carry no attributable
  // cause at all, which is the ignition-coverage ceiling showing through rather
  // than a judgement that anything was taken.
  //
  // Every figure here is counted off the rows in hand, never asserted, so a
  // window where the proportions differ says so instead of repeating this one.
  sectionNote(
    doc,
    C,
    [
      `Of ${fmt(drains.length)} recorded, ${fmt(announced)} were announced to an operator.`,
      "This is the fuel DRAIN: every litre that left the tank, ordinary engine burn and theft alike. The only drops excluded are the ones where no fuel moved.",
      uncaused > 0
        ? `${fmt(uncaused)} carry no attributable cause, most often because the unit reports no ignition state.`
        : null,
      "Slosh and settling, the probe moving rather than the tank, are out, with drops that turned out to be a refill or a sensor fault.",
      measured === 0
        ? "Fall duration was measured on none of these; it has only been recorded since 28 Aug 2026."
        : measured < shown.length
          ? `Fall duration was measured on ${fmt(measured)} of the ${fmt(shown.length)} shown; it has only been recorded since 28 Aug 2026.`
          : null,
    ]
      .filter(Boolean)
      .join(" "),
  );

  addAutoTable(
    doc,
    C,
    {
      // FSL before and after sit either side of the litres on purpose: the
      // three read left to right as the subtraction they are, and their
      // difference IS the litres column on every drain measured. A reader can
      // check the row without leaving the page, which is the difference
      // between a figure they trust and one they take on faith.
      // No Cause column, by request. The cause is still READ — the note above
      // counts how many rows carry none — it is just not a column: the slugs
      // are the classifier's own vocabulary, and at this width they truncated
      // to "unexplained burn (burn far abo…" which tells a reader less than
      // nothing. The width it freed goes to Where, which was truncating too.
      head: [
        "When (EAT)",
        "Unit",
        "FSL before (L)",
        "FSL after (L)",
        "Litres",
        "Fall (min)",
        "Where",
      ],

      body: shown.map((d) => [
        fmtStamp(d.at),
        d.plate ?? "-",
        dash(d.levelBefore, 1),
        dash(d.levelAfter, 1),
        dash(d.litres, 1),
        fmtMins(d.fallSeconds),
        d.location ?? "-",
      ]),

      columnWidths: [
        0.15, 0.16, 0.12, 0.12, 0.09, 0.09, 0.27,
      ],

      columnStyles: {
        2: { halign: "right" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "right" },
      },
    },
  );
}

export async function downloadAnalyticsReport({
  isPlantFleet,
  darkMode,
  companyName,
  windowLabel,
  filename,
  chartRefs,

  // plant
  machineWeek,
  /**
   * Hours per machine per CALENDAR day, computed by the screen and handed over
   * rather than re-derived here.
   *
   * This tile read `machineWeek.avgHoursPerDay`, which the server computes per
   * OBSERVED working unit-day. Same name, different question, and the answers
   * are not close: KASULU 7.4 h in the report against 5.8 h on the dashboard,
   * SUKARI 4.4 against 3.8. A report that disagrees with the screen it was
   * generated from is worse than one that omits the figure.
   */
  avgHoursPerDay,
  areaDays,
  perMachine,
  fleetState,
  mixByCategory,
  todayOps,

  // haulage
  totals,
  byDay,
  distance,
  perTripKm,
  busiestDay,
  furthestDay,
  avgTripsPerActiveDay,
  longestStreak,

  // shared
  fuelTotals,
  fuelAverages,
  fuelPrice,
  fuelByDay,
  fuelDrains,
}) {
  const C =
    darkMode
      ? DARK
      : LIGHT;

  // ---------------------------------------------------------------------------
  // IMPORTANT:
  //
  // The DownloadReportButton has already switched itself to "Generating…".
  // Yield to the browser before starting html2canvas so the user actually
  // sees that state before expensive work begins.
  // ---------------------------------------------------------------------------

  await waitForBrowserPaint();

  // ---------------------------------------------------------------------------
  // Capture charts.
  //
  // These are intentionally sequential to reduce contention on the browser's
  // main thread.
  // ---------------------------------------------------------------------------

  const charts =
    isPlantFleet
      ? await captureAllCharts(
        chartRefs,
        C.bg,
      )
      : {};

  // Give the browser another opportunity before jsPDF starts its work.
  await waitForBrowserPaint();

  // ---------------------------------------------------------------------------
  // Create PDF.
  // ---------------------------------------------------------------------------

  const doc =
    new jsPDF({
      unit: "pt",
      format: "a4",
      orientation:
        "landscape",
    });

  const pageW =
    doc.internal.pageSize.getWidth();

  paintPage(
    doc,
    C,
    {
      first: true,
    },
  );

  // ── Header ──────────────────────────────────────────────────────────────────

  let y = 34;

  doc.setFillColor(
    C.green,
  );

  doc.circle(
    MARGIN + 3,
    y - 2.5,
    2.6,
    "F",
  );

  doc.setTextColor(
    C.green,
  );

  doc.setFont(
    "helvetica",
    "bold",
  );

  doc.setFontSize(8);

  doc.setCharSpace(2);

  doc.text(
    "FLEET TRACKING",
    MARGIN + 11,
    y,
  );

  doc.setCharSpace(0);

  const chipW = 92;

  doc.setDrawColor(
    C.border,
  );

  doc.roundedRect(
    pageW -
    MARGIN -
    chipW,
    y - 12,
    chipW,
    17,
    3,
    3,
    "S",
  );

  doc.setTextColor(
    C.chipInk,
  );

  doc.setFontSize(
    6.5,
  );

  doc.setCharSpace(
    1.5,
  );

  doc.text(
    "CONFIDENTIAL",
    pageW -
    MARGIN -
    chipW / 2,
    y - 1,
    {
      align: "center",
    },
  );

  doc.setCharSpace(0);

  y += 24;

  doc.setTextColor(
    C.ink,
  );

  doc.setFontSize(
    21,
  );

  doc.text(
    "Fleet Analytics Report",
    MARGIN,
    y,
  );

  doc.setFontSize(
    11,
  );

  doc.text(
    (
      companyName ||
      "Fleet"
    ).toUpperCase(),
    pageW -
    MARGIN,
    y - 2,
    {
      align: "right",
    },
  );

  y += 18;

  doc.setFont(
    "helvetica",
    "normal",
  );

  doc.setFontSize(9);

  doc.setTextColor(
    C.sub,
  );

  const dateStr =
    new Date().toLocaleString(
      "en-KE",
      {
        dateStyle:
          "medium",
        timeStyle:
          "short",
      },
    );

  doc.text(
    `${companyName} · ${windowLabel} · Generated ${dateStr}`,
    MARGIN,
    y,
  );

  doc._y =
    y + 22;

  const currency =
    fuelPrice?.currency ??
    "KES";

  // ── PLANT FLEET ─────────────────────────────────────────────────────────────

  if (isPlantFleet) {
    sectionTitle(
      doc,
      C,
      "Summary",
    );

    kpiTiles(
      doc,
      C,
      [
        {
          // Names the denominator, because "per day" is the ambiguity that let
          // this tile and the dashboard print different numbers under the same
          // words for as long as they did.
          label:
            "Avg hours / machine / day in window",
          value:
            dash(
              avgHoursPerDay,
              1,
            ),
          unit: `h  ·  against ${machineWeek?.expectedHoursPerDay ??
            18
            } h expected`,
        },

        {
          label:
            "Avg hours per machine",
          value:
            dash(
              perMachine?.hours,
              1,
            ),
          unit: `h over ${machineWeek?.days ??
            "-"
            } days`,
        },

        {
          label:
            "Distance covered",
          value:
            dash(
              machineWeek?.totalDistanceKm,
            ),
          unit:
            "km total",
        },

        {
          label:
            "Area worked (avg)",
          value:
            areaDays?.days
              ?.length
              ? fmt(
                areaDays.days.reduce(
                  (s, d) =>
                    s +
                    d.m2 /
                    1e4,
                  0,
                ) /
                areaDays.days
                  .length,
                1,
              )
              : "-",
          unit: `ha / day  ·  ${areaDays?.measuredDays ??
            0
            } days measured`,
        },
      ],
    );

    sectionTitle(
      doc,
      C,
      "Today on the ground",
    );

    kpiTiles(
      doc,
      C,
      [
        {
          label:
            "Operational",
          value:
            dash(
              todayOps?.operational,
            ),
        },

        {
          label:
            "Non-operational",
          value:
            dash(
              todayOps?.nonOperational,
            ),
        },

        {
          label:
            "Avg hours run",
          value:
            dash(
              todayOps?.avgHours,
              1,
            ),
          unit: "h",
        },

        {
          label:
            "Units reporting",
          value:
            dash(
              fleetState?.units
                ?.length,
            ),
        },
      ],
    );

    // Operational today donut + probes gauge
    if (
      charts.operational ||
      charts.sensor
    ) {
      sectionTitle(
        doc,
        C,
        "Operational today & probes",
      );

      const w =
        doc.internal.pageSize.getWidth();

      const h =
        doc.internal.pageSize.getHeight();

      const usable =
        w - MARGIN * 2;

      const maxH =
        (h - FOOTER_H) *
        0.38;

      const gap = 10;

      const slot =
        (usable - gap) /
        2;

      const opNode =
        chartRefs?.operational;

      const snNode =
        chartRefs?.sensor;

      const opH =
        opNode?.offsetWidth >
          0
          ? Math.min(
            (slot /
              opNode.offsetWidth) *
            opNode.offsetHeight,
            maxH,
          )
          : maxH;

      const snH =
        snNode?.offsetWidth >
          0
          ? Math.min(
            (slot /
              snNode.offsetWidth) *
            snNode.offsetHeight,
            maxH,
          )
          : maxH;

      const rowH =
        Math.max(
          opH,
          snH,
        );

      checkNewPage(
        doc,
        C,
        rowH + 10,
      );

      const rowY =
        doc._y;

      if (
        charts.operational &&
        opNode
      ) {
        doc.addImage(
          charts.operational,
          "JPEG",
          MARGIN,
          rowY,
          slot,
          rowH,
        );
      }

      if (
        charts.sensor &&
        snNode
      ) {
        doc.addImage(
          charts.sensor,
          "JPEG",
          MARGIN +
          slot +
          gap,
          rowY,
          slot,
          rowH,
        );
      }

      doc._y =
        rowY +
        rowH +
        16;
    }

    // Fuel consumption & cost
    if (
      (fuelTotals?.fillings ??
        0) > 0 ||
      (fuelTotals?.thefts ??
        0) > 0
    ) {
      sectionTitle(
        doc,
        C,
        "Fuel consumption & cost",
      );

      kpiTiles(
        doc,
        C,
        [
          {
            label:
              "Fuel filled",
            value:
              fmt(
                fuelTotals?.litresFilled,
              ),
            unit:
              "litres",
          },

          {
            label:
              "Fuel drained",
            value:
              fmt(
                splitDrained(fuelTotals).lost,
              ),
            unit:
              "litres",
          },

          {
            label:
              "Total fuel cost",
            value: `${currency} ${fmt(
              fuelTotals?.cost,
            )}`,
          },

          {
            label:
              "Avg per active day",
            value:
              fmt(
                fuelAverages?.perDayLitres,
              ),
            unit: `L  ·  ${currency} ${fmt(
              fuelAverages?.perDayCost,
            )} / day`,
          },
        ],
      );

      twoColStats(
        doc,
        C,
        [
          {
            label:
              "Fillings recorded",
            value:
              fmt(
                fuelTotals?.fillings,
              ),
          },

          {
            label:
              "Drain events",
            value:
              fmt(
                splitDrained(fuelTotals).drains,
              ),
          },

          {
            label:
              "Value of fuel drained",
            value: `${currency} ${fmt(
              splitDrained(fuelTotals).lossCost,
            )}`,
          },

          {
            label:
              "Suspected theft",
            value: `${fmt(
              splitDrained(fuelTotals).theft,
            )} L  ·  ${fmt(
              splitDrained(fuelTotals).thefts,
            )} events`,
          },

          {
            label:
              "Value of suspected theft",
            value: `${currency} ${fmt(
              splitDrained(fuelTotals).theftCost,
            )}`,
          },

          {
            label:
              "Fuel price used",
            value: `${currency} ${fmt(
              fuelPrice?.pricePerLitre ??
              0,
              2,
            )} / L`,
          },
        ],
      );

      if (
        charts.fuelHistogram
      ) {
        sectionTitle(
          doc,
          C,
          "Fuel per operating hour",
        );

        addChartImage(
          doc,
          C,
          charts.fuelHistogram,
          chartRefs?.fuelHistogram,
        );
      }

      if (
        charts.fuelConsumption
      ) {
        addChartImage(
          doc,
          C,
          charts.fuelConsumption,
          chartRefs?.fuelConsumption,
        );
      }

      if (
        fuelByDay?.length >
        0
      ) {
        sectionTitle(
          doc,
          C,
          "Fuel by day",
        );

        addAutoTable(
          doc,
          C,
          {
            head: [
              "Date",
              "Litres filled",
              "Litres lost",
              `Cost (${currency})`,
            ],

            body:
              fuelByDay.map(
                (d) => [
                  fmtDay(d.day),
                  fmt(d.litres),
                  fmt(d.lost),
                  fmt(d.cost),
                ],
              ),

            columnWidths: [
              0.25,
              0.25,
              0.25,
              0.25,
            ],

            columnStyles: {
              1: {
                halign:
                  "right",
              },
              2: {
                halign:
                  "right",
              },
              3: {
                halign:
                  "right",
              },
            },
          },
        );
      }

      // Independent of "Fuel by day": a window can carry drains on days the
      // per-day series has nothing else to say about.
      fuelDrainTable(
        doc,
        C,
        fuelDrains,
      );
    }

    if (
      mixByCategory &&
      Object.keys(
        mixByCategory,
      ).length > 0
    ) {
      sectionTitle(
        doc,
        C,
        "Fleet composition by prefix",
      );

      const total =
        Object.values(
          mixByCategory,
        ).reduce(
          (s, n) =>
            s + n,
          0,
        );

      addAutoTable(
        doc,
        C,
        {
          head: [
            "Prefix",
            "Units",
            "Share",
          ],

          body: Object.entries(
            mixByCategory,
          )
            .filter(
              ([k]) =>
                k !==
                "__unprefixed",
            )
            .sort(
              (a, b) =>
                b[1] - a[1],
            )
            .map(
              ([k, n]) => [
                k,
                fmt(n),
                `${Math.round(
                  (n /
                    total) *
                  100,
                )}%`,
              ],
            ),

          columnWidths: [
            0.6,
            0.2,
            0.2,
          ],

          columnStyles: {
            1: {
              halign:
                "right",
            },

            2: {
              halign:
                "right",
            },
          },
        },
      );
    }

    if (
      areaDays?.days
        ?.length > 0
    ) {
      sectionTitle(
        doc,
        C,
        "Daily activity log",
      );

      addAutoTable(
        doc,
        C,
        {
          head: [
            "Date",
            "Area (ha)",
            "Area (km²)",
            "Machines",
          ],

          body:
            areaDays.days.map(
              (d) => [
                fmtDay(d.day),
                fmt(
                  d.m2 /
                  1e4,
                  1,
                ),
                fmt(
                  d.m2 /
                  1e6,
                  3,
                ),
                fmt(
                  d.machines,
                ),
              ],
            ),

          columnWidths: [
            0.2,
            0.3,
            0.3,
            0.2,
          ],

          columnStyles: {
            1: {
              halign:
                "right",
            },

            2: {
              halign:
                "right",
            },

            3: {
              halign:
                "right",
            },
          },
        },
      );
    }

    // ── FLEET STATE TABLE ─────────────────────────────────────────────────

    const units =
      fleetState?.units ??
      [];

    if (
      units.length > 0
    ) {
      doc.addPage();

      paintPage(
        doc,
        C,
      );

      doc._y =
        MARGIN + 10;

      sectionTitle(
        doc,
        C,
        `Fleet state: all ${units.length} units`,
      );

      const head = [
        "Plate",
        "State",
        "Status",
        "Hours",
        "Wk avg",
        "22D avg",
        "Stationary",
        "Fuel L",
        "Fuel L today",
        "L/hr",
        "Sensor",
        "KM",
        "KM wk",
      ];

      const body =
        units.map(
          (u) => {
            const op =
              u.hoursToday !=
              null &&
              u.hoursToday >
              0;

            const statusLabel =
              op
                ? "Operational"
                : "Non-op";

            return [
              u.plate ?? "-",
              u.state ?? "-",
              statusLabel,
              dash(
                u.hoursToday,
                1,
              ),
              dash(
                u.hoursWeekAvg,
                1,
              ),
              dash(
                u.hoursMonthAvg,
                1,
              ),
              dash(
                u.stationaryHoursToday,
                1,
              ),
              u.fuelBurnL !=
                null
                ? fmt(
                  u.fuelBurnL,
                )
                : "-",
              u.fuelToday !=
                null
                ? fmt(
                  u.fuelToday,
                )
                : "-",
              dash(
                u.litresPerHour,
                1,
              ),
              u.sensorHealth ??
              "-",
              u.distanceKm !=
                null
                ? fmt(
                  u.distanceKm,
                )
                : "-",
              u.distanceWeekKm !=
                null
                ? fmt(
                  u.distanceWeekKm,
                )
                : "-",
            ];
          },
        );

      const columnWidths = [
        0.12,
        0.12,
        0.12,
        0.06,
        0.06,
        0.06,
        0.06,
        0.05,
        0.06,
        0.05,
        0.08,
        0.05,
        0.05,
      ];

      const columnStyles = {
        1: {
          halign: "left",
          cellPadding: {
            top: 2,
            bottom: 2,
            left: 12,
            right: 2,
          },
        },

        2: {
          halign: "left",
          cellPadding: {
            top: 2,
            bottom: 2,
            left: 12,
            right: 2,
          },
        },

        3: {
          halign: "right",
        },

        4: {
          halign: "right",
        },

        5: {
          halign: "right",
        },

        6: {
          halign: "right",
        },

        7: {
          halign: "right",
        },

        8: {
          halign: "right",
        },

        9: {
          halign: "right",
        },

        11: {
          halign: "right",
        },

        12: {
          halign: "right",
        },
      };

      addAutoTable(
        doc,
        C,
        {
          head,
          body,
          columnWidths,
          columnStyles,
          fontSize: 7,
          cellPadding: {
            top: 2,
            bottom: 2,
            left: 2,
            right: 2,
          },
        },
      );
    }

    // ── HAULAGE FLEET ───────────────────────────────────────────────────────

  } else {
    sectionTitle(
      doc,
      C,
      "Summary",
    );

    kpiTiles(
      doc,
      C,
      [
        {
          label:
            "Completed trips",
          value:
            fmt(
              totals?.trips,
            ),
          unit: `over ${totals?.activeDays ??
            0
            } active days`,
        },

        {
          label:
            "Distance covered",
          value:
            fmt(
              distance?.totalKm,
            ),
          unit:
            "km total",
        },

        {
          label:
            "Distance per day",
          value:
            fmt(
              distance?.perDayKm,
            ),
          unit:
            "km / active day",
        },

        {
          label:
            "Avg distance per trip",
          value:
            fmt(
              perTripKm,
              1,
            ),
          unit:
            "km / trip",
        },
      ],
    );

    twoColStats(
      doc,
      C,
      [
        {
          label:
            "Busiest day",
          value:
            busiestDay
              ? `${fmtDay(
                busiestDay.day,
              )} · ${busiestDay.trips
              } trips`
              : "-",
        },

        {
          label:
            "Furthest day",
          value:
            furthestDay
              ? `${fmtDay(
                furthestDay.day,
              )} · ${fmt(
                furthestDay.distanceKm,
              )} km`
              : "-",
        },

        {
          label:
            "Avg / active day",
          value: `${fmt(
            avgTripsPerActiveDay,
            1,
          )} trips`,
        },

        {
          label:
            "Longest streak",
          value: `${longestStreak
            } day${longestStreak ===
              1
              ? ""
              : "s"
            }`,
        },
      ],
    );

    if (
      byDay?.length > 0
    ) {
      sectionTitle(
        doc,
        C,
        "Daily activity log",
      );

      addAutoTable(
        doc,
        C,
        {
          head: [
            "Date",
            "Trips",
            "Distance (km)",
          ],

          body:
            byDay.map(
              (d) => [
                fmtDay(d.day),
                fmt(d.trips),
                fmt(
                  d.distanceKm,
                ),
              ],
            ),

          columnWidths: [
            0.4,
            0.3,
            0.3,
          ],

          columnStyles: {
            1: {
              halign:
                "right",
            },

            2: {
              halign:
                "right",
            },
          },
        },
      );
    }

    if (
      (fuelTotals?.fillings ??
        0) > 0 ||
      (fuelTotals?.thefts ??
        0) > 0
    ) {
      sectionTitle(
        doc,
        C,
        "Fuel consumption & cost",
      );

      kpiTiles(
        doc,
        C,
        [
          {
            label:
              "Fuel filled",
            value:
              fmt(
                fuelTotals?.litresFilled,
              ),
            unit:
              "litres",
          },

          {
            label:
              "Fuel drained",
            value:
              fmt(
                splitDrained(fuelTotals).lost,
              ),
            unit:
              "litres",
          },

          {
            label:
              "Total fuel cost",
            value: `${currency} ${fmt(
              fuelTotals?.cost,
            )}`,
          },

          {
            label:
              "Avg per active day",
            value:
              fmt(
                fuelAverages?.perDayLitres,
              ),
            unit: `L  ·  ${currency} ${fmt(
              fuelAverages?.perDayCost,
            )} / day`,
          },
        ],
      );

      twoColStats(
        doc,
        C,
        [
          {
            label:
              "Fillings recorded",
            value:
              fmt(
                fuelTotals?.fillings,
              ),
          },

          {
            label:
              "Drain events",
            value:
              fmt(
                splitDrained(fuelTotals).drains,
              ),
          },

          {
            label:
              "Value of fuel drained",
            value: `${currency} ${fmt(
              splitDrained(fuelTotals).lossCost,
            )}`,
          },

          {
            label:
              "Suspected theft",
            value: `${fmt(
              splitDrained(fuelTotals).theft,
            )} L  ·  ${fmt(
              splitDrained(fuelTotals).thefts,
            )} events`,
          },

          {
            label:
              "Value of suspected theft",
            value: `${currency} ${fmt(
              splitDrained(fuelTotals).theftCost,
            )}`,
          },

          {
            label:
              "Fuel price used",
            value: `${currency} ${fmt(
              fuelPrice?.pricePerLitre ??
              0,
              2,
            )} / L`,
          },
        ],
      );

      if (
        fuelByDay?.length > 0
      ) {
        sectionTitle(
          doc,
          C,
          "Fuel by day",
        );

        addAutoTable(
          doc,
          C,
          {
            head: [
              "Date",
              "Litres filled",
              "Litres lost",
              `Cost (${currency})`,
            ],

            body:
              fuelByDay.map(
                (d) => [
                  fmtDay(d.day),
                  fmt(d.litres),
                  fmt(d.lost),
                  fmt(d.cost),
                ],
              ),

            columnWidths: [
              0.25,
              0.25,
              0.25,
              0.25,
            ],

            columnStyles: {
              1: {
                halign:
                  "right",
              },

              2: {
                halign:
                  "right",
              },

              3: {
                halign:
                  "right",
              },
            },
          },
        );
      }

      fuelDrainTable(
        doc,
        C,
        fuelDrains,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Finalize the report.
  // ---------------------------------------------------------------------------

  addFooters(
    doc,
    C,
    companyName,
    windowLabel,
  );

  doc.save(filename);
}