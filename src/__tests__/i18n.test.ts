/**
 * i18n (FR-115) — resolveLang, interpolation, English fallback, and the
 * en↔ms key-parity invariant (every reference key has a non-empty Malay
 * value; no orphan keys either way).
 */

import { enDict, msDict, filDict, resolveLang, deviceLang, t, type MsgKey } from '../i18n';
declare const require: (m: string) => any;
declare const __dirname: string;
const fs = require('fs');
const path = require('path');

describe('resolveLang', () => {
  it('maps English values and unknown values to en', () => {
    expect(resolveLang('en')).toBe('en');
    expect(resolveLang('en-SG')).toBe('en');
    expect(resolveLang('EN')).toBe('en');
    expect(resolveLang('fr')).toBe('en');
    expect(resolveLang('')).toBe('en');
    expect(resolveLang(null)).toBe('en');
    expect(resolveLang(undefined)).toBe('en');
  });

  it('maps Malay variants to ms', () => {
    expect(resolveLang('ms')).toBe('ms');
    expect(resolveLang('ms-MY')).toBe('ms');
    expect(resolveLang('MSA')).toBe('ms');
    expect(resolveLang(' ms-MY ')).toBe('ms');
  });
});

describe('resolveLang — Filipino', () => {
  it('maps fil / tl variants to fil', () => {
    for (const v of ['fil', 'fil-PH', 'FIL', 'tl', 'tl-PH', 'tgl', ' fil-PH ']) expect(resolveLang(v)).toBe('fil');
  });
});

describe('t() interpolation', () => {
  it('substitutes a single {param}', () => {
    expect(t('en', 'sync.queuedAuto', { n: 3 })).toBe(
      '3 ops queued — syncing automatically',
    );
  });

  it('substitutes multiple params', () => {
    expect(t('en', 'pin.required', { action: 'Refund' })).toBe('Refund — PIN required');
    expect(t('ms', 'pay.stub', { detail: 'bayar melalui terminal kad luaran' })).toBe(
      'bayar melalui terminal kad luaran — NurLedger merekodkan pembayaran tetapi tidak memprosesnya.',
    );
  });

  it('ignores vars that the template does not use', () => {
    expect(t('en', 'tab.sell', { n: 5 })).toBe('Sell');
  });

  it('substitutes numbers as strings', () => {
    expect(t('en', 'sell.itemsMany', { n: 12 })).toBe('12 items');
  });
});

describe('t() fallback', () => {
  it('falls back to English when the active language lacks the key', () => {
    const key = 'tab.inventory' as MsgKey;
    const saved = msDict[key];
    delete (msDict as Record<string, string>)[key];
    try {
      expect(t('ms', key)).toBe('Inventory');
      expect(t('en', key)).toBe('Inventory');
    } finally {
      msDict[key] = saved;
    }
  });

  it('returns the key itself for a key missing from EVERY language (visible, not blank)', () => {
    expect(t('en', 'no.such.key' as MsgKey)).toBe('no.such.key');
    expect(t('ms', 'no.such.key' as MsgKey)).toBe('no.such.key');
  });
});

describe('en ↔ ms parity', () => {
  const enKeys = Object.keys(enDict) as MsgKey[];

  it('every English key has a non-empty Malay value', () => {
    const missing = enKeys.filter((k) => typeof msDict[k] !== 'string' || msDict[k] === '');
    expect(missing).toEqual([]);
  });

  it('no orphan keys on either side', () => {
    const msKeys = Object.keys(msDict) as MsgKey[];
    expect(msKeys.sort()).toEqual([...enKeys].sort());
  });

  it('Malay has no noun plural (paired item counts translate identically)', () => {
    expect(msDict['sell.itemsOne']).toBe(msDict['sell.itemsMany']);
    expect(msDict['sell.itemsMany']).toBe('{n} item');
  });
});

describe('en ↔ fil parity + placeholders (all languages)', () => {
  const enKeys = Object.keys(enDict) as MsgKey[];
  const tokens = (s: string) => (s.match(/\{[a-zA-Z]+\}/g) ?? []).sort();

  it('every English key has a non-empty Filipino value and no orphans', () => {
    expect(enKeys.filter((k) => typeof filDict[k] !== 'string' || filDict[k] === '')).toEqual([]);
    expect((Object.keys(filDict) as MsgKey[]).sort()).toEqual([...enKeys].sort());
  });

  it('{placeholders} match English in Malay and Filipino for every key', () => {
    const bad: string[] = [];
    for (const k of enKeys) {
      if (tokens(msDict[k]).join() !== tokens(enDict[k]).join()) bad.push(`ms:${k}`);
      if (tokens(filDict[k]).join() !== tokens(enDict[k]).join()) bad.push(`fil:${k}`);
    }
    expect(bad).toEqual([]);
  });

  it('Filipino renders and interpolates', () => {
    expect(t('fil', 'tab.sell')).toBe('Benta');
    expect(t('fil', 'sell.itemsMany', { n: 4 })).toBe('4 item');
    expect(t('fil', 'pin.required', { action: 'Refund' })).toBe('Refund — kailangan ang PIN');
  });

  it('falls back to English for a key missing from Filipino', () => {
    const key = 'tab.inventory' as MsgKey;
    const saved = filDict[key];
    delete (filDict as Record<string, string>)[key];
    try { expect(t('fil', key)).toBe('Inventory'); } finally { filDict[key] = saved; }
  });
});

describe('deviceLang — default language follows the device until the user chooses', () => {
  const real = Intl.DateTimeFormat;
  const withLocale = (loc: string | null) => {
    (Intl as any).DateTimeFormat = function () {
      if (loc === null) throw new Error('no Intl');
      return { resolvedOptions: () => ({ locale: loc }) };
    };
  };
  afterEach(() => {
    (Intl as any).DateTimeFormat = real;
  });
  it('maps ms / fil / tl device locales and falls back to en', () => {
    withLocale('ms-MY');
    expect(deviceLang()).toBe('ms');
    withLocale('fil-PH');
    expect(deviceLang()).toBe('fil');
    withLocale('tl-PH');
    expect(deviceLang()).toBe('fil');
    withLocale('en-SG');
    expect(deviceLang()).toBe('en');
    withLocale('ja-JP');
    expect(deviceLang()).toBe('en');
  });
  it('never throws when Intl is unavailable', () => {
    withLocale(null);
    expect(deviceLang()).toBe('en');
  });
});

describe('no spec jargon in user-facing text', () => {
  it('dictionaries contain no FR-/ADR- codes', () => {
    for (const d of [enDict, msDict, filDict] as Array<Record<string, string>>) {
      for (const [k, v] of Object.entries(d)) expect([k, /\b(FR|NFR|ADR)-\d+/.test(v)]).toEqual([k, false]);
    }
  });
  it('no screen shows an FR-/ADR- code in rendered text (comments are fine)', () => {
    const root = path.join(__dirname, '..', '..');
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }) as Array<{ name: string; isDirectory(): boolean }>) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(root, 'app'));
    walk(path.join(root, 'src', 'components'));
    const offenders: string[] = [];
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line: string, i: number) => {
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('{/*')) return;
        if (/\b(FR|NFR|ADR)-\d+/.test(line)) offenders.push(`${path.relative(root, f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
