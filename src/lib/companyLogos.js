// Company logos, keyed by company id (the same ids as data/companyData and
// api/org ORG_CODE_BY_COMPANY).
//
//   companyMark(c) — the logo's symbol only, square. Readable at 24–32px, so
//                    it's what the header and switchers use.
//   companyLogo(c) — the full logo with wordmark, for larger spots
//                    (profile sheets, reports, login screen).
//
// A company with no entry returns null and callers fall back to its letter.
import sukariLogo    from '../assets/logos/sukari.png';          // Ndhiwa Sukari
import kasuluLogo    from '../assets/logos/kasulu.png';          // Mufindi Paper
import menengaiLogo  from '../assets/logos/menengai.png';        // Menengai
import westsugarLogo from '../assets/logos/westsugar.png';       // Kabras Sugar
import sukariMark    from '../assets/logos/sukari-mark.png';
import kasuluMark    from '../assets/logos/kasulu-mark.png';
import menengaiMark  from '../assets/logos/menengai-mark.png';
import westsugarMark from '../assets/logos/westsugar-mark.png';
import kabrasLogo    from '../assets/logos/kabras-logo.png';     // the operator's Kabras.png, background removed
import kabrasMark    from '../assets/logos/kabras-mark.png';     // the oval emblem, without the ribbon
import timsalesLogo  from '../assets/logos/timsales.png';
import timsalesMark  from '../assets/logos/timsales-mark.png';         // the tree, without the wordmark
import aquamistLogo  from '../assets/logos/aquamist.png';
// The wordmark has no symbol, so the mark is its own "A" — the glyph lifted
// out of the logo, not a font set to look like it.
import aquamistMark  from '../assets/logos/aquamist-mark.png';

const LOGOS = { sukari: sukariLogo, kasulu: kasuluLogo, menengai: menengaiLogo, westsugar: westsugarLogo, kabras: kabrasLogo, timsales: timsalesLogo, aquamist: aquamistLogo };
const MARKS = { sukari: sukariMark, kasulu: kasuluMark, menengai: menengaiMark, westsugar: westsugarMark, kabras: kabrasMark, timsales: timsalesMark, aquamist: aquamistMark };

const keyOf = (c) => (c ? (c.id in LOGOS ? c.id : String(c.code ?? '').toLowerCase()) : null);

export function companyLogo(company) { return LOGOS[keyOf(company)] ?? null; }
export function companyMark(company) { return MARKS[keyOf(company)] ?? null; }
