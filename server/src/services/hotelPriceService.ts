import { db } from '../db/database';
import { decrypt_api_key } from './apiKeyCrypto';
import {
  countTravelers,
  isLodgingCategory,
  HOTEL_MATCH_MAX_KM,
  HOTEL_MATCH_MIN_NAME_SCORE,
  type HotelPrice,
  type TripHotelPricesResponse,
} from '@trek/shared';

/**
 * Nightly rates for a trip's lodging, from Hotellook (Travelpayouts).
 *
 * The map already draws a Booking-style pill as soon as it is handed a price;
 * this is where the price comes from. Two calls per property: `lookup.json`
 * turns the name we hold into Hotellook's own hotel id, `cache.json` quotes
 * that id for the nights the itinerary actually books.
 *
 * Everything here degrades to silence. No token, no match, a timeout, a 500
 * from the far end — each returns nothing and the marker stays the circle it
 * was. A travel map that breaks because an affiliate API is down is a worse
 * map than one that occasionally shows no price.
 */

const LOOKUP_URL = 'https://engine.hotellook.com/api/v2/lookup.json';
const CACHE_URL = 'https://engine.hotellook.com/api/v2/cache.json';
const USER_AGENT = 'Trek-Hotels/1.0 (+https://github.com/liketrek/TREK)';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * Quotes are cached for a day. They are cached quotes at the far end too, so
 * refetching sooner buys staleness of a different flavour rather than freshness
 * — and the trip that needs this is five months out.
 */
const PRICE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * At most this many properties are priced in one request, and they are fetched
 * a few at a time. A six-month itinerary can hold dozens of hotels; firing all
 * of them at an affiliate API at once is how a marker key gets rate-limited.
 */
const MAX_PROPERTIES_PER_TRIP = 60;
const FETCH_CONCURRENCY = 4;

interface LodgingRow {
  place_id: number;
  name: string;
  lat: number;
  lng: number;
  category_icon: string | null;
  category_name: string | null;
  check_in: string;
  check_out: string;
}

interface HotellookHotel {
  id: number;
  fullName?: string;
  label?: string;
  location?: { lat?: number; lon?: number };
}

interface HotellookPrice {
  hotelId?: number;
  hotelName?: string;
  stars?: number;
  priceFrom?: number;
  priceAvg?: number;
}

// ── Settings ───────────────────────────────────────────────────────────────

function setting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value || null;
}

/**
 * The affiliate token. An env var wins over the admin setting, matching how
 * every other credential in TREK resolves, so a container can be configured
 * without touching the database.
 */
export function getTravelpayoutsToken(): string | null {
  const fromEnv = process.env.TRAVELPAYOUTS_TOKEN;
  if (fromEnv) return fromEnv;
  return decrypt_api_key(setting('travelpayouts_token'));
}

export function isHotelPricingConfigured(): boolean {
  return !!getTravelpayoutsToken();
}

// ── Matching ───────────────────────────────────────────────────────────────

/** Great-circle distance in kilometres. */
export function haversineKm(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Strips case, accents and the noise words that differ between two listings of
 * the same building ("Hotel", "Ryokan", "&"), so "Hôtel du Palais" and
 * "Hotel Du Palais Biarritz" reduce to comparable token sets.
 */
export function normaliseHotelName(value: string): string[] {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !NAME_STOPWORDS.has(w));
}

const NAME_STOPWORDS = new Set([
  'hotel', 'hostel', 'motel', 'inn', 'resort', 'ryokan', 'guesthouse', 'guest',
  'house', 'apartment', 'apartments', 'apart', 'suites', 'suite', 'residence',
  'the', 'le', 'la', 'les', 'du', 'de', 'des', 'da', 'el', 'and', 'by',
]);

/**
 * How much two names agree, from 0 to 1: the share of the shorter name's words
 * that the longer one also has. Asymmetric on purpose — Hotellook's `fullName`
 * routinely appends a district the itinerary never wrote down, and that extra
 * detail should not be read as disagreement.
 */
export function nameSimilarity(a: string, b: string): number {
  const wordsA = normaliseHotelName(a);
  const wordsB = normaliseHotelName(b);
  if (wordsA.length === 0 || wordsB.length === 0) return 0;
  const [short, long] = wordsA.length <= wordsB.length ? [wordsA, wordsB] : [wordsB, wordsA];
  const longSet = new Set(long);
  const hits = short.filter((w) => longSet.has(w)).length;
  return hits / short.length;
}

/**
 * The Hotellook property that is the place we hold — near enough to be the same
 * building AND named alike. Returns null rather than a best guess: pricing the
 * hotel next door is a worse failure than pricing nothing, because it looks
 * right.
 */
export function pickHotelMatch(
  place: { name: string; lat: number; lng: number },
  candidates: HotellookHotel[],
): HotellookHotel | null {
  let best: { hotel: HotellookHotel; score: number } | null = null;
  for (const hotel of candidates) {
    const lat = hotel.location?.lat;
    const lon = hotel.location?.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') continue;
    const km = haversineKm(place.lat, place.lng, lat, lon);
    if (km > HOTEL_MATCH_MAX_KM) continue;
    const score = nameSimilarity(place.name, hotel.fullName || hotel.label || '');
    if (score < HOTEL_MATCH_MIN_NAME_SCORE) continue;
    // Name agreement decides; distance only breaks a tie, since two listings of
    // one building sit at the same coordinates.
    if (!best || score > best.score) best = { hotel, score };
  }
  return best?.hotel ?? null;
}

// ── Hotellook calls ────────────────────────────────────────────────────────

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function lookupHotels(query: string, token: string, lang: string): Promise<HotellookHotel[]> {
  const url =
    `${LOOKUP_URL}?query=${encodeURIComponent(query)}` +
    `&lang=${encodeURIComponent(lang)}&lookFor=hotel&limit=10&token=${encodeURIComponent(token)}`;
  const body = await getJson<{ results?: { hotels?: HotellookHotel[] } }>(url);
  return body?.results?.hotels ?? [];
}

async function quoteHotel(
  hotelId: number,
  checkIn: string,
  checkOut: string,
  adults: number,
  currency: string,
  token: string,
): Promise<HotellookPrice | null> {
  const url =
    `${CACHE_URL}?hotelId=${hotelId}&checkIn=${checkIn}&checkOut=${checkOut}` +
    `&adults=${adults}&currency=${encodeURIComponent(currency.toLowerCase())}` +
    `&limit=1&token=${encodeURIComponent(token)}`;
  const body = await getJson<HotellookPrice[]>(url);
  if (!Array.isArray(body)) return null;
  return body.find((p) => (p.priceFrom ?? p.priceAvg ?? 0) > 0) ?? null;
}

// ── Persistent cache ───────────────────────────────────────────────────────

function cacheKey(row: LodgingRow, adults: number, currency: string): string {
  return `${row.place_id}:${row.check_in}:${row.check_out}:${adults}:${currency.toUpperCase()}`;
}

function readCache(key: string): HotelPrice | null {
  const row = db
    .prepare('SELECT payload_json, fetched_at FROM hotel_price_cache WHERE cache_key = ?')
    .get(key) as { payload_json: string; fetched_at: number } | undefined;
  if (!row) return null;
  if (Date.now() - row.fetched_at > PRICE_TTL_MS) return null;
  try {
    // An empty payload is a remembered miss: a property Hotellook does not
    // list should not be looked up again on every map pan for a day.
    return row.payload_json === '' ? null : (JSON.parse(row.payload_json) as HotelPrice);
  } catch {
    return null;
  }
}

function hasFreshMiss(key: string): boolean {
  const row = db
    .prepare('SELECT payload_json, fetched_at FROM hotel_price_cache WHERE cache_key = ?')
    .get(key) as { payload_json: string; fetched_at: number } | undefined;
  return !!row && row.payload_json === '' && Date.now() - row.fetched_at <= PRICE_TTL_MS;
}

function writeCache(key: string, price: HotelPrice | null): void {
  try {
    db.prepare(
      'INSERT OR REPLACE INTO hotel_price_cache (cache_key, payload_json, fetched_at) VALUES (?, ?, ?)',
    ).run(key, price ? JSON.stringify(price) : '', Date.now());
  } catch {
    // A cache that cannot be written still serves the request it was asked for.
  }
}

// ── Trip lodging ───────────────────────────────────────────────────────────

/** Nights between two `YYYY-MM-DD` days; at least one, so a quote never divides by zero. */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`);
  const b = Date.parse(`${checkOut}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86400000));
}

/**
 * The lodging worth pricing: a place with coordinates and a stay attached to it.
 *
 * The dates come from `day_accommodations` rather than the trip, because a quote
 * is only meaningful for the nights actually booked — and a lodging place with
 * no stay attached is a candidate someone saved, not somewhere they sleep.
 */
export function listTripLodging(tripId: string | number): LodgingRow[] {
  const rows = db
    .prepare(
      `SELECT p.id AS place_id, p.name AS name, p.lat AS lat, p.lng AS lng,
              c.icon AS category_icon, c.name AS category_name,
              di.date AS check_in, do_.date AS check_out
         FROM day_accommodations a
         JOIN places p ON p.id = a.place_id
         JOIN days di ON di.id = a.start_day_id
         JOIN days do_ ON do_.id = a.end_day_id
         LEFT JOIN categories c ON c.id = p.category_id
        WHERE a.trip_id = ?
          AND p.lat IS NOT NULL AND p.lng IS NOT NULL
          AND di.date IS NOT NULL AND do_.date IS NOT NULL
        ORDER BY di.date ASC`,
    )
    .all(tripId) as LodgingRow[];

  // One stay per place: the same hotel booked twice on a round trip is one
  // property to quote, and the first stay is the one the pill will describe.
  const seen = new Set<number>();
  const unique: LodgingRow[] = [];
  for (const row of rows) {
    if (seen.has(row.place_id)) continue;
    if (!isLodgingCategory(row.category_icon, row.category_name)) continue;
    seen.add(row.place_id);
    unique.push(row);
  }
  return unique.slice(0, MAX_PROPERTIES_PER_TRIP);
}

/**
 * How many occupants to quote for, on the night the stay starts.
 *
 * A baby in a cot is not an occupant: asking for three guests prices a triple
 * room nobody needs and, on many properties, returns no availability at all.
 *
 * Birth dates are read straight from `users` rather than through `listMembers`,
 * which also assembles display names and avatars: this needs none of that, and
 * depending on it would make a hotel quote fail over a column it never reads.
 * The UNION deduplicates an owner who is also listed as a member.
 */
export function adultsForStay(tripId: string | number, tripOwnerId: number, checkIn: string): number {
  const rows = db
    .prepare(
      `SELECT birth_date FROM users WHERE id = ?
       UNION
       SELECT u.birth_date FROM users u
         JOIN trip_members m ON m.user_id = u.id
        WHERE m.trip_id = ? AND u.id != ?`,
    )
    .all(tripOwnerId, tripId, tripOwnerId) as { birth_date: string | null }[];

  // A trip with no roster at all still sleeps somebody: quote for two rather
  // than for nobody, which is what an empty list would ask for.
  if (rows.length === 0) return 2;
  const { adults } = countTravelers(rows, checkIn);
  return Math.max(1, adults);
}

// ── Entry point ────────────────────────────────────────────────────────────

async function priceOne(
  row: LodgingRow,
  adults: number,
  currency: string,
  token: string,
  lang: string,
): Promise<HotelPrice | null> {
  const key = cacheKey(row, adults, currency);
  const cached = readCache(key);
  if (cached) return cached;
  if (hasFreshMiss(key)) return null;

  const candidates = await lookupHotels(row.name, token, lang);
  const match = pickHotelMatch(row, candidates);
  if (!match) {
    writeCache(key, null);
    return null;
  }

  const quote = await quoteHotel(match.id, row.check_in, row.check_out, adults, currency, token);
  const total = quote?.priceFrom ?? quote?.priceAvg ?? 0;
  if (!quote || total <= 0) {
    writeCache(key, null);
    return null;
  }

  const nights = nightsBetween(row.check_in, row.check_out);
  const price: HotelPrice = {
    place_id: row.place_id,
    price_from: Math.round(total * 100) / 100,
    price_per_night: Math.round((total / nights) * 100) / 100,
    currency: currency.toUpperCase(),
    nights,
    hotel_name: quote.hotelName ?? match.fullName ?? null,
    stars: typeof quote.stars === 'number' ? quote.stars : null,
  };
  writeCache(key, price);
  return price;
}

/** Runs `worker` over `items`, at most `limit` at a time. */
async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function getTripHotelPrices(
  tripId: string | number,
  tripOwnerId: number,
  currency: string,
  lang = 'en',
): Promise<TripHotelPricesResponse> {
  const token = getTravelpayoutsToken();
  if (!token) return { prices: [], configured: false };

  const lodging = listTripLodging(tripId);
  if (lodging.length === 0) return { prices: [], configured: true };

  // The occupant count is per stay, not per trip: a baby born mid-journey is an
  // infant for the March nights and an adult-counted toddler two years later.
  const jobs = lodging.map((row) => ({
    row,
    adults: adultsForStay(tripId, tripOwnerId, row.check_in),
  }));
  const priced = await mapWithLimit(jobs, FETCH_CONCURRENCY, (job) =>
    priceOne(job.row, job.adults, currency, token, lang),
  );

  return { prices: priced.filter((p): p is HotelPrice => p !== null), configured: true };
}

/** Drops every cached quote. Used when the token changes, so a bad key's misses do not linger. */
export function clearHotelPriceCache(): void {
  try {
    db.prepare('DELETE FROM hotel_price_cache').run();
  } catch {
    // Nothing to clear if the table is not there yet.
  }
}
