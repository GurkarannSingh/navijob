/**
 * naukri-import.mjs — turn a pasted Naukri job-alert email (or a list of
 * Naukri links) into pipeline offers. Mirrors lib/linkedin-import.mjs.
 *
 * Reads only the text the candidate pastes. Never logs in to Naukri and never
 * fetches naukri.com.
 *
 * No Node-only APIs (only the global `URL`), so a browser bundle can load it.
 */

export const NAUKRI_IMPORT_MAX_CHARS = 2_000_000;

const EMPTY_MESSAGE = 'No Naukri jobs found. Open a Naukri job alert email, select all, copy, and paste it here.';
const TOO_LARGE_MESSAGE = 'That paste is too large. Paste one alert email.';

// A full URL, or a bare naukri.com link that does not sit inside another URL.
const JOB_LINK = /https?:\/\/[^\s"'<>]+|(?<![\w.\-/%@:=&?#~+])(?:[a-z0-9-]+\.)?naukri\.com\/[^\s"'<>]+/gi;

// Naukri job ids are long digit strings at the end of /job-listings-{slug}-{id}.
const MIN_ID_DIGITS = 9;

/**
 * @param {string} id
 * @returns {string}
 */
export function canonicalNaukriJobUrl(id) {
  return `https://www.naukri.com/job-listings-${id}`;
}

/**
 * The Naukri job id in this URL, or null. The host check is anchored at a
 * label boundary, so "naukri.com.evil.example" never matches.
 *
 * @param {URL} u
 * @returns {string|null}
 */
export function naukriJobId(u) {
  if (!/(^|\.)naukri\.com$/.test(u.hostname)) return null;
  const path = decodeURIComponent(u.pathname);
  const listing = path.match(/\/job-listings-(?:[a-z0-9-]*-)?(\d{9,})\/?$/i);
  if (listing) return listing[1];
  for (const key of ['jobId', 'jobid', 'job_id', 'jdId']) {
    const value = u.searchParams.get(key);
    if (value && new RegExp(`^\\d{${MIN_ID_DIGITS},}$`).test(value)) return value;
  }
  return null;
}

function prepare(text) {
  return text.replace(/=\r?\n/g, '').replace(/=3D/gi, '=').replaceAll('&amp;', '&');
}

function stripTrail(url) {
  return url.replace(/[),.;!?\]]+$/g, '');
}

function toUrl(raw) {
  try {
    return new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
}

/**
 * The id and the slug-bearing URL for one link, following redirect/tracking
 * wrappers through their query values (three levels deep at most).
 */
function resolveLink(raw, depth = 0) {
  if (!raw || depth > 3) return null;
  const url = toUrl(raw);
  if (!url) return null;
  const id = naukriJobId(url);
  if (id) return { id, url };
  for (const value of url.searchParams.values()) {
    const found = resolveLink(value, depth + 1);
    if (found) return found;
  }
  return null;
}

function slugUrl(url, id) {
  const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
  return /\/job-listings-[a-z0-9-]+-\d+$/i.test(path)
    ? `https://www.naukri.com${path}`
    : canonicalNaukriJobUrl(id);
}

function linkMatches(body) {
  const out = [];
  for (const match of body.matchAll(JOB_LINK)) {
    const found = resolveLink(stripTrail(match[0]));
    if (found) out.push({ ...found, index: match.index });
  }
  return out;
}

/**
 * Every Naukri posting in `text`, first-seen order. A link that carries the
 * title slug keeps it (that URL is known to open); otherwise
 * `naukri.com/job-listings-{id}`.
 *
 * @param {string} text
 * @returns {{id: string, url: string}[]}
 */
export function naukriJobsFromText(text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = new Map();
  for (const { id, url } of linkMatches(prepare(text))) {
    const best = slugUrl(url, id);
    if (!seen.has(id)) seen.set(id, best);
    else if (seen.get(id) === canonicalNaukriJobUrl(id)) seen.set(id, best);
  }
  return [...seen].map(([id, url]) => ({ id, url }));
}

// ---------------------------------------------------------------------------
// India-specific field parsing
// ---------------------------------------------------------------------------

const LAKH = 100_000;
const CRORE = 10_000_000;

/**
 * Rupee range from Naukri salary text. "12-18 Lacs PA", "₹ 30-45 LPA",
 * "1-1.5 Cr", "8,00,000 - 12,00,000 P.A." → {min, max, currency: 'INR'}.
 * "Not disclosed" and anything unreadable → null.
 *
 * @param {string} text
 * @returns {{min: number, max: number, currency: 'INR'}|null}
 */
export function parseIndianSalary(text) {
  if (typeof text !== 'string') return null;
  const t = text.replace(/₹|INR|Rs\.?/gi, ' ').replace(/\s+/g, ' ').trim();
  if (!t || /not\s+disclosed/i.test(t)) return null;
  const unit = /\b(cr|crore|crores)\b/i.test(t)
    ? CRORE
    : /\b(lpa|lac|lacs|lakh|lakhs|l)\b/i.test(t) ? LAKH : 1;
  const nums = [...t.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return null;
  const [a, b = a] = nums;
  const min = Math.round(Math.min(a, b) * unit);
  const max = Math.round(Math.max(a, b) * unit);
  // A plain-rupee figure under 50,000 is a monthly stipend or noise; skip it.
  if (unit === 1 && max < 50_000) return null;
  return { min, max, currency: 'INR' };
}

/**
 * Experience label from "5-8 Yrs", "3 to 5 years", "Fresher", "0-1 Yrs".
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseExperience(text) {
  if (typeof text !== 'string') return null;
  if (/\bfreshers?\b/i.test(text)) return 'fresher';
  const range = text.match(/(\d+)\s*(?:-|–|to)\s*(\d+)\s*(?:yrs?|years?)\b/i);
  if (range) return `${range[1]}-${range[2]}`;
  const plus = text.match(/(\d+)\s*\+?\s*(?:yrs?|years?)\b/i);
  return plus ? `${plus[1]}+` : null;
}

export const INDIAN_CITIES = [
  'Bengaluru', 'Bangalore', 'Mumbai', 'Navi Mumbai', 'Thane', 'Pune', 'Hyderabad', 'Secunderabad',
  'Chennai', 'Delhi', 'New Delhi', 'Delhi NCR', 'NCR', 'Gurugram', 'Gurgaon', 'Noida',
  'Greater Noida', 'Ghaziabad', 'Faridabad', 'Kolkata', 'Ahmedabad', 'Gandhinagar', 'Jaipur',
  'Chandigarh', 'Mohali', 'Panchkula', 'Indore', 'Bhopal', 'Lucknow', 'Kanpur', 'Nagpur',
  'Coimbatore', 'Kochi', 'Cochin', 'Thiruvananthapuram', 'Trivandrum', 'Mysuru', 'Mysore',
  'Mangaluru', 'Mangalore', 'Visakhapatnam', 'Vizag', 'Vijayawada', 'Bhubaneswar', 'Surat',
  'Vadodara', 'Nashik', 'Aurangabad', 'Ludhiana', 'Amritsar', 'Dehradun', 'Patna', 'Ranchi',
  'Guwahati', 'Goa', 'Madurai', 'Hubli', 'Raipur',
];

const CITY_PATTERN = new RegExp(
  `\\b(${[...INDIAN_CITIES].sort((a, b) => b.length - a.length).map((c) => c.replace(/ /g, '\\s+')).join('|')})\\b`,
  'gi',
);

/**
 * Location text from a line: the Indian cities it names, plus Remote/Hybrid.
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseLocation(text) {
  if (typeof text !== 'string') return null;
  const cities = [];
  for (const m of text.matchAll(CITY_PATTERN)) {
    const canon = INDIAN_CITIES.find((c) => c.toLowerCase() === m[1].replace(/\s+/g, ' ').toLowerCase());
    if (canon && !cities.includes(canon)) cities.push(canon);
  }
  const mode = /\b(work\s+from\s+home|wfh|remote)\b/i.test(text)
    ? 'Remote'
    : /\bhybrid\b/i.test(text) ? 'Hybrid' : '';
  const parts = [...cities];
  if (mode) parts.push(mode);
  return parts.length ? parts.join(', ') : null;
}

// ---------------------------------------------------------------------------
// Offer fields from the lines around each link
// ---------------------------------------------------------------------------

export const MAX_FIELD_LENGTH = 120;
const MAIL_HEADER = /^(from|to|subject|date|reply-to|cc|bcc|mime-version|content-type)\s*:/i;
const BOILERPLATE = /^(apply|apply now|view job|view and apply|view details|view all|see all jobs|recommended jobs?|jobs? for you|save|share|unsubscribe)\b/i;
const SALARY_LINE = /(₹|\bINR\b|\bRs\.?|\blpa\b|\blacs?\b|\blakhs?\b|\bcr(?:ore)?s?\b|not\s+disclosed|\bP\.?A\.?\b)/i;
const EXP_LINE = /(\d+\s*(?:-|–|to)\s*\d+\s*(?:yrs?|years?)|\bfreshers?\b|\d+\+?\s*(?:yrs?|years?))/i;
const URLISH = /https?:\/\/|naukri\.com\//i;

function bounded(line) {
  return line.length > MAX_FIELD_LENGTH ? `${line.slice(0, MAX_FIELD_LENGTH - 1).trimEnd()}…` : line;
}

function titleFromSlug(url, id) {
  const m = url.match(new RegExp(`/job-listings-([a-z0-9-]+)-${id}$`, 'i'));
  if (!m) return null;
  // Slugs end with "-{city}-{n}-to-{m}-years"; drop that tail.
  const words = m[1].replace(/-\d+-to-\d+-years?$/i, '').split('-').filter(Boolean);
  return words.length ? words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ') : null;
}

/** Lines around one job: the block above its link, or the link's own line. */
function blockFor(lines, lineIndex) {
  const above = [];
  for (let i = lineIndex - 1; i >= 0 && above.length < 7; i--) {
    const line = lines[i].trim();
    if (!line) {
      if (above.length) break;
      continue;
    }
    if (URLISH.test(line) || MAIL_HEADER.test(line)) break;
    if (BOILERPLATE.test(line)) {
      if (above.length) break;
      continue;
    }
    above.push(line);
  }
  above.reverse();
  // "Title layout": the link is the title itself (`Title <url>` or `[Title](url)`)
  // and the details follow below.
  // Brackets go first: `\S*` would otherwise swallow the title word glued to `](`.
  const own = lines[lineIndex].replace(/[[\]()<>]/g, ' ').replace(/https?:\/\/\S+|\S*naukri\.com\/\S+/gi, '').trim();
  if (own && !BOILERPLATE.test(own)) {
    const below = [];
    for (let i = lineIndex + 1; i < lines.length && below.length < 6; i++) {
      const line = lines[i].trim();
      if (!line) {
        if (below.length) break;
        continue;
      }
      if (URLISH.test(line) || BOILERPLATE.test(line)) break;
      below.push(line);
    }
    return [own, ...below];
  }
  return above;
}

function fieldsFromBlock(block) {
  const text = [];
  let salary = null;
  let years = null;
  let location = null;
  for (const raw of block) {
    // A line can pack several details: "5-8 Yrs | 12-18 Lacs PA | Pune".
    const parts = raw.split(/\s*[|•·]\s*/).filter(Boolean);
    const rest = [];
    for (const part of parts) {
      if (!salary && SALARY_LINE.test(part) && /\d|not\s+disclosed/i.test(part)) {
        salary = parseIndianSalary(part) ?? salary;
        continue;
      }
      if (!years && EXP_LINE.test(part)) {
        years = parseExperience(part);
        continue;
      }
      const loc = parseLocation(part);
      if (!location && loc && part.length < 80) {
        location = loc;
        continue;
      }
      rest.push(part);
    }
    if (rest.length) text.push(rest.join(' '));
  }
  return { text, salary, years, location };
}

function lineIndexById(lines) {
  const index = new Map();
  for (let i = 0; i < lines.length; i++) {
    for (const { id } of linkMatches(lines[i])) if (!index.has(id)) index.set(id, i);
  }
  return index;
}

/**
 * Pipeline offers for parsed jobs: title, company, location, salary (INR),
 * and years of experience, read from the alert text around each link.
 *
 * @param {{id: string, url: string}[]} jobs
 * @param {string} text
 */
export function naukriOffers(jobs, text = '') {
  const body = typeof text === 'string' ? prepare(text) : '';
  const lines = body.split(/\r?\n/);
  const lineOf = lineIndexById(lines);
  return jobs.map((job) => {
    const at = lineOf.has(job.id) ? lineOf.get(job.id) : -1;
    const { text: useful, salary, years, location } = at >= 0
      ? fieldsFromBlock(blockFor(lines, at))
      : { text: [], salary: null, years: null, location: null };
    const title = useful[0] ? bounded(useful[0]) : (titleFromSlug(job.url, job.id) || 'Job alert');
    const company = useful[1] ? bounded(useful[1]) : 'Naukri';
    return {
      url: job.url,
      company,
      title,
      location: location ? bounded(location) : '',
      ...(salary ? { salary } : {}),
      ...(years ? { years: { label: years } } : {}),
      source: 'naukri-import',
    };
  });
}

// ---------------------------------------------------------------------------
// Import plan
// ---------------------------------------------------------------------------

export function naukriImportMessage({ added, already, found, dryRun = false }) {
  if (found === 0) return EMPTY_MESSAGE;
  if (dryRun && added > 0) {
    return added === 1 ? '1 Naukri job found. Nothing was saved.' : `${added} Naukri jobs found. Nothing was saved.`;
  }
  if (added === 0) {
    return already === 1 ? 'That Naukri job is already in your list.' : `Those ${already} Naukri jobs are already in your list.`;
  }
  const addedLine = added === 1
    ? '1 Naukri job added. Open Pipeline to review it.'
    : `${added} Naukri jobs added. Open Pipeline to review them.`;
  if (already === 0) return addedLine;
  return `${addedLine} ${already === 1 ? '1 was already in your list' : `${already} were already in your list`}.`;
}

/**
 * @param {string} text Alert email, a list of URLs, or a saved .eml.
 * @param {string} seenText pipeline.md and applications.md, concatenated.
 * @param {{dryRun?: boolean}} [options]
 */
export function planNaukriImport(text, seenText, { dryRun = false } = {}) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { found: 0, added: [], already: [], message: EMPTY_MESSAGE };
  }
  if (text.length > NAUKRI_IMPORT_MAX_CHARS) {
    return { found: 0, added: [], already: [], error: 'too-large', message: TOO_LARGE_MESSAGE };
  }
  const jobs = naukriJobsFromText(text);
  const seen = new Set(naukriJobsFromText(typeof seenText === 'string' ? seenText : '').map((j) => j.id));
  const added = [];
  const already = [];
  for (const job of jobs) (seen.has(job.id) ? already : added).push(job);
  return {
    found: jobs.length,
    added,
    already,
    message: naukriImportMessage({ added: added.length, already: already.length, found: jobs.length, dryRun }),
  };
}
