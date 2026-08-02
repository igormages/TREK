import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';

const testDb = new Database(':memory:');
testDb.exec(`
  CREATE TABLE diplomatie_advisories (
    country_code TEXT PRIMARY KEY,
    level TEXT NOT NULL DEFAULT 'unknown',
    level_label TEXT NOT NULL DEFAULT 'Inconnu',
    risks TEXT NOT NULL DEFAULT '',
    visa TEXT NOT NULL DEFAULT '',
    other_info TEXT NOT NULL DEFAULT '',
    last_updated TEXT,
    sections TEXT NOT NULL DEFAULT '[]',
    source_url TEXT NOT NULL DEFAULT '',
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

vi.mock('../../../src/services/auditLog', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/db/database', () => ({ db: testDb }));

let svc: typeof import('../../../src/services/diplomatieService');

beforeAll(async () => {
  svc = await import('../../../src/services/diplomatieService');
});

beforeEach(() => {
  testDb.exec('DELETE FROM diplomatie_advisories');
});

afterAll(() => {
  testDb.close();
});

function seedRow(code: string, level: string, overrides: Record<string, string> = {}): void {
  testDb.prepare(`
    INSERT INTO diplomatie_advisories (
      country_code, level, level_label, risks, visa, other_info,
      last_updated, sections, source_url
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    code,
    level,
    overrides.level_label ?? 'Vigilance normale',
    overrides.risks ?? 'Risques modérés',
    overrides.visa ?? 'Passeport valide',
    overrides.other_info ?? '',
    overrides.last_updated ?? '1 janvier 2026',
    overrides.sections ?? JSON.stringify([{ id: 'securite', title: 'Sécurité', html: '<p>Test</p>' }]),
    overrides.source_url ?? 'https://example.com/es',
  );
}

describe('diplomatieService', () => {
  describe('getDiplomatieMeta', () => {
    it('resolves known ISO codes', () => {
      expect(svc.getDiplomatieMeta('ES')?.slug).toBe('espagne');
      expect(svc.getDiplomatieMeta('DE')?.slug).toBe('allemagne');
      expect(svc.getDiplomatieMeta('US')?.slug).toBe('etats-unis');
    });

    it('returns null for unknown codes', () => {
      expect(svc.getDiplomatieMeta('XX')).toBeNull();
    });
  });

  describe('listDiplomatieCodes', () => {
    it('covers most world countries', () => {
      const codes = svc.listDiplomatieCodes();
      expect(codes.length).toBeGreaterThan(180);
      expect(codes).toContain('ES');
      expect(codes).toContain('JP');
      expect(codes).toContain('BR');
    });
  });

  describe('rewriteDiplomatieRelativeUrls', () => {
    it('rewrites root-relative paths (Australia case)', () => {
      const html = '<img src="/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg" alt="Australie">';
      expect(svc.rewriteDiplomatieRelativeUrls(html)).toBe(
        '<img src="https://www.diplomatie.gouv.fr/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg" alt="Australie">',
      );
    });

    it('rewrites paths without leading slash', () => {
      const html = '<a href="files/cav/australie/test.jpg">link</a>';
      expect(svc.rewriteDiplomatieRelativeUrls(html)).toContain(
        'href="https://www.diplomatie.gouv.fr/files/cav/australie/test.jpg"',
      );
    });

    it('leaves absolute URLs unchanged', () => {
      const url = 'https://www.diplomatie.gouv.fr/files/cav/australie/test.jpg';
      const html = `<img src="${url}">`;
      expect(svc.rewriteDiplomatieRelativeUrls(html)).toBe(`<img src="${url}">`);
    });

    it('rewrites protocol-relative URLs', () => {
      const html = '<img src="//www.diplomatie.gouv.fr/files/test.jpg">';
      expect(svc.rewriteDiplomatieRelativeUrls(html)).toContain(
        'src="https://www.diplomatie.gouv.fr/files/test.jpg"',
      );
    });
  });

  describe('parseAdvisoryLevel', () => {
    it('detects vigilance normale (green)', () => {
      const html = '<h3>Zones de vigilance</h3><p>L\'ensemble du pays est en vigilance normale.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('green');
    });

    it('detects formellement déconseillé (red)', () => {
      const html = '<h3>Zones de vigilance</h3><p>La totalité du territoire est formellement déconseillée.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('red');
    });

    it('detects zones formellement déconseillées heading (red)', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Zones formellement déconseillées</h4><p>Frontière sud.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('red');
    });

    it('detects vigilance renforcée (yellow)', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Zones de vigilance renforcée (jaune sur la carte)</h4><p>Le sud.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('detects déconseillé sauf raison impérative (orange)', () => {
      const html = '<h3>Zones de vigilance</h3><p>Ce pays est déconseillé sauf raison impérative.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('orange');
    });

    it('defaults to green when vigilance section exists without explicit level', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Avertissement concernant les animaux sauvages</h4><p>Des ours.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('green');
    });

    it('returns unknown when no vigilance section', () => {
      expect(svc.parseAdvisoryLevel('<p>Rien ici.</p>')).toBe('unknown');
    });
  });

  describe('database reads', () => {
    it('isDiplomatieDataEmpty reflects row count', () => {
      expect(svc.isDiplomatieDataEmpty()).toBe(true);
      seedRow('ES', 'green');
      expect(svc.isDiplomatieDataEmpty()).toBe(false);
    });

    it('getAllAdvisoryLevels returns levels from DB', async () => {
      seedRow('ES', 'green');
      seedRow('FR', 'yellow');
      const levels = await svc.getAllAdvisoryLevels();
      expect(levels).toEqual({ ES: 'green', FR: 'yellow' });
    });

    it('getCountrySummary returns stored summary', async () => {
      seedRow('ES', 'green', { risks: 'Sécurité bonne', visa: 'CNI acceptée' });
      const summary = await svc.getCountrySummary('es');
      expect(summary).toMatchObject({
        code: 'ES',
        name: 'Espagne',
        level: 'green',
        risks: 'Sécurité bonne',
        visa: 'CNI acceptée',
        lastUpdated: '1 janvier 2026',
      });
    });

    it('getCountryDetail returns stored sections with rewritten URLs', async () => {
      seedRow('AU', 'green', {
        sections: JSON.stringify([{
          id: 'securite',
          title: 'Sécurité',
          html: '<img src="/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg">',
        }]),
      });
      const detail = await svc.getCountryDetail('AU');
      expect(detail?.sections[0].html).toContain(
        'https://www.diplomatie.gouv.fr/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg',
      );
    });

    it('getCountryDetail returns stored sections', async () => {
      seedRow('ES', 'green');
      const detail = await svc.getCountryDetail('ES');
      expect(detail?.sections).toHaveLength(1);
      expect(detail?.sections[0].html).toContain('<p>Test</p>');
    });

    it('getAdvisoryLevel returns unknown when country not synced', async () => {
      expect(await svc.getAdvisoryLevel('ES')).toBe('unknown');
    });
  });
});
