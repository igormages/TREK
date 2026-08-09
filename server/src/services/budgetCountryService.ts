import { db } from '../db/database';
import { Place } from '../types';
import { resolvePlaceCountries, ensurePlaceCities } from './atlasService';

/**
 * Per-country breakdown of a trip's expenses.
 *
 * `budget_items` has no country column — an expense only knows its date (or the
 * reservation it came from). The country is therefore DERIVED from the itinerary:
 * expense -> date -> that day's assigned places -> country, resolved with the same
 * point-in-polygon index the Atlas map uses (atlasService.resolvePlaceCountries,
 * which reads the `place_regions` cache first and only then touches the admin-0
 * index). Nothing is written back: this is a pure read model, recomputed per call.
 *
 * Days with no geolocated place (travel days, rest days — 66 of 176 on a long
 * trip) inherit the previous day's country, so a whole leg counts towards the
 * country it is spent in rather than falling into "unassigned".
 */

export interface BudgetItemCountry {
  id: number;
  country_code: string | null;
  /** City of the day the expense falls on; null until that place has been geocoded. */
  city: string | null;
  /**
   * The day the expense was attributed to (YYYY-MM-DD) — its own `expense_date`
   * when it has one, otherwise the day of the reservation it came from. Lets the
   * client group by month without re-deriving that fallback.
   */
  date: string | null;
}

export interface BudgetCountryDays {
  code: string;
  days: number;
}

export interface BudgetCountryBreakdown {
  items: BudgetItemCountry[];
  countries: BudgetCountryDays[];
}

interface DayRow {
  id: number;
  date: string | null;
  title: string | null;
}

interface AssignmentPlaceRow extends Place {
  day_id: number;
}

interface ReservationRow {
  id: number;
  day_id: number | null;
  place_id: number | null;
}

interface BudgetItemRow {
  id: number;
  expense_date: string | null;
  reservation_id: number | null;
}

/** `2027-03-14`, `2027-03-14T09:00:00Z` and `2027-03-14 09:00` all key the same day. */
function toDateKey(value: string | null | undefined): string | null {
  if (!value) return null;
  const key = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/**
 * The country a day is spent in: the most frequent country among the day's
 * geolocated places. Ties keep the first place in itinerary order, so a day that
 * crosses a border is attributed to where it starts.
 */
function dominantCountry(codes: string[]): string | null {
  if (codes.length === 0) return null;
  const counts = new Map<string, number>();
  for (const code of codes) counts.set(code, (counts.get(code) || 0) + 1);
  let best = codes[0];
  for (const code of codes) {
    if (counts.get(code)! > counts.get(best)!) best = code;
  }
  return best;
}

/**
 * Fills the gaps in a date-ordered country list: a day with no geolocated place
 * takes the previous day's country, and leading gaps take the first known one.
 * Returns a copy — the input order is the trip's chronological order.
 */
function carryForward(codes: (string | null)[]): (string | null)[] {
  const out = [...codes];
  let last: string | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i]) last = out[i];
    else out[i] = last;
  }
  // Leading days before the first geolocated place: back-fill from the first known.
  const firstKnown = out.find((c) => c) ?? null;
  for (let i = 0; i < out.length && !out[i]; i++) out[i] = firstKnown;
  return out;
}

/**
 * ISO code from a flag emoji anywhere in a day title ("🇯🇵 Tokyo — …" -> "JP").
 * A flag is a pair of regional-indicator code points, each 0x1F1E6 above 'A'.
 */
export function countryFromTitleFlag(title: string | null | undefined): string | null {
  if (!title) return null;
  const points = [...title].map((c) => c.codePointAt(0) ?? 0);
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
      return String.fromCharCode(a - 0x1f1e6 + 65, b - 0x1f1e6 + 65);
    }
  }
  return null;
}

/**
 * The place name a day title leads with, after its flag and before the first
 * dash: "🇯🇵 Tokyo — arrivée à Narita" -> "Tokyo". Only trusted as a city when
 * the title also carries a flag, so free-form titles never invent one.
 */
export function cityFromTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const withoutFlag = title.replace(/[\u{1F1E6}-\u{1F1FF}]{2}/gu, ' ');
  const head = withoutFlag.split(/[—–\-:(]/)[0];
  // Drop any remaining emoji/pictographs so "Tokyo 🌸" stays "Tokyo". The
  // variation selector is stripped on its own pass: combining it with the
  // pictograph ranges in one character class is a misleading-class lint error.
  const cleaned = head
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\u{FE0F}/gu, '')
    .trim();
  return cleaned.length > 0 && cleaned.length <= 60 ? cleaned : null;
}

/** Where one day of the itinerary is spent, once every rule has been applied. */
export interface DayCountry {
  day_id: number;
  /** YYYY-MM-DD, or null for a day with no date. */
  date: string | null;
  country_code: string | null;
  city: string | null;
}

/**
 * The per-day attribution on its own — the same resolution the expense
 * breakdown is built on (day-title flag first, then the day's geolocated
 * places, then carry-forward over the gaps), without needing a single expense
 * to exist.
 *
 * Anything that reasons about "which country is this day in" reads this, so the
 * charts, the ledger badges and the generated daily budget can never disagree.
 */
export function getTripDayCountries(tripId: string | number): DayCountry[] {
  const days = db
    .prepare('SELECT id, date, title FROM days WHERE trip_id = ? ORDER BY day_number ASC')
    .all(tripId) as DayRow[];

  const assignmentPlaces = db
    .prepare(
      `SELECT p.*, da.day_id AS day_id
         FROM day_assignments da
         JOIN places p ON p.id = da.place_id
         JOIN days d ON d.id = da.day_id
        WHERE d.trip_id = ?
        ORDER BY da.day_id, da.order_index`,
    )
    .all(tripId) as AssignmentPlaceRow[];

  const placeCountry = resolvePlaceCountries(assignmentPlaces);
  const placeCity = ensurePlaceCities(assignmentPlaces);

  const placesByDay = new Map<number, string[]>();
  for (const place of assignmentPlaces) {
    const code = placeCountry.get(place.id);
    if (!code) continue;
    const list = placesByDay.get(place.day_id);
    if (list) list.push(code);
    else placesByDay.set(place.day_id, [code]);
  }

  const cityByPlaces = new Map<number, string>();
  for (const place of assignmentPlaces) {
    if (cityByPlaces.has(place.day_id)) continue;
    const city = placeCity.get(place.id);
    if (city) cityByPlaces.set(place.day_id, city);
  }

  // A day title's flag is the trip author's own statement of where that day is,
  // and it beats everything else: long legs often have days with nothing assigned
  // yet (66 of 176 here), and carrying the previous country across them put Japan
  // days in Laos. Geolocated places only speak for days with no flag.
  const rawDayCodes = days.map(
    (d) => countryFromTitleFlag(d.title) || dominantCountry(placesByDay.get(d.id) || []),
  );
  const dayCodes = carryForward(rawDayCodes);

  return days.map((day, i) => {
    const code = dayCodes[i];
    // Keep the city consistent with where the country came from: a title that
    // says Japan must not be paired with the previous leg's geocoded city.
    const fromTitle = countryFromTitleFlag(day.title) === code ? cityFromTitle(day.title) : null;
    const fromPlaces =
      dominantCountry(placesByDay.get(day.id) || []) === code ? cityByPlaces.get(day.id) : undefined;
    return {
      day_id: day.id,
      date: toDateKey(day.date),
      country_code: code,
      city: code ? fromTitle || fromPlaces || null : null,
    };
  });
}

export function getTripCountryBreakdown(tripId: string | number): BudgetCountryBreakdown {
  const days = db
    .prepare('SELECT id, date, title FROM days WHERE trip_id = ? ORDER BY day_number ASC')
    .all(tripId) as DayRow[];

  const assignmentPlaces = db
    .prepare(
      `SELECT p.*, da.day_id AS day_id
         FROM day_assignments da
         JOIN places p ON p.id = da.place_id
         JOIN days d ON d.id = da.day_id
        WHERE d.trip_id = ?
        ORDER BY da.day_id, da.order_index`,
    )
    .all(tripId) as AssignmentPlaceRow[];

  const reservations = db
    .prepare('SELECT id, day_id, place_id FROM reservations WHERE trip_id = ?')
    .all(tripId) as ReservationRow[];

  const items = db
    .prepare('SELECT id, expense_date, reservation_id FROM budget_items WHERE trip_id = ?')
    .all(tripId) as BudgetItemRow[];

  // Resolve every place referenced by the itinerary in one pass (one shared cache
  // lookup, one shared index build) rather than per day.
  const reservationPlaceIds = reservations.map((r) => r.place_id).filter((id): id is number => !!id);
  const extraPlaces =
    reservationPlaceIds.length > 0
      ? (db
          .prepare(
            `SELECT * FROM places WHERE id IN (${reservationPlaceIds.map(() => '?').join(',')})`,
          )
          .all(...reservationPlaceIds) as Place[])
      : [];
  const placeCountry = resolvePlaceCountries([...assignmentPlaces, ...extraPlaces]);
  const placeCity = ensurePlaceCities([...assignmentPlaces, ...extraPlaces]);

  // day id -> country of that day (before carry-forward)
  const placesByDay = new Map<number, string[]>();
  for (const place of assignmentPlaces) {
    const code = placeCountry.get(place.id);
    if (!code) continue;
    const list = placesByDay.get(place.day_id);
    if (list) list.push(code);
    else placesByDay.set(place.day_id, [code]);
  }

  // City of the day: the first geolocated place with a known city, in itinerary
  // order — the day's starting point, which is where its expenses are incurred.
  const cityByPlaces = new Map<number, string>();
  for (const place of assignmentPlaces) {
    if (cityByPlaces.has(place.day_id)) continue;
    const city = placeCity.get(place.id);
    if (city) cityByPlaces.set(place.day_id, city);
  }

  // A day title's flag is the trip author's own statement of where that day is,
  // and it beats everything else: long legs often have days with nothing assigned
  // yet (66 of 176 here), and carrying the previous country across them put Japan
  // days in Laos. Geolocated places only speak for days with no flag.
  const rawDayCodes = days.map(
    (d) => countryFromTitleFlag(d.title) || dominantCountry(placesByDay.get(d.id) || []),
  );
  const dayCodes = carryForward(rawDayCodes);

  const dateByDayId = new Map<number, string>();
  const countryByDayId = new Map<number, string>();
  const cityByDayId = new Map<number, string>();
  const countryByDate = new Map<string, string>();
  const cityByDate = new Map<string, string>();
  const daysPerCountry = new Map<string, number>();
  days.forEach((day, i) => {
    const code = dayCodes[i];
    const dateKey = toDateKey(day.date);
    if (dateKey) dateByDayId.set(day.id, dateKey);
    if (!code) return;
    countryByDayId.set(day.id, code);

    // Keep the city consistent with where the country came from: a title that
    // says Japan must not be paired with the previous leg's geocoded city.
    const fromTitle = countryFromTitleFlag(day.title) === code ? cityFromTitle(day.title) : null;
    const fromPlaces = dominantCountry(placesByDay.get(day.id) || []) === code ? cityByPlaces.get(day.id) : undefined;
    const city = fromTitle || fromPlaces || null;
    if (city) cityByDayId.set(day.id, city);

    if (dateKey) {
      countryByDate.set(dateKey, code);
      if (city) cityByDate.set(dateKey, city);
    }
    daysPerCountry.set(code, (daysPerCountry.get(code) || 0) + 1);
  });

  const reservationById = new Map(reservations.map((r) => [r.id, r]));

  const itemCountries: BudgetItemCountry[] = items.map((item) => {
    const dateKey = toDateKey(item.expense_date);
    if (dateKey && countryByDate.has(dateKey)) {
      return {
        id: item.id,
        country_code: countryByDate.get(dateKey)!,
        city: cityByDate.get(dateKey) ?? null,
        date: dateKey,
      };
    }
    const reservation = item.reservation_id ? reservationById.get(item.reservation_id) : undefined;
    if (reservation) {
      if (reservation.day_id && countryByDayId.has(reservation.day_id)) {
        return {
          id: item.id,
          country_code: countryByDayId.get(reservation.day_id)!,
          city: cityByDayId.get(reservation.day_id) ?? null,
          date: dateByDayId.get(reservation.day_id) ?? null,
        };
      }
      // A booking with no day (or a day outside the itinerary) can still carry its
      // own place — an airport, a hotel — which is enough to place the expense.
      if (reservation.place_id && placeCountry.has(reservation.place_id)) {
        return {
          id: item.id,
          country_code: placeCountry.get(reservation.place_id)!,
          city: placeCity.get(reservation.place_id) ?? null,
          date: dateKey,
        };
      }
    }
    return { id: item.id, country_code: null, city: null, date: dateKey };
  });

  const countries = Array.from(daysPerCountry.entries())
    .map(([code, dayCount]) => ({ code, days: dayCount }))
    .sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));

  return { items: itemCountries, countries };
}
