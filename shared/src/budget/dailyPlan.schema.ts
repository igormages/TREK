import { z } from 'zod';

/**
 * Daily living costs, generated from the itinerary.
 *
 * A trip's budget usually holds only the big, bookable things — flights,
 * accommodation, visas. The day-to-day (three meals, getting across town,
 * entrance fees) is what actually fills the calendar, and on a long trip it
 * rivals everything else put together. Nobody enters it by hand: 176 days is
 * ~900 lines.
 *
 * So the SERVER expands it. The caller sends a rate per country, not the lines
 * themselves — the itinerary (which day is in which country, which places are
 * assigned to it) is already in the database, and shipping 900 objects over the
 * wire to describe something it can derive is pure waste.
 *
 * Every generated row carries a `plan_key`, so a regeneration replaces its own
 * previous output and never touches a line entered by hand.
 */

/** Amounts are for the WHOLE party, in the trip's currency — that is what gets read. */
export const dailyRatesSchema = z.object({
  /** A quick local breakfast — a market stall or a konbini, not a hotel buffet. */
  breakfast: z.number().min(0).optional(),
  lunch: z.number().min(0).optional(),
  dinner: z.number().min(0).optional(),
  /** One leg of local transport. Charged twice a day: there, and back. */
  transport_leg: z.number().min(0).optional(),
  /** Per place assigned to the day — the itinerary already lists the visits. */
  activity: z.number().min(0).optional(),
});
export type DailyRates = z.infer<typeof dailyRatesSchema>;

export const budgetDailyPlanRequestSchema = z.object({
  /**
   * Rates keyed by ISO 3166-1 alpha-2, plus `*` for countries not listed.
   * Omitted entirely = the built-in table below.
   */
  rates: z.record(z.string(), dailyRatesSchema).optional(),
  /** Compute and return the breakdown without writing anything. */
  dry_run: z.boolean().optional(),
});
export type BudgetDailyPlanRequest = z.infer<typeof budgetDailyPlanRequestSchema>;

export const budgetDailyPlanResponseSchema = z.object({
  created: z.number(),
  replaced: z.number(),
  total: z.number(),
  /** One row per country: days covered and what was generated for them. */
  countries: z.array(
    z.object({
      code: z.string(),
      days: z.number(),
      total: z.number(),
    }),
  ),
  dry_run: z.boolean(),
});
export type BudgetDailyPlanResponse = z.infer<typeof budgetDailyPlanResponseSchema>;

/**
 * Default rates, in EUR, for a party of two adults eating where locals eat —
 * markets, street food, neighbourhood canteens — rather than at the addresses
 * with an English menu out front. Local transport assumes public transport with
 * a ride-hail when a pushchair makes that easier.
 *
 * These are starting points, not truth: the caller overrides any of them.
 */
export const DEFAULT_DAILY_RATES: Record<string, DailyRates> = {
  // ── South and Southeast Asia ──
  TH: { breakfast: 3, lunch: 7, dinner: 10, transport_leg: 3, activity: 6 },
  VN: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 5 },
  KH: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 6 },
  LA: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 5 },
  MM: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 5 },
  ID: { breakfast: 3, lunch: 6, dinner: 10, transport_leg: 3, activity: 6 },
  MY: { breakfast: 3, lunch: 7, dinner: 10, transport_leg: 3, activity: 6 },
  PH: { breakfast: 3, lunch: 7, dinner: 10, transport_leg: 3, activity: 6 },
  IN: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 5 },
  LK: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 5 },
  NP: { breakfast: 3, lunch: 6, dinner: 9, transport_leg: 3, activity: 5 },
  SG: { breakfast: 6, lunch: 12, dinner: 16, transport_leg: 3, activity: 10 },

  // ── East Asia ──
  // Japan is cheap to eat in if you eat Japanese: a teishoku or a bowl of ramen
  // costs less than a mediocre bistro lunch in Paris.
  JP: { breakfast: 6, lunch: 16, dinner: 22, transport_leg: 4, activity: 8 },
  KR: { breakfast: 5, lunch: 13, dinner: 18, transport_leg: 3, activity: 7 },
  TW: { breakfast: 4, lunch: 10, dinner: 14, transport_leg: 3, activity: 7 },
  CN: { breakfast: 4, lunch: 10, dinner: 14, transport_leg: 3, activity: 8 },

  // ── Europe, Middle East ──
  TR: { breakfast: 5, lunch: 12, dinner: 16, transport_leg: 3, activity: 8 },
  GE: { breakfast: 4, lunch: 10, dinner: 14, transport_leg: 3, activity: 6 },
  FR: { breakfast: 6, lunch: 20, dinner: 28, transport_leg: 4, activity: 14 },

  // ── Americas, Oceania ──
  MX: { breakfast: 4, lunch: 10, dinner: 14, transport_leg: 3, activity: 8 },
  US: { breakfast: 8, lunch: 20, dinner: 30, transport_leg: 5, activity: 15 },
  AU: { breakfast: 8, lunch: 20, dinner: 28, transport_leg: 5, activity: 12 },
  NZ: { breakfast: 8, lunch: 18, dinner: 26, transport_leg: 5, activity: 12 },

  // Anything not listed — a mid-range guess rather than nothing at all.
  '*': { breakfast: 5, lunch: 10, dinner: 14, transport_leg: 3, activity: 8 },
};
