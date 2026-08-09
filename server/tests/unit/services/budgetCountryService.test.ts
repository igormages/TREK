import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The breakdown is pure read-model logic over four tables, so the DB and the
 * country resolver are both stubbed: what matters is the attribution chain
 * (expense -> date/reservation -> day -> place -> country), the carry-forward
 * over days with no geolocated place, and the day counts behind "cost per day".
 */

const rows: Record<string, unknown[]> = {
  days: [],
  assignments: [],
  reservations: [],
  items: [],
  places: [],
};

vi.mock('../../../src/db/database', () => ({
  db: {
    prepare: (sql: string) => ({
      all: (..._args: unknown[]) => {
        if (sql.includes('FROM days')) return rows.days;
        if (sql.includes('day_assignments')) return rows.assignments;
        if (sql.includes('FROM reservations')) return rows.reservations;
        if (sql.includes('FROM budget_items')) return rows.items;
        if (sql.includes('FROM places')) return rows.places;
        return [];
      },
    }),
  },
}));

const placeCountries = new Map<number, string>();
const placeCities = new Map<number, string>();
vi.mock('../../../src/services/atlasService', () => ({
  resolvePlaceCountries: () => placeCountries,
  ensurePlaceCities: () => placeCities,
}));

import { getTripCountryBreakdown } from '../../../src/services/budgetCountryService';

function setup(opts: {
  days: { id: number; date: string | null }[];
  assignments: { id: number; day_id: number }[];
  reservations?: { id: number; day_id: number | null; place_id: number | null }[];
  items: { id: number; expense_date: string | null; reservation_id: number | null }[];
  countries: Record<number, string>;
  cities?: Record<number, string>;
}) {
  rows.days = opts.days;
  rows.assignments = opts.assignments;
  rows.reservations = opts.reservations || [];
  rows.items = opts.items;
  rows.places = [];
  placeCountries.clear();
  for (const [id, code] of Object.entries(opts.countries)) placeCountries.set(Number(id), code);
  placeCities.clear();
  for (const [id, city] of Object.entries(opts.cities || {})) placeCities.set(Number(id), city);
}

beforeEach(() => { placeCountries.clear(); placeCities.clear(); });

describe('getTripCountryBreakdown', () => {
  it('attributes an expense to the country of its own date', () => {
    setup({
      days: [
        { id: 1, date: '2026-12-27' },
        { id: 2, date: '2026-12-28' },
      ],
      assignments: [
        { id: 10, day_id: 1 },
        { id: 20, day_id: 2 },
      ],
      items: [
        { id: 100, expense_date: '2026-12-27', reservation_id: null },
        { id: 200, expense_date: '2026-12-28', reservation_id: null },
      ],
      countries: { 10: 'TR', 20: 'EG' },
    });

    const out = getTripCountryBreakdown(1);
    expect(out.items).toEqual([
      { id: 100, country_code: 'TR', city: null, date: '2026-12-27' },
      { id: 200, country_code: 'EG', city: null, date: '2026-12-28' },
    ]);
    expect(out.countries).toEqual([
      { code: 'EG', days: 1 },
      { code: 'TR', days: 1 },
    ]);
  });

  it('falls back to the day of the linked reservation when the expense has no date', () => {
    setup({
      days: [{ id: 1, date: '2026-12-27' }],
      assignments: [{ id: 10, day_id: 1 }],
      reservations: [{ id: 5, day_id: 1, place_id: null }],
      items: [{ id: 100, expense_date: null, reservation_id: 5 }],
      countries: { 10: 'TR' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'TR', city: null, date: '2026-12-27' }]);
  });

  it("uses the reservation's own place when its day is outside the itinerary", () => {
    setup({
      days: [{ id: 1, date: '2026-12-27' }],
      assignments: [],
      reservations: [{ id: 5, day_id: null, place_id: 77 }],
      items: [{ id: 100, expense_date: null, reservation_id: 5 }],
      countries: { 77: 'JP' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'JP', city: null, date: null }]);
  });

  it('carries the country forward over days with no geolocated place', () => {
    setup({
      days: [
        { id: 1, date: '2027-01-01' },
        { id: 2, date: '2027-01-02' }, // travel/rest day, nothing assigned
        { id: 3, date: '2027-01-03' },
        { id: 4, date: '2027-01-04' },
      ],
      assignments: [
        { id: 10, day_id: 1 },
        { id: 30, day_id: 3 },
      ],
      items: [{ id: 100, expense_date: '2027-01-02', reservation_id: null }],
      countries: { 10: 'JP', 30: 'KR' },
    });

    const out = getTripCountryBreakdown(1);
    // The gap day inherits Japan, and day 4 (after the last place) inherits Korea.
    expect(out.items).toEqual([{ id: 100, country_code: 'JP', city: null, date: '2027-01-02' }]);
    expect(out.countries).toEqual([
      { code: 'JP', days: 2 },
      { code: 'KR', days: 2 },
    ]);
  });

  it('back-fills days that precede the first geolocated place', () => {
    setup({
      days: [
        { id: 1, date: '2027-02-01' },
        { id: 2, date: '2027-02-02' },
      ],
      assignments: [{ id: 20, day_id: 2 }],
      items: [{ id: 100, expense_date: '2027-02-01', reservation_id: null }],
      countries: { 20: 'IN' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'IN', city: null, date: '2027-02-01' }]);
    expect(getTripCountryBreakdown(1).countries).toEqual([{ code: 'IN', days: 2 }]);
  });

  it('picks the dominant country when a day spans a border', () => {
    setup({
      days: [{ id: 1, date: '2027-03-01' }],
      assignments: [
        { id: 10, day_id: 1 },
        { id: 11, day_id: 1 },
        { id: 12, day_id: 1 },
      ],
      items: [{ id: 100, expense_date: '2027-03-01', reservation_id: null }],
      countries: { 10: 'TH', 11: 'MY', 12: 'MY' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'MY', city: null, date: '2027-03-01' }]);
  });

  it('leaves an expense unattributed when nothing can place it', () => {
    setup({
      days: [{ id: 1, date: '2027-04-01' }],
      assignments: [],
      items: [{ id: 100, expense_date: null, reservation_id: null }],
      countries: {},
    });

    const out = getTripCountryBreakdown(1);
    expect(out.items).toEqual([{ id: 100, country_code: null, city: null, date: null }]);
    expect(out.countries).toEqual([]);
  });

  it('normalizes datetime expense dates to the day key', () => {
    setup({
      days: [{ id: 1, date: '2027-05-01' }],
      assignments: [{ id: 10, day_id: 1 }],
      items: [{ id: 100, expense_date: '2027-05-01T18:30:00Z', reservation_id: null }],
      countries: { 10: 'ID' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'ID', city: null, date: '2027-05-01' }]);
  });
  it("labels an expense with the city of its day's first geolocated place", () => {
    setup({
      days: [{ id: 1, date: '2026-12-27' }],
      assignments: [
        { id: 10, day_id: 1 },
        { id: 11, day_id: 1 },
      ],
      items: [{ id: 100, expense_date: '2026-12-27', reservation_id: null }],
      countries: { 10: 'TR', 11: 'TR' },
      cities: { 10: 'Istanbul', 11: 'Üsküdar' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'TR', city: 'Istanbul', date: '2026-12-27' }]);
  });

  it('falls back to a later place when the first one has no cached city', () => {
    setup({
      days: [{ id: 1, date: '2026-12-27' }],
      assignments: [
        { id: 10, day_id: 1 },
        { id: 11, day_id: 1 },
      ],
      items: [{ id: 100, expense_date: '2026-12-27', reservation_id: null }],
      countries: { 10: 'TR', 11: 'TR' },
      cities: { 11: 'Istanbul' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'TR', city: 'Istanbul', date: '2026-12-27' }]);
  });

  it('keeps the country and leaves the city null when nothing is geocoded yet', () => {
    setup({
      days: [{ id: 1, date: '2026-12-27' }],
      assignments: [{ id: 10, day_id: 1 }],
      items: [{ id: 100, expense_date: '2026-12-27', reservation_id: null }],
      countries: { 10: 'TR' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'TR', city: null, date: '2026-12-27' }]);
  });

  it("uses the reservation's own place city when the booking has no day", () => {
    setup({
      days: [{ id: 1, date: '2026-12-27' }],
      assignments: [],
      reservations: [{ id: 5, day_id: null, place_id: 77 }],
      items: [{ id: 100, expense_date: null, reservation_id: 5 }],
      countries: { 77: 'JP' },
      cities: { 77: 'Osaka' },
    });

    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'JP', city: 'Osaka', date: null }]);
  });

  it('carries no city onto a gap day the country was carried onto', () => {
    setup({
      days: [
        { id: 1, date: '2027-01-01' },
        { id: 2, date: '2027-01-02' },
      ],
      assignments: [{ id: 10, day_id: 1 }],
      items: [{ id: 100, expense_date: '2027-01-02', reservation_id: null }],
      countries: { 10: 'JP' },
      cities: { 10: 'Tokyo' },
    });

    // The country carries forward (the leg continues); the city does not, because
    // a travel day is not necessarily still in Tokyo.
    expect(getTripCountryBreakdown(1).items).toEqual([{ id: 100, country_code: 'JP', city: null, date: '2027-01-02' }]);
  });
});
