/**
 * Label printing (FR-317) — barcode label generation. Pure + unit-testable:
 * no DB, no RN.
 *
 * Symbology (GS1):
 *  - **12-digit numeric → UPC-A.** The UPC-A symbol is the EAN-13 "0"+code
 *    symbol: start guard `101`, left half = 6 digits in the even (L)
 *    patterns, middle guard `01010`, right half = 6 digits in the odd (R)
 *    patterns, end guard `101` — 95 modules. This geometry was verified
 *    bit-for-bit against ZXing/Zint output and decodes in ZBar + zxing-cpp
 *    for every leading digit. (Scanners may report it as EAN-13 `0`+code;
 *    `parseBarcodeSg` normalizes that back.)
 *  - **anything else → Code 39** (universal retail fallback; 43 printable
 *    chars, verified decodable). Used for short/legacy codes AND for
 *    unlabeled items, whose SKU is printed as the Code 39 content so the
 *    shop can scan its own SKU (FR-317 "no-barcode items → scannable SKUs").
 *
 * Output is self-contained HTML: inline SVG barcodes, system fonts, no JS,
 * no external resources — safe for the kiosk's offline print path
 * (58mm thermal roll strip, or an A4 sheet grid), shared via expo-sharing
 * like the CSV reports.
 */

export type Symbology = 'upca' | 'code39';
export type LabelLayout = 'roll58' | 'sheetA4';

/** UPC-A even (L) patterns — left half, 7 modules each ('1' = bar). */
const UPC_L: Record<string, string> = {
  '0': '0001101',
  '1': '0011001',
  '2': '0010011',
  '3': '0111101',
  '4': '0100011',
  '5': '0110001',
  '6': '0101111',
  '7': '0111011',
  '8': '0110111',
  '9': '0001011',
};

/** UPC-A odd (R) patterns — right half. R[d] is the mirror of the L pattern. */
const UPC_R: Record<string, string> = {
  '0': '1110010',
  '1': '1100110',
  '2': '1101100',
  '3': '1000010',
  '4': '1011100',
  '5': '1001110',
  '6': '1010000',
  '7': '1000100',
  '8': '1001000',
  '9': '1110100',
};

const UPC_EDGE = '101';
const UPC_MIDDLE = '01010';

/**
 * 95-module UPC-A bit string for a 12-digit code.
 * Left six digits in L patterns, right six in R patterns.
 */
export function upcaModules(code12: string): string {
  if (!/^\d{12}$/.test(code12)) throw new Error(`UPC-A needs 12 digits, got "${code12}"`);
  let bits = UPC_EDGE;
  for (let i = 0; i < 6; i++) bits += UPC_L[code12[i]!];
  bits += UPC_MIDDLE;
  for (let i = 6; i < 12; i++) bits += UPC_R[code12[i]!];
  bits += UPC_EDGE;
  if (bits.length !== 95) throw new Error(`UPC-A module length ${bits.length} != 95`);
  return bits;
}

/** Code 39 start/stop edge pattern (the `*` guard). */
const CODE39_EDGE = '100010111011101';

/** Code 39 character patterns (17 bits each; verified against ZBar decode). */
const CODE39_BITS: Record<string, string> = {
  '0': '101000111011101',
  '1': '111010001010111',
  '2': '101110001010111',
  '3': '111011100010101',
  '4': '101000111010111',
  '5': '111010001110101',
  '6': '101110001110101',
  '7': '101000101110111',
  '8': '111010001011101',
  '9': '101110001011101',
  A: '111010100010111',
  B: '101110100010111',
  C: '111011101000101',
  D: '101011100010111',
  E: '111010111000101',
  F: '101110111000101',
  G: '101010001110111',
  H: '111010100011101',
  I: '101110100011101',
  J: '101011100011101',
  K: '111010101000111',
  L: '101110101000111',
  M: '111011101010001',
  N: '101011101000111',
  O: '111010111010001',
  P: '101110111010001',
  Q: '101010111000111',
  R: '111010101110001',
  S: '101110101110001',
  T: '101011101110001',
  U: '111000101010111',
  V: '100011101010111',
  W: '111000111010101',
  X: '100010111010111',
  Y: '111000101110101',
  Z: '100011101110101',
  '-': '100010101110111',
  '.': '111000101011101',
  ' ': '100011101011101',
  $: '100010001000101',
  '/': '100010001010001',
  '+': '100010001100011',
  '%': '100011000100011',
};

/** The characters Code 39 can carry (uppercase). */
export const CODE39_CHARS: ReadonlySet<string> = new Set(Object.keys(CODE39_BITS));

/**
 * Code 39 bit string: edge + (narrow space + pattern) per char + edge.
 * Throws on characters outside the Code 39 set.
 */
export function code39Modules(text: string): string {
  const t = text.toUpperCase();
  if (!t) throw new Error('Code 39 needs non-empty text');
  for (const ch of t) {
    if (!CODE39_CHARS.has(ch)) throw new Error(`Code 39 cannot encode "${ch}"`);
  }
  let bits = CODE39_EDGE;
  for (const ch of t) bits += '0' + CODE39_BITS[ch];
  return bits + CODE39_EDGE;
}

/**
 * Pick the symbology for a label content code:
 * 12-digit numeric → UPC-A; anything in the Code 39 set → Code 39;
 * otherwise null (not printable).
 */
export function symbologyFor(code: string | null | undefined): Symbology | null {
  const c = (code ?? '').trim();
  if (!c) return null;
  if (/^\d{12}$/.test(c)) return 'upca';
  const t = c.toUpperCase();
  for (const ch of t) {
    if (!CODE39_CHARS.has(ch)) return null;
  }
  return 'code39';
}

/** Bar/space runs for a module bit string: [isBar, moduleCount]. */
export function moduleRuns(bits: string): Array<[boolean, number]> {
  if (!bits) throw new Error('empty bit string');
  const runs: Array<[boolean, number]> = [];
  let isBar = bits[0] === '1';
  let n = 1;
  for (let i = 1; i < bits.length; i++) {
    const b = bits[i] === '1';
    if (b === isBar) n++;
    else {
      runs.push([isBar, n]);
      isBar = b;
      n = 1;
    }
  }
  runs.push([isBar, n]);
  return runs;
}

export interface BarcodeSvgOpts {
  /** Full SVG width in mm, quiet zones included (default 52). */
  widthMm?: number;
  /** SVG height in mm (default 12). */
  heightMm?: number;
  /** Quiet zone in modules per side (default 8). */
  quietModules?: number;
}

/**
 * Inline SVG for the code's bars (self-contained — no external refs).
 * The quiet zone is part of the SVG so the printed white margin survives.
 */
export function barcodeSvg(code: string, opts: BarcodeSvgOpts = {}): string {
  const sym = symbologyFor(code);
  if (!sym) throw new Error(`No printable symbology for "${code}"`);
  const bits = sym === 'upca' ? upcaModules(code) : code39Modules(code);
  const widthMm = opts.widthMm ?? 52;
  const heightMm = opts.heightMm ?? 12;
  const quiet = opts.quietModules ?? 8;
  const total = bits.length + quiet * 2;
  const mmPerModule = widthMm / total;
  const rects: string[] = [];
  let x = quiet * mmPerModule;
  for (const [isBar, count] of moduleRuns(bits)) {
    if (isBar) {
      rects.push(
        `<rect x="${x.toFixed(3)}" y="0" width="${(count * mmPerModule).toFixed(3)}" height="100%"/>`,
      );
    }
    x += count * mmPerModule;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm"` +
    ` viewBox="0 0 ${widthMm} ${heightMm}"><g fill="#000">${rects.join('')}</g></svg>`
  );
}

export interface LabelItem {
  name: string;
  /** Formatted price, e.g. "SGD 6.50" (formatMoney). */
  priceText: string;
  /** The content code that goes under the bars (barcode or SKU). */
  code: string;
  /** Copies of this label (default 1). */
  count?: number;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function labelCell(item: LabelItem): string {
  return (
    `<div class="label">` +
    `<div class="name">${esc(item.name)}</div>` +
    `<div class="price">${esc(item.priceText)}</div>` +
    barcodeSvg(item.code) +
    `<div class="code">${esc(item.code)}</div>` +
    `</div>`
  );
}

const LABEL_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { font-family: Helvetica, Arial, sans-serif; color: #000; }
  .label {
    width: 58mm; height: 40mm;
    padding: 2mm 3mm;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .name {
    font-size: 8.5pt; font-weight: 700; line-height: 1.15;
    max-height: 6.4mm; overflow: hidden;
  }
  .price { font-size: 13pt; font-weight: 700; margin-top: auto; padding-top: 1mm; }
  svg { display: block; margin-top: 1mm; }
  .code {
    font-family: "SFMono-Regular", Consolas, Menlo, monospace;
    font-size: 6.5pt; text-align: center; letter-spacing: 0.6px; margin-top: 0.6mm;
  }
`;

const ROLL_CSS = `
  @page { size: 58mm auto; margin: 0; }
  html, body { width: 58mm; }
  .label { page-break-after: always; border-bottom: 0.3mm dashed #999; }
  .label:last-child { page-break-after: auto; }
`;

const SHEET_CSS = `
  @page { size: A4; margin: 8mm; }
  .sheet { display: grid; grid-template-columns: repeat(3, 58mm); gap: 4mm 6mm; }
  .label { border: 0.3mm dashed #999; }
`;

/**
 * Build the full self-contained label document.
 * `roll58` = one 58mm label per page (thermal roll);
 * `sheetA4` = 58×40mm labels in a 3-column A4 grid (laser/inkjet).
 */
export function buildLabelHtml(items: LabelItem[], layout: LabelLayout): string {
  const cells: string[] = [];
  for (const item of items) {
    for (let i = 0; i < Math.max(1, item.count ?? 1); i++) cells.push(labelCell(item));
  }
  const body = layout === 'sheetA4' ? `<div class="sheet">${cells.join('')}</div>` : cells.join('');
  return (
    `<!doctype html><html><head><meta charset="utf-8">` +
    `<title>Barcodes — ${cells.length} label(s)</title>` +
    `<style>${LABEL_CSS}${layout === 'roll58' ? ROLL_CSS : SHEET_CSS}</style>` +
    `</head><body>${body}</body></html>`
  );
}
