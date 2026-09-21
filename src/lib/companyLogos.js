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

const LOGOS = { sukari: sukariLogo, kasulu: kasuluLogo, menengai: menengaiLogo, westsugar: westsugarLogo };
const MARKS = { sukari: sukariMark, kasulu: kasuluMark, menengai: menengaiMark, westsugar: westsugarMark };

const keyOf = (c) => (c ? (c.id in LOGOS ? c.id : String(c.code ?? '').toLowerCase()) : null);

export function companyLogo(company) { return LOGOS[keyOf(company)] ?? null; }
export function companyMark(company) { return MARKS[keyOf(company)] ?? null; }
