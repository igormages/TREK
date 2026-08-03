import { db } from '../db/database';
import { logError, logInfo } from './auditLog';
import type { MeteoCountryDetail, MeteoElectricity, MeteoHealth, MeteoMonthDetail } from '@trek/shared';

/** Climate suitability level from A-contresens (1 = worst, 5 = best). */
export type MeteoLevel = 1 | 2 | 3 | 4 | 5;

export interface MeteoLevelEntry {
  level: MeteoLevel;
  levelLabel: string;
}

const BASE_URL = 'https://planificateur.a-contresens.net';
const SOURCE_URL = `${BASE_URL}/quand-partir.html`;
const USER_AGENT = 'Trek-Atlas/1.0 (+https://github.com/liketrek/TREK)';
/** Country-page details refresh alongside the monthly level sync cadence. */
const DETAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** French labels from planificateur.a-contresens.net (bg-climate-note1–5). */
export const METEO_LEVEL_LABELS: Record<MeteoLevel, string> = {
  1: 'Défavorable',
  2: 'Peu favorable',
  3: 'Envisageable',
  4: 'Favorable',
  5: 'Très favorable',
};

/**
 * Colors from planificateur.a-contresens.net CSS (.bg-climate-note1–5).
 * note1=#f66, note2=#f96, note3=#ff9, note4=#9c9, note5=#6c6
 */
export const METEO_LEVEL_COLORS: Record<MeteoLevel, string> = {
  1: '#ff6666',
  2: '#ff9966',
  3: '#ffff99',
  4: '#99cc99',
  5: '#66cc66',
};

let syncInProgress = false;

// Lazily prepared: preparing at module load would fail under tests that import
// the app before the schema/migrations have created the tables.
let upsertStmt: ReturnType<typeof db.prepare> | null = null;
const UPSERT = () => (upsertStmt ??= db.prepare(`
  INSERT INTO atlas_meteo (country_code, month, level, level_label, synced_at)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(country_code, month) DO UPDATE SET
    level = excluded.level,
    level_label = excluded.level_label,
    synced_at = CURRENT_TIMESTAMP
`));

let pageUpsertStmt: ReturnType<typeof db.prepare> | null = null;
const PAGE_UPSERT = () => (pageUpsertStmt ??= db.prepare(`
  INSERT INTO atlas_meteo_country (country_code, page_path, name, synced_at)
  VALUES (?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(country_code) DO UPDATE SET
    page_path = excluded.page_path,
    name = excluded.name,
    synced_at = CURRENT_TIMESTAMP
`));

let detailUpdateStmt: ReturnType<typeof db.prepare> | null = null;
const DETAIL_UPDATE = () => (detailUpdateStmt ??= db.prepare(`
  UPDATE atlas_meteo_country SET detail_json = ?, detail_synced_at = CURRENT_TIMESTAMP
  WHERE country_code = ?
`));

export function isMeteoDataEmpty(): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM atlas_meteo').get() as { c: number };
  return row.c === 0;
}

export function ensureMeteoSync(): void {
  if (!isMeteoDataEmpty()) return;
  void syncAllMeteoData()
    .then((result) => {
      if (!result) return;
      logInfo(`Meteo initial sync complete: ${result.synced} rows synced`);
    })
    .catch((err: unknown) => {
      logError(`Meteo initial sync failed: ${err instanceof Error ? err.message : err}`);
    });
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

/** Extract the embedded monthData array from quand-partir.html via bracket matching. */
export function parseMonthDataFromHtml(html: string): unknown[] | null {
  const marker = 'window.plannerApp.data.monthData = ';
  const start = html.indexOf(marker);
  if (start < 0) return null;

  const slice = html.slice(start + marker.length);
  let depth = 0;
  let end = -1;
  for (let i = 0; i < slice.length; i++) {
    const c = slice[i];
    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;

  try {
    const monthData = eval(slice.slice(0, end)) as unknown[];
    return Array.isArray(monthData) ? monthData : null;
  } catch {
    return null;
  }
}

type RawCountryRow = [{ v: string; f: string }, number, { f: string; v: string }];

function parseMonthRows(rows: unknown[]): Array<{ code: string; name: string | null; level: MeteoLevel; levelLabel: string; pagePath: string | null }> {
  const out: Array<{ code: string; name: string | null; level: MeteoLevel; levelLabel: string; pagePath: string | null }> = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [country, levelNum, labelObj] = row as RawCountryRow;
    const code = country?.v?.toUpperCase();
    const level = Number(levelNum);
    if (!code || code.length !== 2 || level < 1 || level > 5) continue;
    const levelLabel = labelObj?.v || METEO_LEVEL_LABELS[level as MeteoLevel];
    // The third element's `f` field is the country page path ("/europe/pays-FR-france.html")
    const rawPath = labelObj?.f;
    const pagePath = typeof rawPath === 'string' && /^\/[a-z_-]+\/pays-[A-Za-z]{2}-[\w-]+\.html$/.test(rawPath) ? rawPath : null;
    out.push({ code, name: country?.f || null, level: level as MeteoLevel, levelLabel, pagePath });
  }
  return out;
}

export async function syncAllMeteoData(): Promise<{ synced: number } | null> {
  if (syncInProgress) return null;
  syncInProgress = true;

  try {
    const html = await fetchPage(SOURCE_URL);
    if (!html) return { synced: 0 };

    const monthData = parseMonthDataFromHtml(html);
    if (!monthData || monthData.length === 0) return { synced: 0 };

    let synced = 0;
    const tx = db.transaction(() => {
      for (let monthIdx = 0; monthIdx < monthData.length && monthIdx < 12; monthIdx++) {
        const month = monthIdx + 1;
        const rows = parseMonthRows(monthData[monthIdx] as unknown[]);
        for (const { code, name, level, levelLabel, pagePath } of rows) {
          UPSERT().run(code, month, level, levelLabel);
          if (pagePath) PAGE_UPSERT().run(code, pagePath, name);
          synced++;
        }
      }
    });
    tx();

    return { synced };
  } finally {
    syncInProgress = false;
  }
}

export async function getMeteoLevelsForMonth(month: number): Promise<Record<string, MeteoLevel>> {
  ensureMeteoSync();
  const m = Math.max(1, Math.min(12, Math.floor(month)));
  const rows = db.prepare(
    'SELECT country_code, level FROM atlas_meteo WHERE month = ?',
  ).all(m) as Array<{ country_code: string; level: number }>;

  const levels: Record<string, MeteoLevel> = {};
  for (const row of rows) {
    const level = row.level;
    if (level >= 1 && level <= 5) {
      levels[row.country_code] = level as MeteoLevel;
    }
  }
  return levels;
}

export function getMeteoLevelLabels(): Record<MeteoLevel, string> {
  return { ...METEO_LEVEL_LABELS };
}

export function getMeteoLevelColors(): Record<MeteoLevel, string> {
  return { ...METEO_LEVEL_COLORS };
}

// ---------------------------------------------------------------------------
// Country-page detail (pays-XX-*.html): monthly temperatures, plugs, health.
// ---------------------------------------------------------------------------

function textContent(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#0?39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Slice html between a start marker and the first following end marker (or the end). */
function sliceSection(html: string, startMarker: string, endMarkers: string[]): string | null {
  const start = html.indexOf(startMarker);
  if (start < 0) return null;
  let end = html.length;
  for (const marker of endMarkers) {
    const i = html.indexOf(marker, start + startMarker.length);
    if (i >= 0 && i < end) end = i;
  }
  return html.slice(start, end);
}

/** Parsed page payload cached in atlas_meteo_country.detail_json. */
export interface ParsedCountryPage {
  annualSummary: string | null;
  months: MeteoMonthDetail[];
  electricity: MeteoElectricity | null;
  health: MeteoHealth | null;
}

function parseClimateMonths(html: string): MeteoMonthDetail[] {
  // Monthly table cells: <td data-month="1" ...><div class="bg-climate-note1" ...
  // title="<i class='planner-itinerary-temp'></i> 3.8°C <i class='planner-wi-rain'></i> 64.6mm">
  const out: MeteoMonthDetail[] = [];
  const cellRe = /<td[^>]*data-month="(\d{1,2})"[^>]*>\s*<div class="bg-climate-note([1-5])"[^>]*title="([^"]*)"/g;
  for (const m of html.matchAll(cellRe)) {
    const month = parseInt(m[1], 10);
    const level = parseInt(m[2], 10) as MeteoLevel;
    if (month < 1 || month > 12) continue;
    const tooltip = m[3];
    const temp = /(-?\d+(?:\.\d+)?)\s*°C/.exec(tooltip);
    const rain = /(\d+(?:\.\d+)?)\s*mm/.exec(tooltip);
    out.push({
      month,
      level,
      levelLabel: METEO_LEVEL_LABELS[level],
      tempC: temp ? parseFloat(temp[1]) : null,
      rainMm: rain ? parseFloat(rain[1]) : null,
    });
  }
  out.sort((a, b) => a.month - b.month);
  return out;
}

function parseElectricity(html: string): MeteoElectricity | null {
  const section = sliceSection(html, 'id="country-electricity"', ['id="country-car"', 'id="country-communication"']);
  if (!section) return null;

  const headlineMatch = /<p class="[^"]*(?:text-danger|text-success|text-warning)[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(section);
  const headline = headlineMatch ? textContent(headlineMatch[1]) : null;
  const needsAdapter = headline
    ? (/pas besoin/i.test(headline) ? false : /adaptateur/i.test(headline) ? true : null)
    : null;

  const descMatch = /<p>\s*(Les prises de courant[\s\S]*?)<\/p>/.exec(section);
  const plugTypes = [...new Set(
    [...section.matchAll(/electrical_socket\/([A-Z])[-.]/g)].map((m) => m[1]),
  )].sort();

  const alertMatch = /<div class="alert alert-default">([\s\S]*?)<\/div>/.exec(section);

  if (!headline && !descMatch && plugTypes.length === 0) return null;
  return {
    headline,
    needsAdapter,
    description: descMatch ? textContent(descMatch[1]) : null,
    plugTypes,
    voltageText: alertMatch ? textContent(alertMatch[1]) : null,
  };
}

function parseHealth(html: string): MeteoHealth | null {
  const section = sliceSection(html, 'id="country-health"', ['id="country-security"', 'id="country-insurance"', 'id="country-communication"']);
  if (!section) return null;

  const headlineMatch = /<p class="[^"]*fw-bold[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(section);
  const headline = headlineMatch ? textContent(headlineMatch[1]) : null;

  const vaccines: string[] = [];
  const listMatch = /<ul class="text-uppercase">([\s\S]*?)<\/ul>/.exec(section);
  if (listMatch) {
    for (const li of listMatch[1].matchAll(/<li>([\s\S]*?)<\/li>/g)) {
      const v = textContent(li[1]);
      if (v) vaccines.push(v);
    }
  }

  // Accordion items: title from the toggle button, body flattened to plain text.
  // "À lire…" items are link roundups — skipped.
  const sections: Array<{ title: string; text: string }> = [];
  const chunks = section.split('<div class="accordion-item">').slice(1);
  for (const chunk of chunks) {
    const titleMatch = /<button[^>]*>([\s\S]*?)<\/button>/.exec(chunk);
    if (!titleMatch) continue;
    const title = textContent(titleMatch[1]);
    if (!title || /^À (lire|consulter)/i.test(title)) continue;
    const bodyStart = chunk.indexOf('accordion-body');
    if (bodyStart < 0) continue;
    const bodyTagEnd = chunk.indexOf('>', bodyStart);
    if (bodyTagEnd < 0) continue;
    const text = textContent(chunk.slice(bodyTagEnd + 1)).slice(0, 2000);
    if (text) sections.push({ title, text });
  }

  if (!headline && vaccines.length === 0 && sections.length === 0) return null;
  return { headline, vaccines, sections };
}

export function parseCountryPageHtml(html: string): ParsedCountryPage {
  const annualMatch = /<p>\s*(Sur l[’']année[\s\S]*?)<\/p>/.exec(html);
  return {
    annualSummary: annualMatch ? textContent(annualMatch[1]) : null,
    months: parseClimateMonths(html),
    electricity: parseElectricity(html),
    health: parseHealth(html),
  };
}

interface MeteoCountryRow {
  page_path: string;
  name: string | null;
  detail_json: string | null;
  detail_synced_at: string | null;
}

function isDetailFresh(syncedAt: string | null): boolean {
  if (!syncedAt) return false;
  const ts = Date.parse(syncedAt.replace(' ', 'T') + 'Z');
  return Number.isFinite(ts) && Date.now() - ts < DETAIL_TTL_MS;
}

function safeParseDetail(json: string | null): ParsedCountryPage | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ParsedCountryPage;
  } catch {
    return null;
  }
}

export async function getMeteoCountryDetail(code: string): Promise<MeteoCountryDetail | null> {
  ensureMeteoSync();
  const row = db.prepare(
    'SELECT page_path, name, detail_json, detail_synced_at FROM atlas_meteo_country WHERE country_code = ?',
  ).get(code) as MeteoCountryRow | undefined;
  if (!row) return null;

  const sourceUrl = `${BASE_URL}${row.page_path}`;

  let parsed: ParsedCountryPage | null = null;
  if (isDetailFresh(row.detail_synced_at)) {
    parsed = safeParseDetail(row.detail_json);
  }
  if (!parsed) {
    const html = await fetchPage(sourceUrl);
    if (html) {
      parsed = parseCountryPageHtml(html);
      try {
        DETAIL_UPDATE().run(JSON.stringify(parsed), code);
      } catch (err: unknown) {
        logError(`Meteo detail cache write failed for ${code}: ${err instanceof Error ? err.message : err}`);
      }
    } else {
      // Fetch failed — serve the stale cache rather than nothing.
      parsed = safeParseDetail(row.detail_json);
    }
  }

  // Merge with the quand-partir levels so every month has at least a level even
  // when the page fetch failed or its climate table was missing.
  const levelRows = db.prepare(
    'SELECT month, level, level_label FROM atlas_meteo WHERE country_code = ?',
  ).all(code) as Array<{ month: number; level: number; level_label: string }>;
  const levelByMonth = new Map(levelRows.map((r) => [r.month, r]));

  const months: MeteoMonthDetail[] = [];
  for (let m = 1; m <= 12; m++) {
    const fromPage = parsed?.months.find((x) => x.month === m);
    const fromSync = levelByMonth.get(m);
    const level = fromPage?.level ?? (fromSync && fromSync.level >= 1 && fromSync.level <= 5 ? fromSync.level as MeteoLevel : null);
    months.push({
      month: m,
      level,
      levelLabel: fromPage?.levelLabel ?? fromSync?.level_label ?? (level ? METEO_LEVEL_LABELS[level] : null),
      tempC: fromPage?.tempC ?? null,
      rainMm: fromPage?.rainMm ?? null,
    });
  }

  return {
    code,
    name: row.name || code,
    sourceUrl,
    annualSummary: parsed?.annualSummary ?? null,
    months,
    electricity: parsed?.electricity ?? null,
    health: parsed?.health ?? null,
  };
}
