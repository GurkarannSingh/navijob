/**
 * hiring-pulse.mjs — per-company hiring activity in the candidate's region,
 * read from data/scan-history.tsv.
 *
 * Nobody publishes whether a company actually hired. What the scan history
 * does show is how each company POSTS in the cities the candidate wants:
 * how many postings, how recent they are, how many are months old, and which
 * roles were re-listed under a new link. Those are signals, not proof: an old
 * posting can be an evergreen role, and a busy board can still be slow to
 * hire. The labels say "possible", never "fake".
 *
 * Pure functions only (no file or network access), so tests drive them.
 */

export const FRESH_DAYS = 30;
export const STALE_DAYS = 90;

/** Statuses that describe a real posting the scanner saw on the board. */
const SEEN_STATUSES = new Set(['added', 'skipped_title', 'skipped_age', 'skipped_experience', 'skipped_content']);

const DAY_MS = 86_400_000;

/**
 * @param {string} value YYYY-MM-DD or ISO timestamp
 * @returns {Date|null}
 */
export function parseDay(value) {
  const m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A matcher for the candidate's cities: case-insensitive, word-bounded, so
 * "Pune" never matches "Punekar Ltd" and "Bangalore" matches "Bangalore, India".
 *
 * @param {string[]} cities
 * @returns {(location: string) => boolean}
 */
export function regionMatcher(cities) {
  const list = (cities || []).map((c) => String(c).trim()).filter(Boolean);
  if (!list.length) return () => true;
  const re = new RegExp(`(?<![a-z])(?:${list.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![a-z])`, 'i');
  return (location) => re.test(String(location || ''));
}

function companyKeyOf(row) {
  return String(row.normalized_company || row.company || '').trim().toLowerCase();
}

/**
 * @param {{company: string, repostCount: number, role: string}[]} reposts
 */
function repostIndex(reposts) {
  const byCompany = new Map();
  const byUrl = new Map();
  for (const r of reposts || []) {
    const key = String(r.company || '').trim().toLowerCase();
    byCompany.set(key, (byCompany.get(key) || 0) + 1);
    for (const a of r.appearances || []) byUrl.set(a.url, r.repostCount);
  }
  return { byCompany, byUrl };
}

/**
 * The signal for one company's numbers.
 *
 * - active: at least 2 postings from the last 30 days, or 30%+ of dated
 *   postings are that recent.
 * - possible_ghost: no posting from the last 30 days, and either 60%+ of dated
 *   postings are 90+ days old, or 2+ roles were re-listed.
 * - undated: postings in the region, but the board publishes no dates.
 * - mixed: anything else with postings in the region.
 * - none: no postings in the region.
 */
export function pulseSignal({ inRegion, dated, fresh, stale, reposts }) {
  if (inRegion === 0) return 'none';
  // Some boards (Rippling, Atlassian) publish no posting dates: say so
  // instead of guessing.
  if (dated === 0) return reposts >= 2 ? 'possible_ghost' : 'undated';
  if (fresh >= 2 || (dated > 0 && fresh / dated >= 0.3)) return 'active';
  if (fresh === 0 && ((dated >= 2 && stale / dated >= 0.6) || reposts >= 2)) return 'possible_ghost';
  return 'mixed';
}

export const SIGNAL_LABEL = {
  active: '🟢 active',
  mixed: '🟡 mixed',
  possible_ghost: '🔴 possible ghost postings',
  undated: '⚪ no posting dates',
  none: '— none in your cities',
};

/**
 * @param {object[]} rows parsed scan-history rows (url, company, status, location, posted_at, normalized_company)
 * @param {{cities?: string[], today?: Date, reposts?: object[]}} options
 * @returns {{company: string, inRegion: number, dated: number, fresh: number, stale: number, oldestDays: number|null, newestDays: number|null, medianDays: number|null, reposts: number, expired: number, signal: string}[]}
 */
export function companyPulse(rows, { cities = [], today = new Date(), reposts = [] } = {}) {
  const inCity = regionMatcher(cities);
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const { byCompany } = repostIndex(reposts);
  const companies = new Map();
  for (const row of rows || []) {
    const key = companyKeyOf(row);
    if (!key) continue;
    if (!companies.has(key)) {
      companies.set(key, { company: String(row.company || '').trim(), urls: new Set(), ages: [], expired: 0 });
    }
    const c = companies.get(key);
    if (row.status === 'skipped_expired') {
      c.expired += 1;
      continue;
    }
    if (!SEEN_STATUSES.has(row.status) || !inCity(row.location)) continue;
    if (c.urls.has(row.url)) continue;
    c.urls.add(row.url);
    const posted = parseDay(row.posted_at);
    if (posted) c.ages.push(Math.max(0, Math.round((now - posted.getTime()) / DAY_MS)));
  }
  const out = [];
  for (const [key, c] of companies) {
    const ages = [...c.ages].sort((a, b) => a - b);
    const stats = {
      company: c.company,
      inRegion: c.urls.size,
      dated: ages.length,
      fresh: ages.filter((a) => a <= FRESH_DAYS).length,
      stale: ages.filter((a) => a > STALE_DAYS).length,
      oldestDays: ages.length ? ages[ages.length - 1] : null,
      newestDays: ages.length ? ages[0] : null,
      medianDays: ages.length ? ages[Math.floor((ages.length - 1) / 2)] : null,
      reposts: byCompany.get(key) || byCompany.get(c.company.toLowerCase()) || 0,
      expired: c.expired,
    };
    out.push({ ...stats, signal: pulseSignal(stats) });
  }
  const order = { active: 0, mixed: 1, undated: 2, possible_ghost: 3, none: 4 };
  return out.sort((a, b) => order[a.signal] - order[b.signal] || b.fresh - a.fresh || b.inRegion - a.inRegion || a.company.localeCompare(b.company));
}

/**
 * Warning flags for one posting: its own age, whether it was re-listed, and
 * its company's signal.
 *
 * @param {{url: string, company: string}} job
 * @param {object[]} rows
 * @param {ReturnType<typeof companyPulse>} pulse
 * @param {{today?: Date, reposts?: object[]}} options
 * @returns {string[]}
 */
export function jobFlags(job, rows, pulse, { today = new Date(), reposts = [] } = {}) {
  const flags = [];
  const row = (rows || []).find((r) => r.url === job.url);
  const posted = row ? parseDay(row.posted_at) : null;
  if (posted) {
    const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const age = Math.round((now - posted.getTime()) / DAY_MS);
    if (age > STALE_DAYS) flags.push(`open ${age} days`);
  }
  const reposted = repostIndex(reposts).byUrl.get(job.url);
  if (reposted) flags.push(`re-listed ${reposted}×`);
  const company = pulse.find((p) => p.company.toLowerCase() === String(job.company || '').trim().toLowerCase());
  if (company?.signal === 'possible_ghost') flags.push('company: possible ghost postings');
  return flags;
}
