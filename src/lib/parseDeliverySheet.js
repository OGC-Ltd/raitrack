/**
 * Parse a Menengai delivery booking sheet (Excel .xlsx) into stops for the
 * Deliveries Report.
 *
 * The sheet has a header block at the top (truck number, date, driver) and then
 * a table whose columns include:
 *   NO. | REP | CUSTOMER ID | CUSTOMER NAME | LOCATION | COORDINATES | INVOICE NO. | AMOUNT | TONNAGE | ...
 *
 * The COORDINATES cell looks like:
 *   "LAT: -0.095096700000000 LONG: 36.127076700000000"
 *
 * Returns:
 *   {
 *     plate:    string | null,   // e.g. "KDE 128E"
 *     driver:   string | null,
 *     date:     string | null,   // "2026-11-09"
 *     pins:     Array<{ name, lat, lng, radiusM }>,
 *     customers: string[],       // CUSTOMER NAME list (for the customers field)
 *     rows:     Array<{ no, rep, customerId, customerName, location, lat, lng, invoiceNo, amount, tonnage }>,
 *     error:    string | null,
 *   }
 */

import * as XLSX from 'xlsx';
import { PIN_RADIUS_M } from './deliveryPlan';

const LAT_LONG_RE = /lat\s*:\s*(-?\d+\.?\d*)\s+long\s*:\s*(-?\d+\.?\d*)/i;

/** Normalise a cell value to a plain string. */
const str = (v) => (v == null ? '' : String(v).trim());

/**
 * Find the header row — the row that contains "CUSTOMER NAME" (or similar) in
 * one of its cells. Returns the row index (0-based) or -1.
 */
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const joined = row.map(str).join(' ').toUpperCase();
    if (joined.includes('CUSTOMER NAME') || joined.includes('CUSTOMER ID')) return i;
  }
  return -1;
}

/**
 * Find a column index by header keyword (case-insensitive partial match).
 */
function col(headers, keyword) {
  const kw = keyword.toUpperCase();
  return headers.findIndex((h) => str(h).toUpperCase().includes(kw));
}

/**
 * Scan the top block (above the table) for truck number and driver name.
 */
function parseHeader(rows, tableStart) {
  let plate = null;
  let driver = null;
  let date = null;
  for (let i = 0; i < tableStart; i++) {
    const row = rows[i];
    if (!Array.isArray(row)) continue;
    const joined = row.map(str).join(' ');
    // Truck Number: KDE 128E
    const truckM = joined.match(/truck\s+number\s*[:\-]?\s*([A-Z]{2,4}\s*\d{3,4}[A-Z]?)/i);
    if (truckM) plate = truckM[1].trim().toUpperCase();
    // Driver Name: THOMAS ROGONY
    const driverM = joined.match(/driver\s+name\s*[:\-]?\s*([A-Z][A-Z\s]+)/i);
    if (driverM) driver = driverM[1].trim();
    // Date: 2026-11-09
    const dateM = joined.match(/date\s*[:\-]?\s*(\d{4}-\d{2}-\d{2})/i);
    if (dateM) date = dateM[1];
  }
  return { plate, driver, date };
}

/**
 * Parse a delivery booking Excel file (ArrayBuffer or Uint8Array).
 *
 * @param {ArrayBuffer|Uint8Array} buffer
 * @returns {object}  see module-level JSDoc
 */
export function parseDeliverySheet(buffer) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'array' });
  } catch (e) {
    return { plate: null, driver: null, date: null, pins: [], customers: [], rows: [], error: `Could not read file: ${e.message}` };
  }

  // Use the first sheet
  const sheetName = wb.SheetNames[0];
  if (!sheetName) {
    return { plate: null, driver: null, date: null, pins: [], customers: [], rows: [], error: 'The file has no sheets.' };
  }
  const ws = wb.Sheets[sheetName];
  // Convert to array-of-arrays for easy scanning
  const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

  const headerRow = findHeaderRow(raw);
  if (headerRow === -1) {
    return { plate: null, driver: null, date: null, pins: [], customers: [], rows: [], error: 'Could not find the table header row (expected a "CUSTOMER NAME" column).' };
  }

  const headers = raw[headerRow].map(str);
  const iNo       = col(headers, 'NO');
  const iRep      = col(headers, 'REP');
  const iCustId   = col(headers, 'CUSTOMER ID');
  const iCustName = col(headers, 'CUSTOMER NAME');
  const iLocation = col(headers, 'LOCATION');
  const iCoords   = col(headers, 'COORDINATES');
  const iInvoice  = col(headers, 'INVOICE');
  const iAmount   = col(headers, 'AMOUNT');
  const iTonnage  = col(headers, 'TONNAGE');

  const { plate, driver, date } = parseHeader(raw, headerRow);

  const pins = [];
  const customers = [];
  const rows = [];

  for (let i = headerRow + 1; i < raw.length; i++) {
    const row = raw[i];
    if (!Array.isArray(row)) continue;

    const noVal = str(row[iNo]);
    // Stop at totals row or empty rows
    if (!noVal || noVal.toUpperCase().includes('TOTAL')) break;
    // Must be a numeric row number
    if (!/^\d+$/.test(noVal)) continue;

    const customerName = iCustName >= 0 ? str(row[iCustName]) : '';
    const location     = iLocation >= 0 ? str(row[iLocation]) : '';
    const coordStr     = iCoords  >= 0 ? str(row[iCoords])   : '';

    // Parse coordinates
    let lat = null;
    let lng = null;
    const m = coordStr.match(LAT_LONG_RE);
    if (m) {
      lat = parseFloat(m[1]);
      lng = parseFloat(m[2]);
    }

    const dataRow = {
      no:           parseInt(noVal, 10),
      rep:          iRep      >= 0 ? str(row[iRep])      : '',
      customerId:   iCustId   >= 0 ? str(row[iCustId])   : '',
      customerName,
      location,
      lat,
      lng,
      invoiceNo:    iInvoice  >= 0 ? str(row[iInvoice])  : '',
      amount:       iAmount   >= 0 ? row[iAmount]        : null,
      tonnage:      iTonnage  >= 0 ? row[iTonnage]       : null,
    };
    rows.push(dataRow);

    // Build a pin if we have coordinates.
    // When coordinates are present we use the pin for delivery checking, so we
    // do NOT also add the name to customers — that would make every stop appear
    // twice in the report (once as a geofence customer, once as a pin).
    if (lat !== null && lng !== null) {
      const name = customerName || location || `Stop ${noVal}`;
      pins.push({ name, lat, lng, radiusM: PIN_RADIUS_M });
    } else if (customerName) {
      // No coordinates — fall back to geofence matching by name
      customers.push(customerName);
    }
  }

  if (rows.length === 0) {
    return { plate, driver, date, pins: [], customers: [], rows: [], error: 'No delivery rows found in the sheet.' };
  }

  return { plate, driver, date, pins, customers: [...new Set(customers)], rows, error: null };
}
