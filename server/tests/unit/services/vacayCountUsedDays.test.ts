import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

// ── DB setup (real in-memory SQLite) ─────────────────────────────────────────

const { testDb, dbMock } = vi.hoisted(() => {
  const Database = require('better-sqlite3');
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return { testDb: db, dbMock: { db, closeDb: () => {}, reinitialize: () => {}, canAccessTrip: () => null } };
});

vi.mock('../../../src/db/database', () => dbMock);
vi.mock('../../../src/config', () => ({
  JWT_SECRET: 'test-secret',
  ENCRYPTION_KEY: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2',
  updateJwtSecret: () => {},
}));
vi.mock('../../../src/websocket', () => ({ broadcastToUser: vi.fn() }));

import { createTables } from '../../../src/db/schema';
import { runMigrations } from '../../../src/db/migrations';
import { resetTestDb } from '../../helpers/test-db';
import { createUser } from '../../helpers/factories';
import { countUsedDays, getOwnPlan, getStats } from '../../../src/services/vacayService';

/**
 * Marking a day and spending a leave day are two different things: weekends and
 * company holidays can be marked on the calendar (they show the absence) but must
 * not be deducted from the allowance.
 *
 * 2027-03-01 is a Monday, so 03-06/03-07 are Saturday/Sunday.
 */

let userId: number;
let planId: number;

function mark(date: string) {
  testDb.prepare('INSERT OR IGNORE INTO vacay_entries (user_id, plan_id, date) VALUES (?, ?, ?)').run(userId, planId, date);
}

function companyHoliday(date: string) {
  testDb.prepare('INSERT OR IGNORE INTO vacay_company_holidays (plan_id, date) VALUES (?, ?)').run(planId, date);
}

beforeAll(() => {
  createTables(testDb);
  runMigrations(testDb);
});

beforeEach(() => {
  resetTestDb(testDb);
  userId = createUser(testDb, { username: 'igor' }).user.id;
  planId = getOwnPlan(userId).id;
});

describe('countUsedDays', () => {
  it('counts ordinary weekdays', () => {
    mark('2027-03-01');
    mark('2027-03-02');
    mark('2027-03-03');

    expect(countUsedDays(planId, userId, 2027)).toBe(3);
  });

  it('does not count marked weekend days', () => {
    mark('2027-03-05'); // Friday
    mark('2027-03-06'); // Saturday
    mark('2027-03-07'); // Sunday

    expect(countUsedDays(planId, userId, 2027)).toBe(1);
  });

  it('does not count a marked company holiday', () => {
    mark('2027-03-01');
    mark('2027-03-02');
    companyHoliday('2027-03-02');

    expect(countUsedDays(planId, userId, 2027)).toBe(1);
  });

  it('counts a company holiday again once the option is turned off', () => {
    mark('2027-03-02');
    companyHoliday('2027-03-02');
    testDb.prepare('UPDATE vacay_plans SET company_holidays_enabled = 0 WHERE id = ?').run(planId);

    expect(countUsedDays(planId, userId, 2027)).toBe(1);
  });

  it('honours a plan with a non-default weekend (Friday/Saturday)', () => {
    testDb.prepare("UPDATE vacay_plans SET weekend_days = '5,6' WHERE id = ?").run(planId);
    mark('2027-03-05'); // Friday — weekend under this plan
    mark('2027-03-06'); // Saturday — weekend under this plan
    mark('2027-03-07'); // Sunday — a working day under this plan

    expect(countUsedDays(planId, userId, 2027)).toBe(1);
  });

  it('never double-subtracts a company holiday that also falls on a weekend', () => {
    mark('2027-03-06'); // Saturday
    companyHoliday('2027-03-06');
    mark('2027-03-01'); // Monday

    expect(countUsedDays(planId, userId, 2027)).toBe(1);
  });

  it('ignores days marked in another year', () => {
    mark('2027-03-01');
    mark('2028-03-01');

    expect(countUsedDays(planId, userId, 2027)).toBe(1);
  });

  it('feeds the stats so the remaining balance ignores weekends', () => {
    testDb.prepare('INSERT OR IGNORE INTO vacay_years (plan_id, year) VALUES (?, ?)').run(planId, 2027);
    testDb.prepare(
      'INSERT OR REPLACE INTO vacay_user_years (user_id, plan_id, year, vacation_days, carried_over) VALUES (?, ?, ?, 25, 0)',
    ).run(userId, planId, 2027);
    mark('2027-03-01'); // Monday — a real leave day
    mark('2027-03-06'); // Saturday — marked, but free
    mark('2027-03-07'); // Sunday — marked, but free

    const stats = getStats(planId, 2027).find(s => s.user_id === userId)!;
    expect(stats.used).toBe(1);
    expect(stats.remaining).toBe(24);
  });
});
