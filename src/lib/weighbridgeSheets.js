// The Weighbridges Excel with "All weighbridges" picked (operator, 17 Nov 2026):
// one file, sheet 1 with every ticket, then a sheet for each weighbridge.

/**
 * The tickets split by weighbridge, in the picker's order (`centres`), then any
 * bridge the picker does not list. A bridge with no tickets in the set gets no
 * sheet.
 *
 * @param {{centerCode:number, centerName:string}[]} rows  the tickets, as on screen
 * @param {{code:number, name:string}[]} centres            the picker's list
 * @returns {{code:number, name:string, rows:object[]}[]}
 */
export function ticketsByBridge(rows, centres = []) {
  const groups = new Map();
  for (const c of centres) groups.set(c.code, { code: c.code, name: c.name, rows: [] });
  for (const r of rows ?? []) {
    const code = r.centerCode ?? r.centerName ?? "";
    if (!groups.has(code)) groups.set(code, { code, name: r.centerName || `Weighbridge ${code}`, rows: [] });
    groups.get(code).rows.push(r);
  }
  return [...groups.values()].filter(g => g.rows.length);
}
