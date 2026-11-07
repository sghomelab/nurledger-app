/**
 * i18n (FR-115) — resolveLang, interpolation, English fallback, and the
 * en↔ms key-parity invariant (every reference key has a non-empty Malay
 * value; no orphan keys either way).
 */

import { enDict, msDict, filDict, resolveLang, t, type MsgKey } from '../i18n';

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
      'bayar melalui terminal kad luaran — Nurledger merekodkan pembayaran tetapi tidak memprosesnya.',
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
