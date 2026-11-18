// The export bar with the files the Movements tabs make (operator, 18 Nov 2026: the
// Weighbridges PDFs should "use the ones we are using in the pages like
// movements"): Edit, the PDF and the JPEG either way up, and the Preview, all drawn
// by the server from one sheet (POST reports/document.pdf), as Fuel Consumption
// Rate has them; CSV and Excel as the table's own.
//
// `sheet(landscape)` is the report as a document (lib/weighbridgeDocs); `ready`,
// when given, is waited for before the sheet is read, so a file asked for while
// the table is still filling in carries the finished figures.

import { useRef, useState } from "react";
import TableToolbar from "./TableToolbar";
import { makeReportDoc } from "../../api/reports";
import { saveFile } from "../../api/tripReport";
import { savePdfAsJpeg } from "../../api/pdfJpeg";
import { useReportEditor } from "../screens/ReportEditor";
import { usePdfPreview } from "../../hooks/usePdfPreview";
import JpegButton, { PreviewButton } from "../shared/JpegButton";
import PdfPreview from "../shared/PdfPreview";
// The preview's, the editor's and the status words' rules (mvr-pv, sdoc-open, rpt-*)
import "../screens/ReportsScreen.css";

export default function ReportFilesBar({
  orgId, sheet, source, title, ready, summary, loading, onReload, onCsv, disabled = false,
}) {
  const [file, setFile] = useState({ busy: false, error: null });
  const latest = useRef(sheet);
  latest.current = sheet;
  const editor = useReportEditor({ orgId, source, build: () => latest.current(true) });

  const makePdf = async (landscape = true) => {
    if (ready) await ready();
    return editor.edited
      ? editor.make(landscape)
      : makeReportDoc({ orgId, landscape, doc: latest.current(landscape) });
  };
  const preview = usePdfPreview(makePdf);

  const save = async (as, landscape) => {
    if (file.busy) return;
    setFile({ busy: as, error: null });
    try {
      const { blob, filename } = await makePdf(landscape);
      if (as === "jpeg") await savePdfAsJpeg(blob, filename);
      else saveFile(blob, filename);
      setFile({ busy: false, error: null });
    } catch (err) {
      setFile({ busy: false, error: `The ${as === "jpeg" ? "JPEG" : "PDF"} could not be made: ${err?.message ?? err}` });
    }
  };

  return (
    <>
      <TableToolbar
        summary={summary}
        loading={loading}
        onReload={onReload}
        onCsv={onCsv}
        onPdf={file.busy ? undefined : (landscape) => save("pdf", landscape)}
        pdfWays
        disabled={disabled}
        actions={<>
          {editor.button}
          {file.busy
            ? <span className="rpt-sub" role="status">{file.busy === "jpeg" ? "Making the JPEG…" : "Making the PDF…"}</span>
            : file.error ? <span className="rpt-warn" role="alert">{file.error}</span> : null}
          <JpegButton onSave={(landscape) => save("jpeg", landscape)} disabled={disabled || Boolean(file.busy)} title="The PDF report as an image" />
          <PreviewButton onPreview={preview.open} disabled={disabled || Boolean(file.busy)} />
        </>}
      />
      {preview.state && <PdfPreview state={preview.state} title={title} edited={editor.edited ? 1 : 0} onRetry={preview.retry} onClose={preview.close} />}
      {editor.overlay}
    </>
  );
}
