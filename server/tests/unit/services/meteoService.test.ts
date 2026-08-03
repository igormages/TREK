import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
  CREATE TABLE atlas_meteo (
    country_code TEXT NOT NULL,
    month INTEGER NOT NULL,
    level INTEGER NOT NULL,
    level_label TEXT NOT NULL,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (country_code, month)
  );
`);

vi.mock('../../../src/services/auditLog', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/db/database', () => ({ db: testDb }));

let svc: typeof import('../../../src/services/meteoService');

const SAMPLE_MONTH_DATA = `[[[{v: 'FR',f:"France"},2, {f:'/europe/pays-FR-france.html', v:'Peu favorable'}],[{v: 'ES',f:"Espagne"},3, {f:'/europe/pays-ES-espagne.html', v:'Envisageable'}]],[[{v: 'FR',f:"France"},5, {f:'/europe/pays-FR-france.html', v:'Très favorable'}],[{v: 'DE',f:"Allemagne"},1, {f:'/europe/pays-DE-allemagne.html', v:'Défavorable'}]]]`;

beforeAll(async () => {
  svc = await import('../../../src/services/meteoService');
});

beforeEach(() => {
  testDb.exec('DELETE FROM atlas_meteo');
});

afterAll(() => {
  testDb.close();
});

describe('meteoService', () => {
  describe('parseMonthDataFromHtml', () => {
    it('extracts monthData array from embedded script', () => {
      const html = `<html><script>window.plannerApp.data.monthData = ${SAMPLE_MONTH_DATA};window.plannerApp.data.month=1;</script></html>`;
      const data = svc.parseMonthDataFromHtml(html);
      expect(data).not.toBeNull();
      expect(data!.length).toBe(2);
      expect((data![0] as unknown[]).length).toBe(2);
    });

    it('returns null when marker is missing', () => {
      expect(svc.parseMonthDataFromHtml('<html></html>')).toBeNull();
    });
  });

  describe('getMeteoLevelsForMonth', () => {
    it('returns levels for a given month', async () => {
      testDb.prepare('INSERT INTO atlas_meteo (country_code, month, level, level_label) VALUES (?, ?, ?, ?)').run('FR', 1, 2, 'Peu favorable');
      testDb.prepare('INSERT INTO atlas_meteo (country_code, month, level, level_label) VALUES (?, ?, ?, ?)').run('ES', 1, 3, 'Envisageable');
      testDb.prepare('INSERT INTO atlas_meteo (country_code, month, level, level_label) VALUES (?, ?, ?, ?)').run('FR', 2, 5, 'Très favorable');

      const jan = await svc.getMeteoLevelsForMonth(1);
      expect(jan.FR).toBe(2);
      expect(jan.ES).toBe(3);

      const feb = await svc.getMeteoLevelsForMonth(2);
      expect(feb.FR).toBe(5);
      expect(feb.ES).toBeUndefined();
    });
  });

  describe('METEO_LEVEL_COLORS', () => {
    it('matches a-contresens palette', () => {
      expect(svc.METEO_LEVEL_COLORS[1]).toBe('#ff6666');
      expect(svc.METEO_LEVEL_COLORS[5]).toBe('#66cc66');
    });
  });
});
