import { db } from '../db/database';
import { logError, logInfo } from './auditLog';

/** Climate suitability level from A-contresens (1 = worst, 5 = best). */
export type MeteoLevel = 1 | 2 | 3 | 4 | 5;

export interface MeteoLevelEntry {
  level: MeteoLevel;
  levelLabel: string;
}

const SOURCE_URL = 'https://planificateur.a-contresens.net/quand-partir.html';
const USER_AGENT = 'Trek-Atlas/1.0 (+https://github.com/liketrek/TREK)';

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

interface MeteoRow {
  country_code: string;
  month: number;
  level: number;
  level_label: string;
}

let syncInProgress = false;

const UPSERT = db.prepare(`
  INSERT INTO atlas_meteo (country_code, month, level, level_label, synced_at)
  VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(country_code, month) DO UPDATE SET
    level = excluded.level,
    level_label = excluded.level_label,
    synced_at = CURRENT_TIMESTAMP
`);

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

function parseMonthRows(rows: unknown[]): Array<{ code: string; level: MeteoLevel; levelLabel: string }> {
  const out: Array<{ code: string; level: MeteoLevel; levelLabel: string }> = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 3) continue;
    const [country, levelNum, labelObj] = row as RawCountryRow;
    const code = country?.v?.toUpperCase();
    const level = Number(levelNum);
    if (!code || code.length !== 2 || level < 1 || level > 5) continue;
    const levelLabel = labelObj?.v || METEO_LEVEL_LABELS[level as MeteoLevel];
    out.push({ code, level: level as MeteoLevel, levelLabel });
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
        for (const { code, level, levelLabel } of rows) {
          UPSERT.run(code, month, level, levelLabel);
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
