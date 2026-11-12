// A customer's name as the reports print it (operator, 12 Nov 2026: "Kapu
// Tech LTD and not KAPU TECH LTD"). Geofences and sheets carry names in
// capitals or all lower case; each such word is set with a capital first
// letter. Company forms and short codes stay in capitals (LTD, PLC, EPZ,
// (K)), a word with a digit is a code and is left alone, and a word already
// in mixed case was typed that way on purpose and is kept.

const UPPER = new Set([
  'LTD', 'PLC', 'LLC', 'LLP', 'EPZ', 'MDF', 'MORL', 'STO', 'CBD', 'HQ', 'DT', 'PO', 'NBI', 'KK',
  'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII', 'FG', 'VS', 'ATM', 'USA', 'UK', 'EA',
]);
const SMALL = new Set(['and', 'of', 'the', 'at', 'on', 'in', 'for', 'de', 'la']);

const isUpper = (w) => w === w.toUpperCase() && w !== w.toLowerCase();
const isLower = (w) => w === w.toLowerCase() && w !== w.toUpperCase();

/** One hyphen-free part: its first letter up, the rest down (O'NEIL → O'neil, MAMA'S → Mama's). */
function cap(part) {
  const i = part.search(/\p{L}/u);
  if (i < 0) return part;
  return part.slice(0, i) + part[i].toUpperCase() + part.slice(i + 1).toLowerCase();
}

function word(w, first) {
  const letters = w.replace(/[^\p{L}\p{N}]/gu, '');
  if (!letters || /\d/.test(letters)) return w;
  if (!isUpper(w) && !isLower(w)) return w;
  if (UPPER.has(letters.toUpperCase()) || letters.length === 1) return w.toUpperCase();
  if (!first && SMALL.has(letters.toLowerCase())) return w.toLowerCase();
  return w.split('-').map(cap).join('-');
}

/** "KAPU TECH KENYA LTD" → "Kapu Tech Kenya LTD"; "jalaram" → "Jalaram"; null/empty as given. */
export function customerName(name) {
  if (name == null) return name;
  const s = String(name).replace(/\s+/g, ' ').trim();
  if (!s) return s;
  let first = true;
  return s.split(' ').map((w) => {
    const out = word(w, first);
    if (/[\p{L}\p{N}]/u.test(w)) first = false;
    return out;
  }).join(' ');
}
