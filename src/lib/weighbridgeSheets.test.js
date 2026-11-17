import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { ticketsByBridge } from "./weighbridgeSheets";
import { buildWorkbook, tabNamer } from "../utils/xlsxExport";

const t = (code, name, token) => ({ centerCode: code, centerName: name, token });

describe("Weighbridges Excel, all weighbridges (operator, 17 Nov 2026)", () => {
  it("splits the tickets by weighbridge in the picker's order, and leaves out a bridge with none", () => {
    const rows = [t(102, "Opapo", 1), t(101, "Mill", 2), t(102, "Opapo", 3), t(999, "New bridge", 4)];
    const out = ticketsByBridge(rows, [{ code: 101, name: "Mill" }, { code: 102, name: "Opapo" }, { code: 103, name: "Empty" }]);
    expect(out.map(g => [g.name, g.rows.map(r => r.token)])).toEqual([
      ["Mill", [2]], ["Opapo", [1, 3]], ["New bridge", [4]],
    ]);
  });

  it("makes one file: sheet 1 with every ticket, then a sheet per weighbridge", () => {
    const head = ["Token", "Centre"];
    const wb = buildWorkbook(ExcelJS, {
      head, body: [["1", "Mill"], ["2", "Opapo"], ["3", "Opapo"]], title: "Weighbridge Tickets", sheetName: "All weighbridges",
      sheets: [
        { name: "Mill", title: "Weighbridge Tickets: Mill", body: [["1", "Mill"]] },
        { name: "Opapo", title: "Weighbridge Tickets: Opapo", body: [["2", "Opapo"], ["3", "Opapo"]] },
      ],
    });
    expect(wb.worksheets.map(ws => ws.name)).toEqual(["All weighbridges", "Mill", "Opapo"]);
    const rowsOf = ws => { const h = ws.views[0].ySplit; const out = []; for (let r = h + 1; ws.getCell(r, 1).value != null && typeof ws.getCell(r, 1).value === "number"; r++) out.push(ws.getCell(r, 1).value); return out; };
    expect(wb.worksheets.map(rowsOf)).toEqual([[1, 2, 3], [1], [2, 3]]);
    expect(wb.worksheets[2].getCell(6, 1).value).toBe("WEIGHBRIDGE TICKETS: OPAPO");
  });

  it("names tabs as Excel allows: no slashes or ? * [ ] :, 31 characters, none alike", () => {
    const tab = tabNamer();
    expect(tab("A/B: C")).toBe("A B  C");
    expect(tab("x".repeat(40))).toHaveLength(31);
    expect(tab("Mill")).toBe("Mill");
    expect(tab("MILL")).toBe("MILL (2)");
    expect(tab("")).toBe("Sheet");
  });
});
