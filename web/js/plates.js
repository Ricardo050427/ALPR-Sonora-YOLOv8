// Port of util.py (format_license / check_and_format_mask) to JavaScript.
// Same masks, same ambiguous-character dictionaries and the same 2-conversion limit.

const CHAR_TO_INT = { O: '0', I: '1', J: '3', A: '4', G: '6', S: '5', B: '8', Z: '2', T: '7' };
const INT_TO_CHAR = { '0': 'O', '1': 'I', '3': 'J', '4': 'A', '6': 'G', '5': 'S', '8': 'B', '2': 'Z', '7': 'T' };

// 'L' = letter, 'D' = digit
export const SUPPORTED_MASKS = [
  { name: 'SONORA-7P', mask: 'LLLDDDD' },  // WAB1234
  { name: 'SONORA-SCT', mask: 'LLLDDDL' }, // WAB123A
  { name: 'SONORA-6P', mask: 'LLLDDD' },   // WAA123
  { name: 'UK-STD', mask: 'LLDDLLL' },     // CE61VYL (demo original)
];

const BLACKLIST_WORDS = new Set([
  'SONORA', 'MEXICO', 'TRANSPORTE', 'PRIVADO', 'GOBIERNO', 'ESTADO', 'FRONTERA',
]);

const isLetter = (c) => c >= 'A' && c <= 'Z';
const isDigit = (c) => c >= '0' && c <= '9';

export function cleanText(text) {
  return (text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function checkAndFormatMask(text, mask) {
  if (text.length !== mask.length) return null;
  let out = '';
  let conversions = 0;
  for (let i = 0; i < mask.length; i++) {
    const c = text[i];
    if (mask[i] === 'L') {
      if (isLetter(c)) out += c;
      else if (INT_TO_CHAR[c]) { out += INT_TO_CHAR[c]; conversions++; }
      else return null;
    } else {
      if (isDigit(c)) out += c;
      else if (CHAR_TO_INT[c]) { out += CHAR_TO_INT[c]; conversions++; }
      else return null;
    }
  }
  // Maximum 2 ambiguous conversions, to avoid hallucinating plates
  if (conversions > 2) return null;
  return { plate: out, conversions };
}

/** Returns { plate, type, conversions } or null when the text is not a valid plate. */
export function formatLicense(text) {
  const clean = cleanText(text);
  if (!clean || BLACKLIST_WORDS.has(clean)) return null;
  let best = null;
  for (const { name, mask } of SUPPORTED_MASKS) {
    const r = checkAndFormatMask(clean, mask);
    if (r && (!best || r.conversions < best.conversions)) {
      best = { plate: r.plate, type: name, conversions: r.conversions };
      if (r.conversions === 0) break;
    }
  }
  return best;
}

/** Tries the whole OCR string and also every 6–7 char window (OCR often glues border noise). */
export function findPlateInText(text) {
  const clean = cleanText(text);
  const direct = formatLicense(clean);
  if (direct) return direct;
  let best = null;
  for (const len of [7, 6]) {
    for (let i = 0; i + len <= clean.length; i++) {
      const r = formatLicense(clean.slice(i, i + len));
      if (r && (!best || r.conversions < best.conversions)) best = r;
    }
  }
  return best;
}
