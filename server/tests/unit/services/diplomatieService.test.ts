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

    it('detects whole-country formellement déconseillé (red)', () => {
      const html = '<h3>Zones de vigilance</h3><p>La totalité du territoire est formellement déconseillée.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('red');
    });

    it('uses yellow as default when only sub-zone red headings exist', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Zones formellement déconseillées</h4><p>Frontière sud.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('detects vigilance renforcée (yellow)', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Zones de vigilance renforcée (jaune sur la carte)</h4><p>Le sud.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('detects whole-country déconseillé sauf raison impérative (orange)', () => {
      const html = '<h3>Zones de vigilance</h3><p>Ce pays est déconseillé sauf raison impérative.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('orange');
    });

    it('detects le reste du pays en vigilance renforcée (yellow)', () => {
      const html = '<h3>Zones de vigilance</h3><p>Zones formellement déconseillées : Chihuahua. Le reste du pays est en vigilance renforcée.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('detects narrative sub-zone warnings as yellow (India-style)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <p>L'Inde est, dans son ensemble, un pays relativement sûr.</p>
        <h4>Jammu-Cachemire</h4>
        <p>Il est formellement déconseillé de se rendre dans la vallée du Cachemire.</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('prefers yellow zone heading over orange/red in multi-zone countries (Thailand-style)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <h4>Zones formellement déconseillées</h4><p>Extrême-sud.</p>
        <h4>Zones déconseillées sauf raison impérative</h4><p>Satun.</p>
        <h4>Zones en vigilance renforcée : Bangkok et autres régions</h4><p>Généralités.</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('defaults to green when vigilance section exists without explicit level', () => {
      const html = '<h3>Zones de vigilance</h3><h4>Avertissement concernant les animaux sauvages</h4><p>Des ours.</p>';
      expect(svc.parseAdvisoryLevel(html)).toBe('green');
    });

    it('returns unknown when no vigilance section', () => {
      expect(svc.parseAdvisoryLevel('<p>Rien ici.</p>')).toBe('unknown');
    });

    it('detects Sudan as red (whole-country red zone heading)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <img src="/files/files/cav/soudan/20250123_soudan-fcv_az_cle015cab.jpg" />
        <h4>Zones formellement déconseillées (en rouge)</h4>
        <p>Il est formellement déconseillé de se rendre dans l'ensemble du territoire soudanais, y compris à Khartoum et à Port-Soudan.</p>
        <h4>États du Darfour</h4>
        <p>Il est formellement déconseillé de se rendre dans les cinq États fédérés du Darfour.</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('red');
    });

    it('detects India as yellow (mixed zones with narrative sub-zones)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <img src="/files/files/cav/inde/20260209_inde-fcv_cle07fb22-77f64.jpg" />
        <p>L'Inde est, dans son ensemble, un pays relativement sûr.</p>
        <h4>Jammu-Cachemire et zones frontalières avec le Pakistan</h4>
        <p>Il est formellement déconseillé aux ressortissants français de se rendre dans la vallée du Cachemire (en rouge sur la carte).</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });

    it('detects Afghanistan as red (whole territory statement)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <img src="/files/files/cav/afghanistan/20180213_-afghanistan-fcv_cle083319-1.jpg" />
        <p>La totalité du territoire est formellement déconseillée.</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('red');
    });

    it('detects Spain as green (whole-country normal vigilance)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <img src="/files/files/cav/espagne/08-07-2013-espagne-fcv_bd_cle06115b-21c08.jpg" />
        <p>L'ensemble du pays est en vigilance normale.</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('green');
    });

    it('detects Honduras with typo "vigilence" as yellow (mixed orange/yellow zones)', () => {
      const html = `<h3>Zones de vigilence</h3>
        <img src="/files/files/cav/honduras/20160212_honduras_fcv_bd_cle811541-99736.jpg" />
        <h4>Zones déconseillées sauf raison impérative</h4><p>Francisco Morazán.</p>
        <h4>Zones de vigilance renforcée</h4><p>Les îles de la Baie.</p>`;
      expect(svc.parseAdvisoryLevel(html)).toBe('yellow');
    });
  });

  describe('extractVigilanceMapUrl', () => {
    it('extracts map image after Zones de vigilance heading (Australia)', () => {
      const html = `<h3>Zones de vigilance</h3>
        <figure class="fr-content-media"><img src="/files/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg" alt="" /></figure>`;
      expect(svc.extractVigilanceMapUrl(html)).toBe(
        'https://www.diplomatie.gouv.fr/files/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg',
      );
    });

    it('extracts map with single /files/cav/ path', () => {
      const html = '<h3>Zones de vigilance</h3><img src="/files/cav/espagne/test.jpg">';
      expect(svc.extractVigilanceMapUrl(html)).toBe(
        'https://www.diplomatie.gouv.fr/files/cav/espagne/test.jpg',
      );
    });

    it('returns null when no vigilance section', () => {
      expect(svc.extractVigilanceMapUrl('<p>Pas de carte.</p>')).toBeNull();
    });

    it('returns null when vigilance section has no map image', () => {
      const html = '<h3>Zones de vigilance</h3><p>L\'ensemble du pays est en vigilance normale.</p>';
      expect(svc.extractVigilanceMapUrl(html)).toBeNull();
    });

    it('extracts map with typo "vigilence" heading (Honduras)', () => {
      const html = `<h3>Zones de vigilence</h3>
        <figure><img loading="lazy" src="/files/files/cav/honduras/20160212_honduras_fcv_bd_cle811541-99736.jpg" alt="carte de vigilance" /></figure>
        <h4>Zones de vigilance renforcée</h4>`;
      expect(svc.extractVigilanceMapUrl(html)).toBe(
        'https://www.diplomatie.gouv.fr/files/files/cav/honduras/20160212_honduras_fcv_bd_cle811541-99736.jpg',
      );
    });

    it('extracts map from data-src attribute', () => {
      const html = '<h3>Zones de vigilance</h3><img data-src="/files/cav/test/pays-fcv.jpg">';
      expect(svc.extractVigilanceMapUrl(html)).toBe(
        'https://www.diplomatie.gouv.fr/files/cav/test/pays-fcv.jpg',
      );
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
        levelLabel: 'Vigilance normale',
        risks: 'Sécurité bonne',
        visa: 'CNI acceptée',
        lastUpdated: '1 janvier 2026',
        vigilanceMapUrl: null,
      });
    });

    it('getCountrySummary normalizes stale level_label from level code', async () => {
      seedRow('SD', 'red', { level_label: 'Vigilance renforcée' });
      const summary = await svc.getCountrySummary('SD');
      expect(summary?.level).toBe('red');
      expect(summary?.levelLabel).toBe('Formellement déconseillé');
    });

    it('getCountrySummary includes vigilance map URL from security section', async () => {
      seedRow('AU', 'green', {
        sections: JSON.stringify([{
          id: 'securite',
          title: 'Sécurité',
          html: '<h3>Zones de vigilance</h3><img src="/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg">',
        }]),
      });
      const summary = await svc.getCountrySummary('AU');
      expect(summary?.vigilanceMapUrl).toBe(
        'https://www.diplomatie.gouv.fr/files/cav/australie/20130530_australie-fcv_cle0fcb6c-1.jpg',
      );
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
