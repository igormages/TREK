import { db } from '../db/database';
import { DEFAULT_DAILY_RATES, type DailyRates, type BudgetDailyPlanResponse } from '@trek/shared';
import { getTripDayCountries } from './budgetCountryService';

/**
 * Generates a trip's day-to-day spending from its itinerary.
 *
 * The budget of a long trip is usually all flights and hotels: the meals, the
 * bus across town and the temple entrance never get entered, because 176 days
 * is some nine hundred lines. Yet on a six-month trip that day-to-day rivals
 * everything else put together, so a budget without it is not merely incomplete
 * — it is wrong by roughly half.
 *
 * What the caller supplies is a RATE PER COUNTRY. Everything else is already in
 * the database: which day falls in which country (budgetCountryService, the same
 * attribution the charts read) and which places are assigned to it.
 *
 * Regeneration is the normal case — rates get corrected once the traveller sees
 * the total. Each generated row therefore carries a `plan_key`, and a run wipes
 * only rows whose key it owns. Hand-entered expenses are never touched.
 */

/** Categories from shared's COST_CATEGORIES — the fixed Costs buckets. */
const MEAL_CATEGORY = 'food';
const TRANSPORT_CATEGORY = 'transport';
const ACTIVITY_CATEGORY = 'activities';

const PLAN_PREFIX = 'daily:';

interface PlannedItem {
  plan_key: string;
  category: string;
  name: string;
  total_price: number;
  expense_date: string;
  country: string;
}

export interface GenerateDailyPlanOptions {
  rates?: Record<string, DailyRates>;
  dryRun?: boolean;
}

function ratesFor(
  code: string | null,
  overrides: Record<string, DailyRates> | undefined,
): DailyRates {
  const table = { ...DEFAULT_DAILY_RATES, ...(overrides || {}) };
  const fallback = table['*'] || DEFAULT_DAILY_RATES['*'];
  if (!code) return fallback;
  // A per-country override replaces that country's defaults field by field, so
  // setting only `dinner` for Japan keeps the rest of the Japanese rates.
  return { ...(DEFAULT_DAILY_RATES[code] || fallback), ...(overrides?.[code] || {}) };
}

/**
 * Builds the lines without writing them. Exported for the dry run and for tests:
 * the interesting logic is here, and the write below is a loop.
 */
export function planDailyItems(
  tripId: string | number,
  options: GenerateDailyPlanOptions = {},
): PlannedItem[] {
  // The same per-day attribution the country charts read, so a day is costed at
  // the rate of the country those charts say it is spent in. Read directly
  // rather than through the expense breakdown: a day with no expense yet — which
  // is every day this service exists to fill — has no entry there.
  const days = getTripDayCountries(tripId);

  const placeCounts = db
    .prepare(
      `SELECT da.day_id AS day_id, COUNT(*) AS places
         FROM day_assignments da
         JOIN days d ON d.id = da.day_id
        WHERE d.trip_id = ?
        GROUP BY da.day_id`,
    )
    .all(tripId) as { day_id: number; places: number }[];
  const placesByDay = new Map(placeCounts.map((r) => [r.day_id, r.places]));

  const items: PlannedItem[] = [];
  days.forEach((day) => {
    const date = day.date;
    if (!date) return; // A day with no date cannot carry a dated expense.
    const rates = ratesFor(day.country_code, options.rates);
    const label = day.country_code || '??';

    const meals: [string, number | undefined][] = [
      ['breakfast', rates.breakfast],
      ['lunch', rates.lunch],
      ['dinner', rates.dinner],
    ];
    for (const [slot, price] of meals) {
      if (!price) continue;
      items.push({
        plan_key: `${PLAN_PREFIX}${date}:${slot}`,
        category: MEAL_CATEGORY,
        name: `${label} — ${slot}`,
        total_price: price,
        expense_date: date,
        country: label,
      });
    }

    // Two legs, there and back — listed separately because that is how the day
    // is actually spent, and because one of them is often replaced by a walk.
    if (rates.transport_leg) {
      for (const leg of ['out', 'back'] as const) {
        items.push({
          plan_key: `${PLAN_PREFIX}${date}:transport:${leg}`,
          category: TRANSPORT_CATEGORY,
          name: `${label} — local transport (${leg})`,
          total_price: rates.transport_leg,
          expense_date: date,
          country: label,
        });
      }
    }

    // One line per place already on the itinerary: the visits are planned, so
    // there is no reason for them to be free.
    const places = placesByDay.get(day.day_id) || 0;
    if (rates.activity && places > 0) {
      items.push({
        plan_key: `${PLAN_PREFIX}${date}:activities`,
        category: ACTIVITY_CATEGORY,
        name: `${label} — activities (${places})`,
        total_price: rates.activity * places,
        expense_date: date,
        country: label,
      });
    }
  });

  return items;
}

export function generateDailyPlan(
  tripId: string | number,
  options: GenerateDailyPlanOptions = {},
): BudgetDailyPlanResponse {
  const items = planDailyItems(tripId, options);

  const perCountry = new Map<string, { days: Set<string>; total: number }>();
  for (const item of items) {
    let entry = perCountry.get(item.country);
    if (!entry) {
      entry = { days: new Set(), total: 0 };
      perCountry.set(item.country, entry);
    }
    entry.days.add(item.expense_date);
    entry.total += item.total_price;
  }
  const countries = Array.from(perCountry.entries())
    .map(([code, e]) => ({ code, days: e.days.size, total: Math.round(e.total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.code.localeCompare(b.code));
  const total = Math.round(items.reduce((a, i) => a + i.total_price, 0) * 100) / 100;

  const existing = (
    db
      .prepare("SELECT COUNT(*) AS n FROM budget_items WHERE trip_id = ? AND plan_key LIKE 'daily:%'")
      .get(tripId) as { n: number }
  ).n;

  if (options.dryRun) {
    return { created: 0, replaced: existing, total, countries, dry_run: true };
  }

  const write = db.transaction(() => {
    db.prepare("DELETE FROM budget_items WHERE trip_id = ? AND plan_key LIKE 'daily:%'").run(tripId);
    const insert = db.prepare(
      `INSERT INTO budget_items (trip_id, category, name, total_price, expense_date, plan_key)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    for (const item of items) {
      insert.run(tripId, item.category, item.name, item.total_price, item.expense_date, item.plan_key);
    }
  });
  write();

  return { created: items.length, replaced: existing, total, countries, dry_run: false };
}

/** Removes every generated line, leaving hand-entered expenses untouched. */
export function clearDailyPlan(tripId: string | number): { removed: number } {
  const result = db
    .prepare("DELETE FROM budget_items WHERE trip_id = ? AND plan_key LIKE 'daily:%'")
    .run(tripId);
  return { removed: result.changes };
}
