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

export function getTripCountryBreakdown(tripId: string | number): BudgetCountryBreakdown {
  const days = db
    .prepare('SELECT id, date FROM days WHERE trip_id = ? ORDER BY day_number ASC')
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
  const cityByDayId = new Map<number, string>();
  for (const place of assignmentPlaces) {
    if (cityByDayId.has(place.day_id)) continue;
    const city = placeCity.get(place.id);
    if (city) cityByDayId.set(place.day_id, city);
  }

  const rawDayCodes = days.map((d) => dominantCountry(placesByDay.get(d.id) || []));
  const dayCodes = carryForward(rawDayCodes);

  const countryByDayId = new Map<number, string>();
  const countryByDate = new Map<string, string>();
  const cityByDate = new Map<string, string>();
  const daysPerCountry = new Map<string, number>();
  days.forEach((day, i) => {
    const code = dayCodes[i];
    if (!code) return;
    countryByDayId.set(day.id, code);
    const dateKey = toDateKey(day.date);
    if (dateKey) {
      countryByDate.set(dateKey, code);
      const city = cityByDayId.get(day.id);
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
      };
    }
    const reservation = item.reservation_id ? reservationById.get(item.reservation_id) : undefined;
    if (reservation) {
      if (reservation.day_id && countryByDayId.has(reservation.day_id)) {
        return {
          id: item.id,
          country_code: countryByDayId.get(reservation.day_id)!,
          city: cityByDayId.get(reservation.day_id) ?? null,
        };
      }
      // A booking with no day (or a day outside the itinerary) can still carry its
      // own place — an airport, a hotel — which is enough to place the expense.
      if (reservation.place_id && placeCountry.has(reservation.place_id)) {
        return {
          id: item.id,
          country_code: placeCountry.get(reservation.place_id)!,
          city: placeCity.get(reservation.place_id) ?? null,
        };
      }
    }
    return { id: item.id, country_code: null, city: null };
  });

  const countries = Array.from(daysPerCountry.entries())
    .map(([code, dayCount]) => ({ code, days: dayCount }))
    .sort((a, b) => b.days - a.days || a.code.localeCompare(b.code));

  return { items: itemCountries, countries };
}
