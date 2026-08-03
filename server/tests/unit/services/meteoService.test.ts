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
  CREATE TABLE atlas_meteo_country (
    country_code TEXT PRIMARY KEY,
    page_path TEXT NOT NULL,
    name TEXT,
    detail_json TEXT,
    detail_synced_at DATETIME,
    synced_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

vi.mock('../../../src/services/auditLog', () => ({
  logInfo: vi.fn(),
  logError: vi.fn(),
}));

vi.mock('../../../src/db/database', () => ({ db: testDb }));

let svc: typeof import('../../../src/services/meteoService');

const SAMPLE_MONTH_DATA = `[[[{v: 'FR',f:"France"},2, {f:'/europe/pays-FR-france.html', v:'Peu favorable'}],[{v: 'ES',f:"Espagne"},3, {f:'/europe/pays-ES-espagne.html', v:'Envisageable'}]],[[{v: 'FR',f:"France"},5, {f:'/europe/pays-FR-france.html', v:'Très favorable'}],[{v: 'DE',f:"Allemagne"},1, {f:'/europe/pays-DE-allemagne.html', v:'Défavorable'}]]]`;

const SAMPLE_COUNTRY_PAGE = `
<html><body>
<div class="note note-info">
  <p>Sur l’année, la température moyenne en France est de 11.4°C et les précipitations sont en moyenne de 750.3mm.</p>
</div>
<table class="table climate">
  <tbody><tr>
    <td data-month="1" data-title="Janvier" class="cursor-pointer">
      <div class="bg-climate-note1" data-bs-toggle="tooltip" data-bs-html="true" title="<i class='planner-itinerary-temp'></i> 3.8°C <i class='planner-wi-rain'></i> 64.6mm">&nbsp;</div>
    </td>
    <td data-month="7" data-title="Juillet" class="cursor-pointer">
      <div class="bg-climate-note5" data-bs-toggle="tooltip" data-bs-html="true" title="<i class='planner-itinerary-temp'></i> 19.7°C <i class='planner-wi-rain'></i> 55mm">&nbsp;</div>
    </td>
  </tr></tbody>
</table>
<div class="col-md-6" id="country-health">
  <div class="card-body p-4">
    <p class="fw-bold font-size-bg text-warning">Des vaccins sont recommandés</p>
    <ul class="text-uppercase">
      <li>Encéphalite à tiques</li>
    </ul>
  </div>
  <div class="accordion" id="accordionHealth">
    <div class="accordion-item">
      <h2 class="accordion-header"><button class="accordion-button collapsed" type="button">Vaccinations recommandées</button></h2>
      <div class="accordion-collapse collapse"><div class="accordion-body p-4">
        <table><tbody><tr><th>Encéphalite à tiques</th><td><p>Présence signalée dans l'est du pays.</p></td></tr></tbody></table>
      </div></div>
    </div>
    <div class="accordion-item">
      <h2 class="accordion-header"><button class="accordion-button collapsed" type="button">Paludisme</button></h2>
      <div class="accordion-collapse collapse"><div class="accordion-body p-4">Il n’y a pas de paludisme en France métropolitaine.</div></div>
    </div>
    <div class="accordion-item">
      <h2 class="accordion-header"><button class="accordion-button collapsed" type="button">À lire pour aller plus loin</button></h2>
      <div class="accordion-collapse collapse"><div class="accordion-body p-4"><a href="https://example.com">Blog</a></div></div>
    </div>
  </div>
</div>
<div class="col-md-6" id="country-security"></div>
<div class="col-md-6" id="country-electricity">
  <div class="card-body p-4">
    <p class="text-danger fw-bold font-size-bg">Vous avez besoin d’un adaptateur</p>
    <p>Les prises de courant utilisées en France ne sont pas les mêmes que celles utilisées aux États-Unis (A / B).</p>
    <p class="text-center">
      <abbr title="Fiche mâles compatibles."><img src="/build/images/electrical_socket/C-2.png"></abbr>
      <abbr title="Fiches mâles compatibles."><img src="/build/images/electrical_socket/E-2.png"></abbr>
    </p>
    <div class="alert alert-default">
      <p>Le voltage est différent en France (230 V).</p>
    </div>
  </div>
</div>
<div class="col-md-6" id="country-car"></div>
</body></html>`;

beforeAll(async () => {
  svc = await import('../../../src/services/meteoService');
});

beforeEach(() => {
  testDb.exec('DELETE FROM atlas_meteo');
  testDb.exec('DELETE FROM atlas_meteo_country');
  vi.unstubAllGlobals();
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

  describe('syncAllMeteoData', () => {
    it('stores levels and country page paths', async () => {
      const html = `<html><script>window.plannerApp.data.monthData = ${SAMPLE_MONTH_DATA};</script></html>`;
      vi.stubGlobal('fetch', vi.fn(async () => new Response(html, { status: 200 })));

      const result = await svc.syncAllMeteoData();
      expect(result).toEqual({ synced: 4 });

      const fr = testDb.prepare('SELECT * FROM atlas_meteo_country WHERE country_code = ?').get('FR') as any;
      expect(fr.page_path).toBe('/europe/pays-FR-france.html');
      expect(fr.name).toBe('France');
      const de = testDb.prepare('SELECT * FROM atlas_meteo_country WHERE country_code = ?').get('DE') as any;
      expect(de.page_path).toBe('/europe/pays-DE-allemagne.html');
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

  describe('parseCountryPageHtml', () => {
    it('extracts annual summary, monthly climate, electricity and health', () => {
      const parsed = svc.parseCountryPageHtml(SAMPLE_COUNTRY_PAGE);

      expect(parsed.annualSummary).toContain('11.4°C');
      expect(parsed.annualSummary).toContain('750.3mm');

      expect(parsed.months).toHaveLength(2);
      expect(parsed.months[0]).toEqual({ month: 1, level: 1, levelLabel: 'Défavorable', tempC: 3.8, rainMm: 64.6 });
      expect(parsed.months[1]).toEqual({ month: 7, level: 5, levelLabel: 'Très favorable', tempC: 19.7, rainMm: 55 });

      expect(parsed.electricity).not.toBeNull();
      expect(parsed.electricity!.needsAdapter).toBe(true);
      expect(parsed.electricity!.headline).toContain('adaptateur');
      expect(parsed.electricity!.plugTypes).toEqual(['C', 'E']);
      expect(parsed.electricity!.voltageText).toContain('230 V');
      expect(parsed.electricity!.description).toContain('prises de courant');

      expect(parsed.health).not.toBeNull();
      expect(parsed.health!.headline).toBe('Des vaccins sont recommandés');
      expect(parsed.health!.vaccines).toEqual(['Encéphalite à tiques']);
      const titles = parsed.health!.sections.map((s) => s.title);
      expect(titles).toContain('Vaccinations recommandées');
      expect(titles).toContain('Paludisme');
      expect(titles).not.toContain('À lire pour aller plus loin');
    });

    it('returns empty shape on unrelated html', () => {
      const parsed = svc.parseCountryPageHtml('<html><body><p>rien</p></body></html>');
      expect(parsed.annualSummary).toBeNull();
      expect(parsed.months).toEqual([]);
      expect(parsed.electricity).toBeNull();
      expect(parsed.health).toBeNull();
    });
  });

  describe('getMeteoCountryDetail', () => {
    it('returns null for unknown country', async () => {
      testDb.prepare('INSERT INTO atlas_meteo (country_code, month, level, level_label) VALUES (?, ?, ?, ?)').run('FR', 1, 2, 'Peu favorable');
      vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
      expect(await svc.getMeteoCountryDetail('ZZ')).toBeNull();
    });

    it('fetches, parses and caches the country page', async () => {
      testDb.prepare('INSERT INTO atlas_meteo (country_code, month, level, level_label) VALUES (?, ?, ?, ?)').run('FR', 2, 2, 'Peu favorable');
      testDb.prepare('INSERT INTO atlas_meteo_country (country_code, page_path, name) VALUES (?, ?, ?)').run('FR', '/europe/pays-FR-france.html', 'France');

      const fetchMock = vi.fn(async () => new Response(SAMPLE_COUNTRY_PAGE, { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const detail = await svc.getMeteoCountryDetail('FR');
      expect(detail).not.toBeNull();
      expect(detail!.name).toBe('France');
      expect(detail!.sourceUrl).toBe('https://planificateur.a-contresens.net/europe/pays-FR-france.html');
      expect(detail!.months).toHaveLength(12);
      // Month 1 from the page (temp + level), month 2 filled from atlas_meteo levels
      expect(detail!.months[0]).toMatchObject({ month: 1, level: 1, tempC: 3.8 });
      expect(detail!.months[1]).toMatchObject({ month: 2, level: 2, levelLabel: 'Peu favorable', tempC: null });
      expect(detail!.electricity!.plugTypes).toEqual(['C', 'E']);
      expect(detail!.health!.vaccines).toEqual(['Encéphalite à tiques']);

      // Cached — second call must not refetch
      const again = await svc.getMeteoCountryDetail('FR');
      expect(again!.months[0].tempC).toBe(3.8);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('serves stale cache when the fetch fails', async () => {
      const stale = JSON.stringify({
        annualSummary: 'Sur l’année, 11.4°C',
        months: [{ month: 1, level: 1, levelLabel: 'Défavorable', tempC: 3.8, rainMm: 64.6 }],
        electricity: null,
        health: null,
      });
      testDb.prepare(
        "INSERT INTO atlas_meteo_country (country_code, page_path, name, detail_json, detail_synced_at) VALUES (?, ?, ?, ?, '2000-01-01 00:00:00')",
      ).run('FR', '/europe/pays-FR-france.html', 'France', stale);
      testDb.prepare('INSERT INTO atlas_meteo (country_code, month, level, level_label) VALUES (?, ?, ?, ?)').run('FR', 1, 1, 'Défavorable');

      vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));

      const detail = await svc.getMeteoCountryDetail('FR');
      expect(detail).not.toBeNull();
      expect(detail!.annualSummary).toContain('11.4°C');
      expect(detail!.months[0].tempC).toBe(3.8);
    });
  });

  describe('METEO_LEVEL_COLORS', () => {
    it('matches a-contresens palette', () => {
      expect(svc.METEO_LEVEL_COLORS[1]).toBe('#ff6666');
      expect(svc.METEO_LEVEL_COLORS[5]).toBe('#66cc66');
    });
  });
});
