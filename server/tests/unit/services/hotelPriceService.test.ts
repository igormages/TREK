/**
 * Hotel price lookup — HOTEL-PRICE-001 through 012.
 *
 * Two things carry the risk here and both are tested against real data rather
 * than mocks: the SQL that decides which properties are worth quoting, and the
 * matcher that decides whether a Hotellook listing IS the hotel we hold. A
 * wrong match is the dangerous failure — it prices the building next door and
 * looks entirely correct while doing it.
 *
 * `fetch` is stubbed because the far end is a paid affiliate API; everything
 * around it is the real thing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    testDb: db,
    dbMock: { db, closeDb: () => {}, reinitialize: () => {}, canAccessTrip: () => null, isOwner: () => false },
  };
});

vi.mock('../../../src/db/database', () => dbMock);

import { createTables } from '../../../src/db/schema';
import {
  haversineKm,
  nameSimilarity,
  pickHotelMatch,
  nightsBetween,
  listTripLodging,
  adultsForStay,
  getTripHotelPrices,
  getTravelpayoutsToken,
  clearHotelPriceCache,
} from '../../../src/services/hotelPriceService';

const TOKEN = 'test-token-not-a-real-key';

beforeAll(() => {
  createTables(testDb);
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS hotel_price_cache (
      cache_key    TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      fetched_at   INTEGER NOT NULL
    )
  `);
});

beforeEach(() => {
  testDb.exec('DELETE FROM hotel_price_cache; DELETE FROM day_accommodations; DELETE FROM days; DELETE FROM places; DELETE FROM categories; DELETE FROM trips; DELETE FROM users;');
  testDb.prepare("INSERT INTO users (id, username, email, password_hash, birth_date) VALUES (1, 'igor', 'i@test.com', 'x', '1985-04-02')").run();
  testDb.prepare("INSERT INTO trips (id, user_id, title, currency) VALUES (1, 1, 'YOLO', 'EUR')").run();
  testDb.prepare("INSERT INTO categories (id, name, icon, user_id) VALUES (1, 'Hotel', 'BedDouble', 1)").run();
  const insertDay = testDb.prepare('INSERT INTO days (id, trip_id, day_number, date, title) VALUES (?, 1, ?, ?, ?)');
  insertDay.run(1, 1, '2027-03-01', '🇯🇵 Tokyo');
  insertDay.run(2, 2, '2027-03-04', '🇯🇵 Tokyo');
  process.env.TRAVELPAYOUTS_TOKEN = TOKEN;
});

afterEach(() => {
  delete process.env.TRAVELPAYOUTS_TOKEN;
  vi.restoreAllMocks();
});

function addLodging(placeId: number, name: string, lat: number, lng: number, categoryId: number | null = 1) {
  testDb
    .prepare('INSERT INTO places (id, trip_id, name, lat, lng, category_id) VALUES (?, 1, ?, ?, ?, ?)')
    .run(placeId, name, lat, lng, categoryId);
  testDb
    .prepare('INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id) VALUES (1, ?, 1, 2)')
    .run(placeId);
}

/** Stubs the two Hotellook endpoints; `quote` of null means "no price cached". */
function stubHotellook(hotels: unknown[], quote: unknown | null) {
  return vi.spyOn(globalThis, 'fetch' as never).mockImplementation((async (url: string) => ({
    ok: true,
    json: async () => (String(url).includes('lookup.json') ? { results: { hotels } } : quote ? [quote] : []),
  })) as never);
}

// ── Geometry and name agreement ────────────────────────────────────────────

describe('matching', () => {
  it('HOTEL-PRICE-001 — measures real distances between coordinates', () => {
    // Tokyo Station to Shinjuku Station is about 6 km.
    const km = haversineKm(35.6812, 139.7671, 35.6896, 139.7006);
    expect(km).toBeGreaterThan(5);
    expect(km).toBeLessThan(7);
    expect(haversineKm(35.68, 139.76, 35.68, 139.76)).toBe(0);
  });

  it('HOTEL-PRICE-002 — reads through case, accents and lodging noise words', () => {
    expect(nameSimilarity('Hôtel du Palais', 'Hotel Du Palais Biarritz')).toBe(1);
    expect(nameSimilarity('Sakura Hostel Asakusa', 'Sakura Asakusa')).toBe(1);
    // Two different buildings must not read as one just because both say "Hotel".
    expect(nameSimilarity('Hotel Gracery', 'Hotel Sunroute')).toBe(0);
  });

  it('HOTEL-PRICE-003 — refuses a nearby hotel whose name disagrees', () => {
    const match = pickHotelMatch(
      { name: 'Hotel Gracery Shinjuku', lat: 35.6955, lng: 139.7006 },
      [{ id: 1, fullName: 'Shinjuku Granbell Hotel', location: { lat: 35.6956, lon: 139.7007 } }],
    );
    expect(match).toBeNull();
  });

  it('HOTEL-PRICE-004 — refuses a same-named hotel in another city', () => {
    const match = pickHotelMatch(
      { name: 'Hotel Gracery Shinjuku', lat: 35.6955, lng: 139.7006 },
      [{ id: 2, fullName: 'Hotel Gracery Shinjuku', location: { lat: 34.6937, lon: 135.5023 } }],
    );
    expect(match).toBeNull();
  });

  it('HOTEL-PRICE-005 — accepts the listing that agrees on both', () => {
    const match = pickHotelMatch(
      { name: 'Hotel Gracery Shinjuku', lat: 35.6955, lng: 139.7006 },
      [
        { id: 1, fullName: 'Shinjuku Granbell Hotel', location: { lat: 35.6956, lon: 139.7007 } },
        { id: 2, fullName: 'Hotel Gracery Shinjuku, Tokyo', location: { lat: 35.6954, lon: 139.7005 } },
      ],
    );
    expect(match?.id).toBe(2);
  });

  it('HOTEL-PRICE-006 — ignores a candidate with no coordinates', () => {
    const match = pickHotelMatch({ name: 'Hotel Gracery', lat: 35.6955, lng: 139.7006 }, [
      { id: 3, fullName: 'Hotel Gracery' },
    ]);
    expect(match).toBeNull();
  });
});

// ── What gets quoted ───────────────────────────────────────────────────────

describe('listTripLodging', () => {
  it('HOTEL-PRICE-007 — counts the nights actually booked', () => {
    expect(nightsBetween('2027-03-01', '2027-03-04')).toBe(3);
    // Never zero: a same-day range would otherwise divide a total by nothing.
    expect(nightsBetween('2027-03-01', '2027-03-01')).toBe(1);
  });

  it('HOTEL-PRICE-008 — takes lodging with coordinates and a stay, and nothing else', () => {
    addLodging(10, 'Hotel Gracery Shinjuku', 35.6955, 139.7006);
    // A restaurant, correctly ignored: not a lodging category.
    testDb.prepare("INSERT INTO categories (id, name, icon, user_id) VALUES (2, 'Food', 'Utensils', 1)").run();
    addLodging(11, 'Ichiran Ramen', 35.69, 139.70, 2);
    // A hotel someone saved but never booked into: no stay, so nothing to quote.
    testDb.prepare("INSERT INTO places (id, trip_id, name, lat, lng, category_id) VALUES (12, 1, 'Park Hyatt', 35.6852, 139.6907, 1)").run();
    // A hotel with no coordinates cannot be matched geographically.
    testDb.prepare("INSERT INTO places (id, trip_id, name, category_id) VALUES (13, 1, 'Unknown Inn', 1)").run();
    testDb.prepare('INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id) VALUES (1, 13, 1, 2)').run();

    const rows = listTripLodging(1);
    expect(rows.map((r) => r.place_id)).toEqual([10]);
    expect(rows[0].check_in).toBe('2027-03-01');
    expect(rows[0].check_out).toBe('2027-03-04');
  });

  it('HOTEL-PRICE-009 — quotes a hotel booked twice only once', () => {
    addLodging(10, 'Hotel Gracery Shinjuku', 35.6955, 139.7006);
    testDb.prepare('INSERT INTO day_accommodations (trip_id, place_id, start_day_id, end_day_id) VALUES (1, 10, 1, 2)').run();
    expect(listTripLodging(1)).toHaveLength(1);
  });
});

describe('adultsForStay', () => {
  it('HOTEL-PRICE-010 — leaves an under-two out of the occupant count', () => {
    testDb.prepare("INSERT INTO users (id, username, email, password_hash, birth_date) VALUES (2, 'brune', 'b@test.com', 'x', '1988-06-11')").run();
    testDb.prepare("INSERT INTO users (id, username, email, password_hash, birth_date) VALUES (3, 'bebe', 'x@test.com', 'x', '2026-09-18')").run();
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id) VALUES (1, 2)').run();
    testDb.prepare('INSERT INTO trip_members (trip_id, user_id) VALUES (1, 3)').run();
    // March 2027: the baby is five months old — a cot, not an occupant.
    expect(adultsForStay(1, 1, '2027-03-01')).toBe(2);
    // By 2029 the same child is a toddler and counts.
    expect(adultsForStay(1, 1, '2029-03-01')).toBe(3);
  });
});

// ── End to end ─────────────────────────────────────────────────────────────

describe('getTripHotelPrices', () => {
  it('HOTEL-PRICE-011 — quotes a matched hotel per night and caches the answer', async () => {
    addLodging(10, 'Hotel Gracery Shinjuku', 35.6955, 139.7006);
    const spy = stubHotellook(
      [{ id: 99, fullName: 'Hotel Gracery Shinjuku', location: { lat: 35.6955, lon: 139.7006 } }],
      { hotelId: 99, hotelName: 'Hotel Gracery Shinjuku', stars: 4, priceFrom: 300 },
    );

    const first = await getTripHotelPrices(1, 1, 'EUR');
    expect(first.configured).toBe(true);
    expect(first.prices).toHaveLength(1);
    // 300 for three nights — the pill shows the nightly figure, not the total.
    expect(first.prices[0]).toMatchObject({ place_id: 10, price_from: 300, price_per_night: 100, nights: 3, currency: 'EUR' });

    const callsAfterFirst = spy.mock.calls.length;
    const second = await getTripHotelPrices(1, 1, 'EUR');
    expect(second.prices).toEqual(first.prices);
    // Served from SQLite: the affiliate API is not asked twice for one stay.
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });

  it('HOTEL-PRICE-012 — stays silent when there is no token, no match or no quote', async () => {
    addLodging(10, 'Hotel Gracery Shinjuku', 35.6955, 139.7006);

    delete process.env.TRAVELPAYOUTS_TOKEN;
    expect(getTravelpayoutsToken()).toBeNull();
    const unconfigured = await getTripHotelPrices(1, 1, 'EUR');
    expect(unconfigured).toEqual({ prices: [], configured: false });

    process.env.TRAVELPAYOUTS_TOKEN = TOKEN;
    clearHotelPriceCache();
    // Right area, wrong hotel: no price rather than the neighbour's price.
    stubHotellook([{ id: 1, fullName: 'Shinjuku Granbell Hotel', location: { lat: 35.6956, lon: 139.7007 } }], null);
    expect((await getTripHotelPrices(1, 1, 'EUR')).prices).toEqual([]);

    clearHotelPriceCache();
    // Matched, but Hotellook has nothing cached for those dates.
    stubHotellook([{ id: 99, fullName: 'Hotel Gracery Shinjuku', location: { lat: 35.6955, lon: 139.7006 } }], null);
    expect((await getTripHotelPrices(1, 1, 'EUR')).prices).toEqual([]);

    clearHotelPriceCache();
    // The far end is down entirely.
    vi.spyOn(globalThis, 'fetch' as never).mockRejectedValue(new Error('network') as never);
    const offline = await getTripHotelPrices(1, 1, 'EUR');
    expect(offline).toEqual({ prices: [], configured: true });
  });
});
