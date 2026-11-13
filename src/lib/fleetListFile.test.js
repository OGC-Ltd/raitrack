import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { readFleetSheets, readFleetWorkbook } from './fleetListFile';
import { fleetListMap, fleetListEntry } from './probeHealthReport';

const sheet = (name, title, rows) => ({ name, rows: [
  [null, title, null, null, null, null, null, 'SYSTEM', null, null, null, 'STATUS'],
  ['NO', 'TRUCK NO', 'TYPE', 'DRIVER NAME', 'ID NO.', 'PHONE NO.', 'LOCATION', 'TRACK 3', 'MIX TELEMATICS', 'VSS', 'NTSA', null],
  ...rows,
  [],
  [null, null, 'WHATSAPP GROUP TEAM'], [null, null, 1, 'SOMEONE', '0700-000000'],
] });

describe('the fleet Excel uploaded for the Probe report (operator, 13 Nov 2026)', () => {
  it('reads plate, driver and status from every sheet; ID and phone are not kept', () => {
    const got = readFleetSheets([
      sheet('MORL TANKER FLEET', 'TANKERS', [[1, 'KCK 456G', 'TANKER', 'STEPHEN MAINA MWANGI', 23070210, '0720-855725', 'HQ', '✔', '✘', '✔', '✔', 'OPERATIONAL'],
        [2, 'KCV 033A', 'TANKER', 'GARAGE', null, null, 'HQ', '✘', '✘', '✘', '✔', 'WORKSHOP']]),
      sheet('MORL FG FLEET', 'FINISHED GOODS', [[1, 'KBT 113R', 'FG', null, null, null, 'HQ', '✘', '✘', '✘', '✔', null]]),
    ]);
    expect(got.entries).toEqual({
      'KCK 456G': { driver: 'Stephen Maina Mwangi', status: 'Operational', type: 'TANKER', list: 'MORL TANKER FLEET' },
      'KCV 033A': { driver: '', status: 'Workshop', type: 'TANKER', list: 'MORL TANKER FLEET' },
      'KBT 113R': { driver: '', status: '', type: 'FG', list: 'MORL FG FLEET' },
    });
    expect(got.sheets).toEqual([{ name: 'MORL TANKER FLEET', count: 2 }, { name: 'MORL FG FLEET', count: 1 }]);
    expect(JSON.stringify(got)).not.toMatch(/23070210|0720-855725/);
  });
  it('a unit twice on its sheet has both drivers; on two sheets the first is kept and said', () => {
    const got = readFleetSheets([
      sheet('RAI MDF EQUIPMENT', 'EQUIPMENT', [[1, 'FL 01', 'FORKLIFT', 'ALBERT OMARI', 1, '', '', '', '', '', '', null], [null, 'FL 01', 'FORKLIFT', 'SHEILA CHEPTOO', 2, '', '', '', '', '', '', null]]),
      sheet('OTHER', 'EQUIPMENT', [[1, 'FL01', 'FORKLIFT', 'SOMEONE ELSE', 3, '', '', '', '', '', '', 'OPERATIONAL']]),
    ]);
    expect(got.entries['FL 01'].driver).toBe('Albert Omari / Sheila Cheptoo');
    expect(got.conflicts).toEqual([{ plate: 'FL01', kept: 'RAI MDF EQUIPMENT', also: 'OTHER' }]);
  });
  it('a heading or a list of names in the TRUCK NO column is not a unit', () => {
    const got = readFleetSheets([sheet('MORL FARM EQUIPMENT', 'FARM EQUIPMENT', [[1, 'KTCC 085A', 'CASE PUMA', 'BENSON LUYEMVA', 1, '', 'FARM', '', '', '', '', null],
      [null, 'WHATSAPP GROUP TEAM'], [null, 1, 'TARSEM LOTTAY'], [null, 'FORKLIFT', 'BAOLI', 'X']])]);
    expect(Object.keys(got.entries)).toEqual(['KTCC 085A']);
    expect(got.entries['KTCC 085A'].type).toBe('CASE PUMA');
  });
  it('a sheet without the columns is passed over', () => {
    expect(readFleetSheets([{ name: 'Notes', rows: [['hello']] }]).sheets).toEqual([]);
  });
  it('reads a real .xlsx, and the report looks plates up in it', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('MORL VS FLEET');
    sheet('', 'VANSALES', [[1, 'KDE 268P', 'HINO', 'KIPKOECH NGENO', 1, '', 'HQ', '', '', '', '', 'ACCIDENT']]).rows.forEach((r) => ws.addRow(r));
    const got = await readFleetWorkbook(await wb.xlsx.writeBuffer());
    expect(fleetListEntry({ plate: 'KDE268P' }, fleetListMap(got.entries))).toEqual({ driver: 'Kipkoech Ngeno', status: 'Accident', type: 'HINO', list: 'MORL VS FLEET' });
  });
});
