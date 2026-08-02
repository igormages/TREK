import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import slugData from '../data/diplomatie-slugs.json';

/** Advisory level from France Diplomatie travel recommendations. */
export type DiplomatieAdvisoryLevel = 'red' | 'orange' | 'yellow' | 'green' | 'unknown';

export interface DiplomatieCountryMeta {
  slug: string;
  name: string;
  id: string;
}

export interface DiplomatieSummary {
  code: string;
  name: string;
  level: DiplomatieAdvisoryLevel;
  levelLabel: string;
  risks: string;
  visa: string;
  otherInfo: string;
  lastUpdated: string | null;
  sourceUrl: string;
}

export interface DiplomatieDetail {
  code: string;
  name: string;
  sections: { id: string; title: string; html: string }[];
  sourceUrl: string;
}

const BASE = 'https://www.diplomatie.gouv.fr';
const USER_AGENT = 'Trek-Atlas/1.0 (+https://github.com/liketrek/TREK)';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const LEVELS_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h for bulk levels

const SLUGS = slugData as Record<string, DiplomatieCountryMeta>;

const SECTIONS = [
  { id: 'securite', suffix: 'conseils-aux-voyageurs-securite', title: 'Sécurité' },
  { id: 'entree', suffix: 'conseils-aux-voyageurs-entree-sejour', title: 'Entrée / séjour' },
  { id: 'sante', suffix: 'conseils-aux-voyageurs-sante', title: 'Santé' },
  { id: 'utiles', suffix: 'conseils-aux-voyageurs-informations-utiles', title: 'Informations utiles' },
] as const;

const LEVEL_LABELS: Record<DiplomatieAdvisoryLevel, string> = {
  red: 'Formellement déconseillé',
  orange: 'Déconseillé sauf raison impérative',
  yellow: 'Vigilance renforcée',
  green: 'Vigilance normale',
  unknown: 'Inconnu',
};

interface CacheEntry<T> {
  data: T;
  ts: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
let levelsCache: CacheEntry<Record<string, DiplomatieAdvisoryLevel>> | null = null;
let levelsWarmInProgress = false;

const CACHE_DIR = process.env.TREK_DATA_DIR
  ? path.join(process.env.TREK_DATA_DIR, 'diplomatie-cache')
  : path.join(__dirname, '..', '..', 'data', 'diplomatie-cache');

function ensureCacheDir(): void {
  if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });
}

function diskCachePath(key: string): string {
  return path.join(CACHE_DIR, `${key}.json`);
}

function readDiskCache<T>(key: string, ttl: number): T | null {
  try {
    const p = diskCachePath(key);
    if (!existsSync(p)) return null;
    const entry = JSON.parse(readFileSync(p, 'utf8')) as CacheEntry<T>;
    if (Date.now() - entry.ts > ttl) return null;
    return entry.data;
  } catch {
    return null;
  }
}

function writeDiskCache<T>(key: string, data: T): void {
  try {
    ensureCacheDir();
    writeFileSync(diskCachePath(key), JSON.stringify({ data, ts: Date.now() }));
  } catch { /* non-critical */ }
}

function getCached<T>(key: string, ttl: number): T | null {
  const mem = memoryCache.get(key) as CacheEntry<T> | undefined;
  if (mem && Date.now() - mem.ts < ttl) return mem.data;
  const disk = readDiskCache<T>(key, ttl);
  if (disk) {
    memoryCache.set(key, { data: disk, ts: Date.now() });
    return disk;
  }
  return null;
}

function setCache<T>(key: string, data: T): void {
  memoryCache.set(key, { data, ts: Date.now() });
  writeDiskCache(key, data);
}

export function getDiplomatieMeta(code: string): DiplomatieCountryMeta | null {
  return SLUGS[code.toUpperCase()] ?? null;
}

export function listDiplomatieCodes(): string[] {
  return Object.keys(SLUGS);
}

async function fetchPage(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return res.text();
  } catch {
    return null;
  }
}

function extractMainContent(html: string): string {
  const start = html.indexOf('id="contenu"');
  const slice = start >= 0 ? html.slice(start) : html;
  const endMarkers = ['<footer', 'class="fr-footer"', 'id="footer"'];
  let end = slice.length;
  for (const marker of endMarkers) {
    const idx = slice.indexOf(marker);
    if (idx > 0 && idx < end) end = idx;
  }
  return slice.slice(0, end);
}

function stripScriptsAndNav(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '');
}

function textContent(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#039;/g, "'").replace(/\s+/g, ' ').trim();
}

function extractArticleBody(html: string): string {
  const main = extractMainContent(html);
  const articleMatch = main.match(/<article[^>]*class="[^"]*node[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return stripScriptsAndNav(articleMatch[1]);
  const contentMatch = main.match(/<div[^>]*class="[^"]*field--name-body[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (contentMatch) return stripScriptsAndNav(contentMatch[1]);
  return stripScriptsAndNav(main);
}

function extractLastUpdated(html: string): string | null {
  const m = html.match(/Derni[eè]re\s+(?:actualisation|mise\s+[àa]\s+jour)\s+le\s*:?\s*(\d{1,2}\s+\w+\s+\d{4})/i);
  return m ? m[1] : null;
}

/** Parse advisory level from the security page HTML. */
export function parseAdvisoryLevel(html: string): DiplomatieAdvisoryLevel {
  const main = extractMainContent(html);
  // Find content after the vigilance zones heading block
  const zoneIdx = main.lastIndexOf('Zones de vigilance');
  const block = zoneIdx >= 0 ? main.slice(zoneIdx, zoneIdx + 12000) : main;
  const text = textContent(block);

  const hasRed = /zones?\s+formellement\s+d[eé]conseill[eé]es?/i.test(text)
    || /formellement\s+d[eé]conseill/i.test(text)
    || /est\s+formellement\s+d[eé]conseill/i.test(text)
    || /totalit[eé]\s+du\s+territoire\s+est\s+formellement/i.test(text);
  const hasOrange = /d[eé]conseill[eé]\s+sauf\s+raison\s+imp[eé]rative/i.test(text)
    || /zones?\s+d[eé]conseill[eé]es?\s+sauf/i.test(text);
  const hasYellow = /vigilance\s+renforc[eé]e/i.test(text)
    || /zones?\s+de\s+vigilance\s+renforc[eé]e/i.test(text);
  const hasGreen = /vigilance\s+normale/i.test(text)
    || /ensemble\s+du\s+(pays|territoire)\s+est\s+en\s+vigilance\s+normale/i.test(text);

  if (hasRed) return 'red';
  if (hasOrange) return 'orange';
  if (hasYellow) return 'yellow';
  if (hasGreen) return 'green';
  // Page exists but no explicit zone → assume normal
  if (zoneIdx >= 0) return 'green';
  return 'unknown';
}

function extractRisksSummary(html: string): string {
  const body = extractArticleBody(html);
  const risksIdx = body.search(/Risques\s+encourus/i);
  if (risksIdx < 0) {
    const zoneIdx = body.indexOf('Zones de vigilance');
    if (zoneIdx >= 0) {
      const slice = body.slice(zoneIdx, zoneIdx + 3000);
      return textContent(slice).slice(0, 500);
    }
    return textContent(body).slice(0, 400);
  }
  const slice = body.slice(risksIdx, risksIdx + 4000);
  const nextH3 = slice.search(/<h3[^>]*>/i);
  const block = nextH3 > 100 ? slice.slice(0, nextH3) : slice.slice(0, 3000);
  return textContent(block).slice(0, 600);
}

function extractVisaSummary(html: string): string {
  const body = extractArticleBody(html);
  const idx = body.search(/Formalit[eé]s\s+d.e\s+entr[eé]e/i);
  if (idx < 0) return textContent(body).slice(0, 400);
  const slice = body.slice(idx, idx + 3000);
  return textContent(slice).slice(0, 500);
}

function extractOtherInfo(securityHtml: string, healthHtml: string | null): string {
  const parts: string[] = [];
  const secBody = extractArticleBody(securityHtml);
  const alertMatch = secBody.match(/<h3[^>]*>Derni[eè]res?\s+minutes?[\s\S]*?<\/h3>([\s\S]*?)(?:<h3|<\/article)/i);
  if (alertMatch) {
    const alertText = textContent(alertMatch[1]).slice(0, 300);
    if (alertText) parts.push(alertText);
  }
  if (healthHtml) {
    const healthBody = extractArticleBody(healthHtml);
    const vaccIdx = healthBody.search(/vaccin/i);
    if (vaccIdx >= 0) {
      parts.push(textContent(healthBody.slice(vaccIdx, vaccIdx + 300)));
    }
  }
  return parts.join(' ').slice(0, 500);
}

function countryUrl(slug: string, suffix: string): string {
  return `${BASE}/fr/information-par-pays/${slug}/${suffix}`;
}

export async function getAdvisoryLevel(code: string): Promise<DiplomatieAdvisoryLevel> {
  const meta = getDiplomatieMeta(code);
  if (!meta) return 'unknown';

  const cacheKey = `level-${code.toUpperCase()}`;
  const cached = getCached<DiplomatieAdvisoryLevel>(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  const html = await fetchPage(countryUrl(meta.slug, 'conseils-aux-voyageurs-securite'));
  const level = html ? parseAdvisoryLevel(html) : 'unknown';
  setCache(cacheKey, level);
  return level;
}

export async function getAllAdvisoryLevels(): Promise<Record<string, DiplomatieAdvisoryLevel>> {
  if (levelsCache && Date.now() - levelsCache.ts < LEVELS_CACHE_TTL_MS) {
    return levelsCache.data;
  }

  const diskKey = 'all-levels';
  const diskCached = getCached<Record<string, DiplomatieAdvisoryLevel>>(diskKey, LEVELS_CACHE_TTL_MS);
  if (diskCached) {
    levelsCache = { data: diskCached, ts: Date.now() };
    return diskCached;
  }

  // No cache yet — warm in background so the first request doesn't block ~30s
  if (!levelsWarmInProgress) {
    levelsWarmInProgress = true;
    warmAllLevels().finally(() => { levelsWarmInProgress = false; });
  }

  // Return any individually-cached levels we already have
  const partial: Record<string, DiplomatieAdvisoryLevel> = {};
  for (const code of listDiplomatieCodes()) {
    const cached = getCached<DiplomatieAdvisoryLevel>(`level-${code}`, CACHE_TTL_MS);
    if (cached) partial[code] = cached;
  }
  return partial;
}

async function warmAllLevels(): Promise<void> {
  const codes = listDiplomatieCodes();
  const levels: Record<string, DiplomatieAdvisoryLevel> = {};

  const BATCH = 8;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const results = await Promise.all(batch.map(async (code) => {
      const level = await getAdvisoryLevel(code);
      return { code, level };
    }));
    for (const { code, level } of results) levels[code] = level;
  }

  setCache('all-levels', levels);
  levelsCache = { data: levels, ts: Date.now() };
}

export async function getCountrySummary(code: string): Promise<DiplomatieSummary | null> {
  const upper = code.toUpperCase();
  const meta = getDiplomatieMeta(upper);
  if (!meta) return null;

  const cacheKey = `summary-${upper}`;
  const cached = getCached<DiplomatieSummary>(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  const [securityHtml, entryHtml, healthHtml] = await Promise.all([
    fetchPage(countryUrl(meta.slug, 'conseils-aux-voyageurs-securite')),
    fetchPage(countryUrl(meta.slug, 'conseils-aux-voyageurs-entree-sejour')),
    fetchPage(countryUrl(meta.slug, 'conseils-aux-voyageurs-sante')),
  ]);

  if (!securityHtml && !entryHtml) return null;

  const level = securityHtml ? parseAdvisoryLevel(securityHtml) : 'unknown';
  const summary: DiplomatieSummary = {
    code: upper,
    name: meta.name,
    level,
    levelLabel: LEVEL_LABELS[level],
    risks: securityHtml ? extractRisksSummary(securityHtml) : '',
    visa: entryHtml ? extractVisaSummary(entryHtml) : '',
    otherInfo: securityHtml ? extractOtherInfo(securityHtml, healthHtml) : '',
    lastUpdated: securityHtml ? extractLastUpdated(securityHtml) : null,
    sourceUrl: countryUrl(meta.slug, 'conseils-aux-voyageurs-securite'),
  };

  setCache(cacheKey, summary);
  return summary;
}

export async function getCountryDetail(code: string): Promise<DiplomatieDetail | null> {
  const upper = code.toUpperCase();
  const meta = getDiplomatieMeta(upper);
  if (!meta) return null;

  const cacheKey = `detail-${upper}`;
  const cached = getCached<DiplomatieDetail>(cacheKey, CACHE_TTL_MS);
  if (cached) return cached;

  const sections: DiplomatieDetail['sections'] = [];
  for (const section of SECTIONS) {
    const html = await fetchPage(countryUrl(meta.slug, section.suffix));
    if (html) {
      const body = extractArticleBody(html);
      if (body.trim()) {
        sections.push({ id: section.id, title: section.title, html: body });
      }
    }
  }

  if (sections.length === 0) return null;

  const detail: DiplomatieDetail = {
    code: upper,
    name: meta.name,
    sections,
    sourceUrl: countryUrl(meta.slug, 'conseils-aux-voyageurs-securite'),
  };

  setCache(cacheKey, detail);
  return detail;
}
