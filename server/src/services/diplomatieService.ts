import slugData from '../data/diplomatie-slugs.json';
import { db } from '../db/database';
import { logError, logInfo } from './auditLog';

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
  vigilanceMapUrl: string | null;
}

export interface DiplomatieDetail {
  code: string;
  name: string;
  sections: { id: string; title: string; html: string }[];
  sourceUrl: string;
}

const BASE = 'https://www.diplomatie.gouv.fr';
const USER_AGENT = 'Trek-Atlas/1.0 (+https://github.com/liketrek/TREK)';

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

/** Matches "Zones de vigilance" and the occasional typo "vigilence" on diplomatie.gouv.fr. */
const VIGILANCE_SECTION_RE = /Zones\s+de\s+vigil[ae]nce/i;

const VIGILANCE_MAP_IMG_ATTR_RE = /(?:src|data-src)=["']([^"']*\/cav\/[^"']+)["']/i;

function findVigilanceSectionIndex(html: string): number {
  const match = html.match(VIGILANCE_SECTION_RE);
  return match?.index ?? -1;
}

function levelLabelFor(level: DiplomatieAdvisoryLevel): string {
  return LEVEL_LABELS[level];
}

interface DiplomatieRow {
  country_code: string;
  level: string;
  level_label: string;
  risks: string;
  visa: string;
  other_info: string;
  last_updated: string | null;
  sections: string;
  source_url: string;
  synced_at: string;
}

let syncInProgress = false;

// Lazily prepared: preparing at module load would fail under tests that import
// the app before the schema/migrations have created the table.
let upsertStmt: ReturnType<typeof db.prepare> | null = null;
const UPSERT = () => (upsertStmt ??= db.prepare(`
  INSERT INTO diplomatie_advisories (
    country_code, level, level_label, risks, visa, other_info,
    last_updated, sections, source_url, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  ON CONFLICT(country_code) DO UPDATE SET
    level = excluded.level,
    level_label = excluded.level_label,
    risks = excluded.risks,
    visa = excluded.visa,
    other_info = excluded.other_info,
    last_updated = excluded.last_updated,
    sections = excluded.sections,
    source_url = excluded.source_url,
    synced_at = CURRENT_TIMESTAMP
`));

export function getDiplomatieMeta(code: string): DiplomatieCountryMeta | null {
  return SLUGS[code.toUpperCase()] ?? null;
}

export function listDiplomatieCodes(): string[] {
  return Object.keys(SLUGS);
}

export function isDiplomatieDataEmpty(): boolean {
  const row = db.prepare('SELECT COUNT(*) AS c FROM diplomatie_advisories').get() as { c: number };
  return row.c === 0;
}

export function ensureDiplomatieSync(): void {
  if (!isDiplomatieDataEmpty()) return;
  void syncAllDiplomatieData()
    .then((result) => {
      if (!result) return;
      logInfo(`Diplomatie initial sync complete: ${result.synced} synced, ${result.failed} failed`);
    })
    .catch((err: unknown) => {
      logError(`Diplomatie initial sync failed: ${err instanceof Error ? err.message : err}`);
    });
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

/**
 * Parse the default advisory level from the security page HTML.
 * Uses the dominant / rest-of-country level — not the worst sub-zone level —
 * so mixed-zone countries (e.g. India, Thailand) map to yellow instead of red.
 */
export function parseAdvisoryLevel(html: string): DiplomatieAdvisoryLevel {
  const main = extractMainContent(html);
  const zoneIdx = findVigilanceSectionIndex(main);
  if (zoneIdx < 0) return 'unknown';

  const block = main.slice(zoneIdx, zoneIdx + 20000);
  const text = textContent(block);

  // 1. Explicit whole-country statements
  if (/totalit[eé]\s+du\s+territoire\s+est\s+formellement/i.test(text)) return 'red';
  if (/l['\u2019]ensemble\s+du\s+(?:pays|territoire)\s+est\s+formellement/i.test(text)) return 'red';
  if (/ce\s+pays\s+est\s+formellement\s+d[eé]conseill/i.test(text)) return 'red';
  if (/il\s+est\s+formellement\s+d[eé]conseill[eé][^.]{0,120}ensemble\s+du\s+territoire/i.test(text)) return 'red';
  if (/ensemble\s+du\s+territoire[^.]{0,80}formellement\s+d[eé]conseill/i.test(text)) return 'red';

  if (/ce\s+pays\s+est\s+d[eé]conseill[eé]\s+sauf\s+raison\s+imp[eé]rative/i.test(text)) return 'orange';
  if (/l['\u2019]ensemble\s+du\s+(?:pays|territoire)\s+est\s+d[eé]conseill[eé]\s+sauf/i.test(text)) return 'orange';
  if (/totalit[eé]\s+du\s+territoire\s+est\s+d[eé]conseill[eé]\s+sauf/i.test(text)) return 'orange';

  if (/l['\u2019]ensemble\s+du\s+(?:pays|territoire)\s+est\s+en\s+vigilance\s+renforc[eé]e/i.test(text)) return 'yellow';
  if (/l['\u2019]ensemble\s+du\s+(?:pays|territoire)\s+est\s+en\s+vigilance\s+normale/i.test(text)) return 'green';

  // 2. "Le reste du pays/territoire est en …"
  const restMatch = text.match(
    /le\s+reste\s+du\s+(?:pays|territoire)\s+est\s+en\s+(?:vigilance\s+)?(normale|renforc[eé]e)/i,
  );
  if (restMatch) {
    return restMatch[1].toLowerCase().startsWith('norm') ? 'green' : 'yellow';
  }

  // 3. Structured zone headings (h3/h4 categories on the official map)
  const hasYellowHeading = /zones?\s+(?:(?:de|en)\s+)?vigilance\s+renforc[eé]e/i.test(block);
  const hasOrangeHeading = /zones?\s+d[eé]conseill[eé]es?\s+sauf/i.test(block);
  const hasRedHeading = /zones?\s+formellement\s+d[eé]conseill[eé]es?/i.test(block);

  if (hasYellowHeading || hasOrangeHeading || hasRedHeading) {
    if (hasYellowHeading) return 'yellow';
    if (hasOrangeHeading) return 'orange';
    if (hasRedHeading && /(?:ensemble\s+du\s+(?:pays|territoire)|totalit[eé]\s+du\s+territoire)/i.test(text)) {
      return 'red';
    }
  }

  // 4. Narrative sub-zone warnings (e.g. India — Kashmir red, rest of country safe)
  const hasPartialRed = /(?:il\s+est\s+)?formellement\s+d[eé]conseill/i.test(text);
  const hasPartialWarn = /(?:il\s+est\s+)?(?:fortement\s+)?d[eé]conseill[eé]/i.test(text);
  if (hasPartialRed || hasPartialWarn) return 'yellow';

  if (/vigilance\s+renforc[eé]e/i.test(text)) return 'yellow';
  if (/vigilance\s+normale/i.test(text)) return 'green';
  return 'green';
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

function resolveDiplomatieUrl(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('mailto:') || trimmed.startsWith('#')) {
    return url;
  }
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('//')) return `https:${trimmed}`;
  if (trimmed.startsWith('/')) return `${BASE}${trimmed}`;
  return `${BASE}/${trimmed}`;
}

/** Extract the vigilance zones map image URL from a security page HTML body. */
export function extractVigilanceMapUrl(html: string): string | null {
  const body = extractArticleBody(html);
  const zoneIdx = findVigilanceSectionIndex(body);
  if (zoneIdx >= 0) {
    const block = body.slice(Math.max(0, zoneIdx - 500), zoneIdx + 12000);
    const imgMatch = block.match(new RegExp(`<img[^>]+${VIGILANCE_MAP_IMG_ATTR_RE.source}`, 'i'));
    if (imgMatch) return resolveDiplomatieUrl(imgMatch[1]);
  }

  const fallbackMatch = body.match(new RegExp(`<img[^>]+${VIGILANCE_MAP_IMG_ATTR_RE.source}`, 'i'));
  if (!fallbackMatch) return null;

  return resolveDiplomatieUrl(fallbackMatch[1]);
}

function vigilanceMapFromSections(sectionsJson: string): string | null {
  try {
    const sections = JSON.parse(sectionsJson) as DiplomatieDetail['sections'];
    const securite = sections.find((s) => s.id === 'securite');
    if (!securite?.html) return null;
    return extractVigilanceMapUrl(securite.html);
  } catch {
    return null;
  }
}

/** Rewrite relative image/link URLs in scraped HTML to absolute diplomatie.gouv.fr URLs. */
export function rewriteDiplomatieRelativeUrls(html: string): string {
  return html.replace(
    /(\s(?:src|href|data-src)=["'])([^"']+)(["'])/gi,
    (_match, prefix: string, url: string, suffix: string) => `${prefix}${resolveDiplomatieUrl(url)}${suffix}`,
  );
}

function parseSections(sectionResults: { id: string; title: string; html: string | null }[]): DiplomatieDetail['sections'] {
  const sections: DiplomatieDetail['sections'] = [];
  for (const section of sectionResults) {
    if (!section.html) continue;
    const body = extractArticleBody(section.html);
    if (body.trim()) {
      sections.push({ id: section.id, title: section.title, html: rewriteDiplomatieRelativeUrls(body) });
    }
  }
  return sections;
}

async function scrapeCountry(code: string): Promise<boolean> {
  const upper = code.toUpperCase();
  const meta = getDiplomatieMeta(upper);
  if (!meta) return false;

  const securityUrl = countryUrl(meta.slug, 'conseils-aux-voyageurs-securite');
  const entryUrl = countryUrl(meta.slug, 'conseils-aux-voyageurs-entree-sejour');
  const healthUrl = countryUrl(meta.slug, 'conseils-aux-voyageurs-sante');

  const [securityHtml, entryHtml, healthHtml, ...detailHtmls] = await Promise.all([
    fetchPage(securityUrl),
    fetchPage(entryUrl),
    fetchPage(healthUrl),
    ...SECTIONS.map((s) => fetchPage(countryUrl(meta.slug, s.suffix))),
  ]);

  if (!securityHtml && !entryHtml) return false;

  const level = securityHtml ? parseAdvisoryLevel(securityHtml) : 'unknown';
  const sections = parseSections(SECTIONS.map((s, i) => ({
    id: s.id,
    title: s.title,
    html: detailHtmls[i],
  })));

  UPSERT().run(
    upper,
    level,
    levelLabelFor(level),
    securityHtml ? extractRisksSummary(securityHtml) : '',
    entryHtml ? extractVisaSummary(entryHtml) : '',
    securityHtml ? extractOtherInfo(securityHtml, healthHtml) : '',
    securityHtml ? extractLastUpdated(securityHtml) : null,
    JSON.stringify(sections),
    securityUrl,
  );

  return true;
}

export async function syncAllDiplomatieData(): Promise<{ synced: number; failed: number } | null> {
  if (syncInProgress) return null;
  syncInProgress = true;

  try {
    const codes = listDiplomatieCodes();
    let synced = 0;
    let failed = 0;

    const BATCH = 8;
    for (let i = 0; i < codes.length; i += BATCH) {
      const batch = codes.slice(i, i + BATCH);
      const results = await Promise.all(batch.map(async (code) => scrapeCountry(code)));
      for (const ok of results) {
        if (ok) synced++;
        else failed++;
      }
    }

    return { synced, failed };
  } finally {
    syncInProgress = false;
  }
}

function rowToSummary(row: DiplomatieRow, name: string): DiplomatieSummary {
  return {
    code: row.country_code,
    name,
    level: row.level as DiplomatieAdvisoryLevel,
    levelLabel: levelLabelFor(row.level as DiplomatieAdvisoryLevel) || row.level_label,
    risks: row.risks,
    visa: row.visa,
    otherInfo: row.other_info,
    lastUpdated: row.last_updated,
    sourceUrl: row.source_url,
    vigilanceMapUrl: vigilanceMapFromSections(row.sections),
  };
}

function rowToDetail(row: DiplomatieRow, name: string): DiplomatieDetail {
  let sections: DiplomatieDetail['sections'] = [];
  try {
    sections = JSON.parse(row.sections) as DiplomatieDetail['sections'];
  } catch { /* keep empty */ }

  return {
    code: row.country_code,
    name,
    sections: sections.map((s) => ({
      ...s,
      html: rewriteDiplomatieRelativeUrls(s.html),
    })),
    sourceUrl: row.source_url,
  };
}

export async function getAdvisoryLevel(code: string): Promise<DiplomatieAdvisoryLevel> {
  ensureDiplomatieSync();
  const upper = code.toUpperCase();
  const row = db.prepare('SELECT level FROM diplomatie_advisories WHERE country_code = ?').get(upper) as { level: string } | undefined;
  return (row?.level as DiplomatieAdvisoryLevel) ?? 'unknown';
}

export async function getAllAdvisoryLevels(): Promise<Record<string, DiplomatieAdvisoryLevel>> {
  ensureDiplomatieSync();
  const rows = db.prepare('SELECT country_code, level FROM diplomatie_advisories').all() as Array<{ country_code: string; level: string }>;
  const levels: Record<string, DiplomatieAdvisoryLevel> = {};
  for (const row of rows) {
    levels[row.country_code] = row.level as DiplomatieAdvisoryLevel;
  }
  return levels;
}

export async function getCountrySummary(code: string): Promise<DiplomatieSummary | null> {
  ensureDiplomatieSync();
  const upper = code.toUpperCase();
  const meta = getDiplomatieMeta(upper);
  if (!meta) return null;

  const row = db.prepare('SELECT * FROM diplomatie_advisories WHERE country_code = ?').get(upper) as DiplomatieRow | undefined;
  if (!row) return null;

  return rowToSummary(row, meta.name);
}

export async function getCountryDetail(code: string): Promise<DiplomatieDetail | null> {
  ensureDiplomatieSync();
  const upper = code.toUpperCase();
  const meta = getDiplomatieMeta(upper);
  if (!meta) return null;

  const row = db.prepare('SELECT * FROM diplomatie_advisories WHERE country_code = ?').get(upper) as DiplomatieRow | undefined;
  if (!row) return null;

  const detail = rowToDetail(row, meta.name);
  return detail.sections.length > 0 ? detail : null;
}
