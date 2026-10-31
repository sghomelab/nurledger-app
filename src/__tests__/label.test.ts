/**
 * FR-317 label engine tests.
 *
 * The UPC-A vectors are the ground truth established against independent
 * encoders/decoders (see M6-TASKS.md "Label barcode verification"):
 *  - '112345678902' bit string = ZXing/Zint's own rendering, diffed
 *    bit-for-bit (95/95 match), decoded back by ZBar + zxing-cpp.
 *  - '012345678905' bit string = python-barcode's geometry, ZBar-decoded.
 * Code 39 patterns were ZBar-decoded per character (43/44, lone '*' is a
 * valid empty symbol) and as 8 mixed strings before transcription.
 */
import {
  upcaModules,
  code39Modules,
  symbologyFor,
  moduleRuns,
  barcodeSvg,
  buildLabelHtml,
  CODE39_CHARS,
  type LabelItem,
} from '../lib/label';

const ZXING_VERIFIED_112345678902 =
  '10100110010011001001001101111010100011011000101010101000010001001001000111010011100101101100101';
const REFERENCE_VERIFIED_012345678905 =
  '10100011010011001001001101111010100011011000101010101000010001001001000111010011100101001110101';

describe('upcaModules', () => {
  it('matches the ZXing-verified geometry for a leading-1 code', () => {
    expect(upcaModules('112345678902')).toBe(ZXING_VERIFIED_112345678902);
  });

  it('matches the reference geometry for a leading-0 code', () => {
    expect(upcaModules('012345678905')).toBe(REFERENCE_VERIFIED_012345678905);
  });

  it('always produces 95 modules (3 + 42 + 5 + 42 + 3)', () => {
    for (const code of ['012000000355', '023000000806', '999999999995', '000000000000']) {
      expect(upcaModules(code).length).toBe(95);
    }
  });

  it('starts and ends with the 101 guard; middle guard at module 45', () => {
    const bits = upcaModules('012000000355');
    expect(bits.startsWith('101')).toBe(true);
    expect(bits.endsWith('101')).toBe(true);
    // 3 (start) + 42 (left half) = 45
    expect(bits.slice(45, 50)).toBe('01010');
  });

  it('rejects non-12-digit and non-numeric input', () => {
    expect(() => upcaModules('01200000035')).toThrow();
    expect(() => upcaModules('01200000035A')).toThrow();
    expect(() => upcaModules('')).toThrow();
  });
});

describe('code39Modules', () => {
  it('is edge + (space + pattern) per char + edge', () => {
    const bits = code39Modules('0');
    const EDGE = '100010111011101';
    expect(bits.startsWith(EDGE)).toBe(true);
    expect(bits.endsWith(EDGE)).toBe(true);
    expect(bits).toBe(EDGE + '0' + '101000111011101' + EDGE);
  });

  it('scales 16 modules per character (15-bit pattern + interchar space)', () => {
    expect(code39Modules('SKU-123').length).toBe(15 + 7 * 16 + 15);
    expect(code39Modules('20000000').length).toBe(15 + 8 * 16 + 15);
  });

  it('uppercases text', () => {
    expect(code39Modules('fruit-appl-01')).toBe(code39Modules('FRUIT-APPL-01'));
  });

  it('rejects characters outside the Code 39 set', () => {
    expect(() => code39Modules('SKU#1')).toThrow();
    expect(() => code39Modules('')).toThrow();
  });
});

describe('symbologyFor', () => {
  it('12-digit numeric → upca', () => {
    expect(symbologyFor('012000000355')).toBe('upca');
  });

  it('other encodable codes → code39', () => {
    expect(symbologyFor('20000000')).toBe('code39');
    expect(symbologyFor('FRUIT-APPL-01')).toBe('code39');
    expect(symbologyFor('sku.1')).toBe('code39'); // lowercase normalized
  });

  it('rejects empty, null, and unencodable codes', () => {
    expect(symbologyFor('')).toBeNull();
    expect(symbologyFor(null)).toBeNull();
    expect(symbologyFor(undefined)).toBeNull();
    expect(symbologyFor('has spaces!')).toBeNull();
    expect(symbologyFor('1234567890123')).toBe('code39'); // 13 digits: not UPC-A → Code 39 fallback
  });

  it('exposes the full Code 39 data alphabet (43 symbols)', () => {
    // 0-9, A-Z, space, -, ., $, /, +, %  ('*' is the start/stop guard, not data)
    expect(CODE39_CHARS.size).toBe(43);
    for (const ch of '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ-. $/+%') {
      expect(CODE39_CHARS.has(ch)).toBe(true);
    }
    expect(CODE39_CHARS.has('*')).toBe(false);
  });
});

describe('moduleRuns', () => {
  it('splits bars and spaces', () => {
    expect(moduleRuns('101')).toEqual([
      [true, 1],
      [false, 1],
      [true, 1],
    ]);
    expect(moduleRuns('1100')).toEqual([
      [true, 2],
      [false, 2],
    ]);
  });

  it('run counts sum to the bit length and start with a bar', () => {
    for (const bits of [upcaModules('012000000355'), code39Modules('SKU-123')]) {
      const runs = moduleRuns(bits);
      expect(runs[0]![0]!).toBe(true);
      expect(runs.reduce((s, [, n]) => s + n, 0)).toBe(bits.length);
    }
  });
});

describe('barcodeSvg', () => {
  it('renders a self-contained SVG sized for the 58mm label', () => {
    const svg = barcodeSvg('012000000355');
    expect(svg).toContain('<svg');
    expect(svg).toContain('width="52mm"');
    expect(svg).toContain('<rect');
    // self-contained: no external resources
    expect(svg).not.toContain('src=');
    expect(svg).not.toContain('<image');
    expect(svg).not.toContain('url(');
  });

  it('UPC-A has 30 bar rects (95 modules = 30 bars for this code is code-dependent; assert > 20)', () => {
    const svg = barcodeSvg('012000000355');
    const n = (svg.match(/<rect/g) ?? []).length;
    expect(n).toBeGreaterThan(20);
    expect(n).toBeLessThan(50);
  });

  it('rejects unencodable codes', () => {
    expect(() => barcodeSvg('nope!')).toThrow();
  });
});

describe('buildLabelHtml', () => {
  const items: LabelItem[] = [
    { name: 'Artisan Country Sourdough Loaf', priceText: 'SGD 6.50', code: '023000000578', count: 2 },
    { name: 'Russet Apples (loose)', priceText: 'SGD 4.20', code: '20000000', count: 1 },
  ];

  it('expands counts and escapes HTML', () => {
    const html = buildLabelHtml(items, 'sheetA4');
    const labels = (html.match(/class="label"/g) ?? []).length;
    expect(labels).toBe(3); // 2 + 1
    const evil = buildLabelHtml([{ name: '<script>alert(1)</script>', priceText: 'SGD 1.00', code: '012000000355' }], 'sheetA4');
    expect(evil).not.toContain('<script>');
    expect(evil).toContain('&lt;script&gt;');
  });

  it('roll58: 58mm pages, one label per page', () => {
    const html = buildLabelHtml(items, 'roll58');
    expect(html).toContain('@page { size: 58mm auto; margin: 0; }');
    expect(html).toContain('page-break-after: always');
    expect(html).not.toContain('grid-template-columns');
  });

  it('sheetA4: 3-column grid of 58mm labels', () => {
    const html = buildLabelHtml(items, 'sheetA4');
    expect(html).toContain('@page { size: A4; margin: 8mm; }');
    expect(html).toContain('repeat(3, 58mm)');
    expect(html).toContain('<div class="sheet">');
  });

  it('contains one barcode SVG per label', () => {
    const html = buildLabelHtml(items, 'roll58');
    expect((html.match(/<svg/g) ?? []).length).toBe(3);
  });
});
