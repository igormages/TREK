/**
 * Traveller ages — who counts as an adult when querying an accommodation API.
 *
 * Hotel search APIs price a room by the number of ADULTS, and treat an infant
 * sleeping in a cot as free rather than as an occupant. Sending "3 guests" for
 * two parents and a baby prices a triple room that nobody needs — and on many
 * properties returns no availability at all.
 *
 * A member's `birth_date` is the only thing that lets us tell the difference,
 * so it is optional everywhere and its absence means "assume adult": that is
 * what the app did before birth dates existed, and it never under-books.
 */

/** Below this age a traveller sleeps in a cot and is not an occupant. */
export const INFANT_MAX_AGE = 2;

/** Splits `YYYY-MM-DD` into its three numbers, or null if it isn't a real date. */
function parseDate(value: string | null | undefined): [number, number, number] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip through UTC so 2027-02-30 (which Date happily rolls over) fails.
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? [year, month, day] : null;
}

/** `YYYY-MM-DD`, and a real calendar date (rejects 2027-02-30). */
export function isValidBirthDate(value: string): boolean {
  return parseDate(value) !== null;
}

/**
 * Whole years elapsed between two `YYYY-MM-DD` dates, or null if either is
 * unusable. Compared as calendar fields — no timezone can shift a birthday.
 */
export function ageOn(birthDate: string | null | undefined, onDate: string): number | null {
  const born = parseDate(birthDate);
  const on = parseDate(onDate);
  if (!born || !on) return null;
  const [by, bm, bd] = born;
  const [oy, om, od] = on;
  let age = oy - by;
  // The birthday hasn't come round yet this year.
  if (om < bm || (om === bm && od < bd)) age -= 1;
  return age;
}

export interface TravelerLike {
  birth_date?: string | null;
}

export interface TravelerCounts {
  /** Occupants to price a room for. */
  adults: number;
  /** Under-twos, excluded from the search entirely (cot, not a bed). */
  infants: number;
}

/**
 * Splits trip members into what an accommodation search should ask for.
 *
 * `onDate` is the stay's check-in day, not today: a baby born in September 2026
 * is an infant for a March 2027 stay and a toddler for a March 2029 one, and
 * the search has to reflect the trip, not the moment the page is opened.
 *
 * A member with no birth date — or an unparseable one — counts as an adult.
 */
export function countTravelers(members: TravelerLike[], onDate: string): TravelerCounts {
  let infants = 0;
  for (const member of members) {
    const age = ageOn(member.birth_date, onDate);
    if (age !== null && age < INFANT_MAX_AGE) infants += 1;
  }
  return { adults: members.length - infants, infants };
}
