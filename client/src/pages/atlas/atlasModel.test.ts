import { describe, it, expect } from 'vitest';
import { A2_TO_A3, normalizeRegionName, resolveBucketCountryA2, sortBucketItinerary, type BucketItem } from './atlasModel';

describe('normalizeRegionName', () => {
  it('matches names that only differ by diacritics (Ile-de-France vs Île-de-France)', () => {
    expect(normalizeRegionName('Ile-de-France')).toBe(normalizeRegionName('Île-de-France'));
  });

  it('matches names that only differ by dash style and surrounding spaces', () => {
    expect(normalizeRegionName('Bourgogne – Franche-Comté')).toBe(normalizeRegionName('Bourgogne-Franche-Comté'));
  });

  it('is case-insensitive', () => {
    expect(normalizeRegionName('PROVENCE')).toBe(normalizeRegionName('provence'));
  });

  it('still distinguishes genuinely different names', () => {
    expect(normalizeRegionName('Bretagne')).not.toBe(normalizeRegionName('Brittany'));
  });
});

// Countries whose GeoJSON feature carries no usable ISO_A2 must be hardcoded in
// A2_TO_A3 (see the comment above the table) or they get no map handlers at all.
describe('A2_TO_A3 hardcoded entries (#1609)', () => {
  it('maps Kosovo (XK → XKX)', () => {
    expect(A2_TO_A3.XK).toBe('XKX');
  });

  it('resolves the shipped Kosovo feature (ADM0_A3=XKX, ISO_A2=null) to XK', () => {
    // Mirrors the onEachFeature fallback in useAtlas.ts: reverse lookup by A3,
    // then ISO_A2 — which is null for Kosovo in the bundled geoBoundaries data.
    const feature = { properties: { ADM0_A3: 'XKX', ISO_A2: null as string | null } };
    const a3 = feature.properties.ADM0_A3;
    const a3ToA2Entry = Object.entries(A2_TO_A3).find(([, v]) => v === a3);
    const isoA2 = feature.properties.ISO_A2;
    const countryCode = a3ToA2Entry ? a3ToA2Entry[0] : (isoA2 && isoA2 !== '-99' ? isoA2 : null);
    expect(countryCode).toBe('XK');
  });
});

describe('resolveBucketCountryA2', () => {
  it('returns A2 codes uppercased', () => {
    expect(resolveBucketCountryA2('jp')).toBe('JP');
  });

  it('resolves A3 codes via A2_TO_A3', () => {
    expect(resolveBucketCountryA2('FRA')).toBe('FR');
  });

  it('returns null for unknown codes', () => {
    expect(resolveBucketCountryA2(null)).toBeNull();
    expect(resolveBucketCountryA2('ZZZ')).toBeNull();
  });
});

describe('sortBucketItinerary', () => {
  const item = (id: number, target_date: string | null): BucketItem => ({
    id, name: `Item ${id}`, lat: null, lng: null, country_code: null, notes: null, target_date,
  });

  it('sorts dated items chronologically', () => {
    const sorted = sortBucketItinerary([item(1, '2027-06'), item(2, '2026-03'), item(3, '2028-01')]);
    expect(sorted.map(i => i.id)).toEqual([2, 1, 3]);
  });

  it('places dated items before undated ones', () => {
    const sorted = sortBucketItinerary([item(1, null), item(2, '2027-01'), item(3, null)]);
    expect(sorted.map(i => i.id)).toEqual([2, 1, 3]);
  });

  it('preserves API list order for undated items', () => {
    const sorted = sortBucketItinerary([item(1, null), item(2, null), item(3, null)]);
    expect(sorted.map(i => i.id)).toEqual([1, 2, 3]);
  });
});
