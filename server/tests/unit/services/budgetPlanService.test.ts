/**
 * The daily-budget generator — BUDGET-PLAN-001 through 010.
 *
 * Runs against a real in-memory SQLite: the point of this service is the SQL
 * (what it writes, and above all what it refuses to delete), so stubbing the
 * database away would test nothing worth testing.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

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
import { generateDailyPlan, clearDailyPlan, planDailyItems } from '../../../src/services/budgetPlanService';

// Two legs in two countries: a week in Turkey, then a week in Japan. The flag in
// a day title is the traveller's own statement of where the day is, which is
// what the country attribution trusts first.
const DAYS: [string, string][] = [
  ['2026-12-27', '🇹🇷 Istanbul — arrivée'],
  ['2026-12-28', '🇹🇷 Istanbul — Sultanahmet'],
  ['2026-12-29', '🇯🇵 Tokyo — arrivée à Narita'],
  ['2026-12-30', '🇯🇵 Tokyo — Asakusa'],
];

beforeAll(() => {
  createTables(testDb);
  // These columns reach real databases through migrations rather than the base
  // DDL, so a freshly created schema does not have them yet.
  testDb.exec('ALTER TABLE budget_items ADD COLUMN expense_date TEXT');
  testDb.exec('ALTER TABLE budget_items ADD COLUMN reservation_id INTEGER');
  testDb.exec('CREATE TABLE IF NOT EXISTS place_regions (place_id INTEGER PRIMARY KEY, country_code TEXT, region_code TEXT, city TEXT)');
});

beforeEach(() => {
  testDb.exec('DELETE FROM budget_items; DELETE FROM day_assignments; DELETE FROM days; DELETE FROM places; DELETE FROM trips; DELETE FROM users;');
  testDb.prepare("INSERT INTO users (id, username, email, password_hash) VALUES (1, 'igor', 'i@test.com', 'x')").run();
  testDb
    .prepare("INSERT INTO trips (id, user_id, title, currency) VALUES (1, 1, 'YOLO', 'EUR')")
    .run();
  const insertDay = testDb.prepare('INSERT INTO days (id, trip_id, day_number, date, title) VALUES (?, 1, ?, ?, ?)');
  DAYS.forEach(([date, title], i) => insertDay.run(i + 1, i + 1, date, title));
});

function generated() {
  return testDb
    .prepare("SELECT category, name, total_price, expense_date, plan_key FROM budget_items WHERE plan_key LIKE 'daily:%' ORDER BY expense_date, plan_key")
    .all() as { category: string; name: string; total_price: number; expense_date: string; plan_key: string }[];
}

describe('generateDailyPlan', () => {
  it('BUDGET-PLAN-001 — writes three meals and two transport legs for every day', () => {
    generateDailyPlan(1);
    const rows = generated();
    const firstDay = rows.filter((r) => r.expense_date === '2026-12-27');
    expect(firstDay.map((r) => r.plan_key).sort()).toEqual([
      'daily:2026-12-27:breakfast',
      'daily:2026-12-27:dinner',
      'daily:2026-12-27:lunch',
      'daily:2026-12-27:transport:back',
      'daily:2026-12-27:transport:out',
    ]);
    // Both legs are listed separately: that is how the day is actually spent.
    expect(firstDay.filter((r) => r.category === 'transport')).toHaveLength(2);
  });

  it('BUDGET-PLAN-002 — costs each day at the rate of the country it is spent in', () => {
    generateDailyPlan(1);
    const rows = generated();
    const turkishLunch = rows.find((r) => r.plan_key === 'daily:2026-12-27:lunch');
    const japaneseLunch = rows.find((r) => r.plan_key === 'daily:2026-12-29:lunch');
    expect(turkishLunch?.total_price).toBe(12);
    expect(japaneseLunch?.total_price).toBe(16);
    expect(japaneseLunch?.name).toContain('JP');
  });

  it('BUDGET-PLAN-003 — charges activities only on days that have places assigned', () => {
    testDb.prepare("INSERT INTO places (id, trip_id, name) VALUES (10, 1, 'Senso-ji'), (11, 1, 'Skytree')").run();
    testDb.prepare('INSERT INTO day_assignments (day_id, place_id, order_index) VALUES (4, 10, 0), (4, 11, 1)').run();
    generateDailyPlan(1);
    const rows = generated();
    // Two places on 12-30 at the Japanese rate of 8; nothing on the empty days.
    expect(rows.find((r) => r.plan_key === 'daily:2026-12-30:activities')?.total_price).toBe(16);
    expect(rows.find((r) => r.plan_key === 'daily:2026-12-27:activities')).toBeUndefined();
  });

  it('BUDGET-PLAN-004 — a per-country override replaces only the fields it names', () => {
    generateDailyPlan(1, { rates: { JP: { dinner: 12 } } });
    const rows = generated();
    expect(rows.find((r) => r.plan_key === 'daily:2026-12-29:dinner')?.total_price).toBe(12);
    // Japanese lunch keeps its default rather than falling back to the "*" one.
    expect(rows.find((r) => r.plan_key === 'daily:2026-12-29:lunch')?.total_price).toBe(16);
  });

  it('BUDGET-PLAN-005 — a rate of zero drops the line instead of writing a free one', () => {
    generateDailyPlan(1, { rates: { JP: { breakfast: 0 } } });
    const rows = generated();
    expect(rows.find((r) => r.plan_key === 'daily:2026-12-29:breakfast')).toBeUndefined();
    expect(rows.find((r) => r.plan_key === 'daily:2026-12-27:breakfast')).toBeDefined();
  });

  it('BUDGET-PLAN-006 — regenerating replaces its own output rather than doubling it', () => {
    generateDailyPlan(1);
    const before = generated().length;
    const second = generateDailyPlan(1, { rates: { '*': { lunch: 99 } } });
    expect(generated().length).toBe(before);
    expect(second.replaced).toBe(before);
  });

  it('BUDGET-PLAN-007 — never touches an expense entered by hand', () => {
    testDb
      .prepare("INSERT INTO budget_items (trip_id, category, name, total_price, expense_date) VALUES (1, 'flights', 'Paris → Istanbul', 330, '2026-12-27')")
      .run();
    generateDailyPlan(1);
    generateDailyPlan(1);
    clearDailyPlan(1);
    const survivors = testDb.prepare('SELECT name FROM budget_items').all() as { name: string }[];
    expect(survivors).toEqual([{ name: 'Paris → Istanbul' }]);
  });

  it('BUDGET-PLAN-008 — a dry run reports per-country totals and writes nothing', () => {
    const result = generateDailyPlan(1, { dryRun: true });
    expect(generated()).toHaveLength(0);
    expect(result.dry_run).toBe(true);
    expect(result.countries.map((c) => c.code).sort()).toEqual(['JP', 'TR']);
    // Japan: (6+16+22 + 4+4) × 2 days = 104. Turkey: (5+12+16 + 3+3) × 2 = 78.
    expect(result.countries.find((c) => c.code === 'JP')?.total).toBe(104);
    expect(result.countries.find((c) => c.code === 'TR')?.total).toBe(78);
    expect(result.total).toBe(182);
  });

  it('BUDGET-PLAN-010 — skips a day that carries no date, which could not hold an expense', () => {
    testDb.prepare('INSERT INTO days (id, trip_id, day_number, date, title) VALUES (99, 1, 99, NULL, ?)').run('🇯🇵 jour flottant');
    const items = planDailyItems(1);
    expect(items.every((i) => !!i.expense_date)).toBe(true);
  });
});
