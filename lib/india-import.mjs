/**
 * india-import.mjs — turn a pasted job-alert email (or a list of links) from
 * Indian job sites into pipeline offers: Naukri, Instahyre, Cutshort,
 * Foundit, IIMJobs and Hirist. Mirrors lib/linkedin-import.mjs.
 *
 * Reads only the text the candidate pastes. Never logs in to, and never
 * fetches, any of these sites.
 *
 * No Node-only APIs (only the global `URL`), so a browser bundle can load it.
 */

import { parseExperience, parseIndianSalary, parseLocation } from './india-fields.mjs';

export const INDIA_IMPORT_MAX_CHARS = 2_000_000;

const TOO_LARGE_MESSAGE = 'That paste is too large. Paste one alert email.';

function titleCase(words) {
  return words.filter(Boolean).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Slugs often end with "-{n}-to-{m}-years" or "-{n}-{m}-yrs"; that tail is not the title.
function trimYears(slug) {
  return slug.replace(/-\d+-(?:to-)?\d+-(?:years?|yrs?)$/i, '').replace(/^-+|-+$/g, '');
}

/**
 * One entry per site. `match(url)` returns `{id, url, slugTitle}` for a job
 * page on that site, or null. `id` is unique within the site; dedup keys are
 * `{site}:{id}`. Path shapes were checked against live listings (2026-11).
 */
export const INDIA_SITES = [
  {
    site: 'naukri',
    label: 'Naukri',
    host: /(^|\.)naukri\.com$/,
    match(u) {
      const path = decodeURIComponent(u.pathname).replace(/\/$/, '');
      const m = path.match(/^\/job-listings-(?:([a-z0-9-]*)-)?(\d{9,})$/i);
      if (m) {
        return {
          id: m[2],
          url: m[1] ? `https://www.naukri.com${path}` : `https://www.naukri.com/job-listings-${m[2]}`,
          slugTitle: m[1] ? titleCase(trimYears(m[1]).split('-')) : null,
        };
      }
      // Alert deep link (2026-11): /aurus/job-{8 letters}-{12-digit id}. The
      // letters look per-recipient (the mail says its links auto-login), so
      // only the id is kept. Naukri ids start with the posting date, DDMMYY.
      const aurus = path.match(/^\/aurus\/job-[A-Za-z]+-(\d{12})$/);
      if (aurus) return { id: aurus[1], url: `https://www.naukri.com/job-listings-${aurus[1]}`, slugTitle: null };
      for (const key of ['jobId', 'jobid', 'job_id', 'jdId']) {
        const v = u.searchParams.get(key);
        if (v && /^\d{9,}$/.test(v)) return { id: v, url: `https://www.naukri.com/job-listings-${v}`, slugTitle: null };
      }
      return null;
    },
  },
  {
    // /job-{id}-{title}-at-{company}[-{city}]/
    site: 'instahyre',
    label: 'Instahyre',
    host: /(^|\.)instahyre\.com$/,
    match(u) {
      const m = u.pathname.match(/^\/job-(\d{3,})-([a-z0-9-]+?)\/?$/i);
      if (!m) return null;
      const [title] = m[2].split(/-at-/i);
      return { id: m[1], url: `https://www.instahyre.com/job-${m[1]}-${m[2]}/`, slugTitle: titleCase(title.split('-')) };
    },
  },
  {
    // /job/{Title-Words-Company}-{8-character code}. The code is case-sensitive.
    site: 'cutshort',
    label: 'Cutshort',
    host: /(^|\.)cutshort\.io$/,
    match(u) {
      const m = u.pathname.match(/^\/job\/([A-Za-z0-9-]+)-([A-Za-z0-9]{8})\/?$/);
      if (!m || !/\d|[A-Z].*[a-z]|[a-z].*[A-Z]/.test(m[2])) return null;
      return { id: m[2], url: `https://cutshort.io/job/${m[1]}-${m[2]}`, slugTitle: m[1].split('-').join(' ') };
    },
  },
  {
    // /job/{title-company-city}-{id}
    site: 'foundit',
    label: 'Foundit',
    host: /(^|\.)foundit\.in$/,
    match(u) {
      const m = u.pathname.match(/^\/job\/([a-z0-9-]+)-(\d{6,})\/?$/i);
      if (!m) return null;
      return { id: m[2], url: `https://www.foundit.in/job/${m[1]}-${m[2]}`, slugTitle: titleCase(m[1].split('-')) };
    },
  },
  {
    // /j/{title}-{id}, sometimes with ".html" and a "-{n}-{m}-yrs" tail.
    site: 'iimjobs',
    label: 'IIMJobs',
    host: /(^|\.)iimjobs\.com$/,
    match(u) {
      const m = u.pathname.match(/^\/j\/([a-z0-9-]*?)-?(\d{6,})(?:\.html)?\/?$/i);
      if (!m) return null;
      // Keep the slug as the site writes it ("-net-core-..." keeps its hyphen).
      const slug = m[1];
      return {
        id: m[2],
        url: `https://www.iimjobs.com/j/${slug ? `${slug}-` : ''}${m[2]}`,
        slugTitle: slug.replace(/^-+/, '') ? titleCase(trimYears(slug).split('-')) : null,
      };
    },
  },
  {
    // Same platform as IIMJobs: /j/{title}-{id}. hirist.com is the older host.
    site: 'hirist',
    label: 'Hirist',
    host: /(^|\.)hirist\.(tech|com)$/,
    match(u) {
      const m = u.pathname.match(/^\/j\/([a-z0-9-]*?)-?(\d{6,})(?:\.html)?\/?$/i);
      if (!m) return null;
      const slug = m[1];
      return {
        id: m[2],
        url: `https://www.hirist.tech/j/${slug ? `${slug}-` : ''}${m[2]}`,
        slugTitle: slug.replace(/^-+/, '') ? titleCase(trimYears(slug).split('-')) : null,
      };
    },
  },
];

const SITE_BY_NAME = new Map(INDIA_SITES.map((s) => [s.site, s]));
const HOSTS = 'naukri\\.com|instahyre\\.com|cutshort\\.io|foundit\\.in|iimjobs\\.com|hirist\\.(?:tech|com)';

// A full URL, or a bare site link that does not sit inside another URL.
const JOB_LINK = new RegExp(
  String.raw`https?:\/\/[^\s"'<>]+|(?<![\w.\-/%@:=&?#~+])(?:[a-z0-9-]+\.)?(?:${HOSTS})\/[^\s"'<>]+`,
  'gi',
);
const URLISH = new RegExp(String.raw`https?:\/\/|(?:${HOSTS})\/`, 'i');
const URL_STRIP = new RegExp(String.raw`https?:\/\/\S+|\S*(?:${HOSTS})\/\S+`, 'gi');

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
 * The job a URL points at, following redirect/tracking wrappers through their
 * query values (three levels deep at most). Host checks are anchored at a label
 * boundary, so "naukri.com.evil.example" never matches.
 *
 * @param {string} raw
 * @param {{sites?: Set<string>}} [opts]
 * @returns {{site: string, id: string, url: string, slugTitle: string|null}|null}
 */
export function indiaJobFromUrl(raw, { sites } = {}, depth = 0) {
  if (!raw || depth > 3) return null;
  const url = toUrl(raw);
  if (!url) return null;
  for (const spec of INDIA_SITES) {
    if (sites && !sites.has(spec.site)) continue;
    if (!spec.host.test(url.hostname)) continue;
    let found = null;
    try {
      found = spec.match(url);
    } catch {
      found = null;
    }
    if (found) return { site: spec.site, ...found };
  }
  // Click trackers that carry the target in the path, not the query:
  // click4.instahyre.com/CL0/https:%2F%2Fwww.instahyre.com%2Fjob-...%2F/2/{id}/{sig}
  // The target's own slashes are %2F, so it ends at the next literal "/".
  const inPath = url.pathname.match(/\/(https?:(?:%2F|\/){2}[^/]+)/i);
  if (inPath) {
    let target = null;
    try {
      target = decodeURIComponent(inPath[1]);
    } catch {
      target = null;
    }
    const found = indiaJobFromUrl(target, { sites }, depth + 1);
    if (found) return found;
  }
  for (const value of url.searchParams.values()) {
    const found = indiaJobFromUrl(value, { sites }, depth + 1);
    if (found) return found;
  }
  return null;
}

function linkMatches(body, opts) {
  const out = [];
  for (const match of body.matchAll(JOB_LINK)) {
    const found = indiaJobFromUrl(stripTrail(match[0]), opts);
    if (found) out.push(found);
  }
  return out;
}

const keyOf = (job) => `${job.site}:${job.id}`;

/**
 * Every Indian job-site posting in `text`, first-seen order, once each.
 * A link carrying the title slug wins over a bare-id link for the same job.
 *
 * @param {string} text
 * @param {{sites?: Set<string>}} [opts] Limit to these site names.
 * @returns {{site: string, id: string, url: string}[]}
 */
export function indiaJobsFromText(text, opts = {}) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const seen = new Map();
  for (const job of linkMatches(prepare(text), opts)) {
    const key = keyOf(job);
    const prev = seen.get(key);
    if (!prev || (!prev.slugTitle && job.slugTitle)) seen.set(key, job);
  }
  return [...seen.values()].map(({ site, id, url }) => ({ site, id, url }));
}

// ---------------------------------------------------------------------------
// Offer fields from the lines around each link
// ---------------------------------------------------------------------------

export const MAX_FIELD_LENGTH = 120;
const MAIL_HEADER = /^(from|to|subject|date|reply-to|cc|bcc|mime-version|content-type)\s*:/i;
const BOILERPLATE = /^(apply|apply now|view job|view\s*(?:&|and)\s*apply|view details|view all|see all jobs|recommended jobs?|jobs? for you|save|share|unsubscribe|interested\??|not interested)\b/i;
const SALARY_LINE = /(₹|\bINR\b|\bRs\.?|\blpa\b|\blacs?\b|\blakhs?\b|\bcr(?:ore)?s?\b|not\s+disclosed|\bP\.?A\.?\b)/i;
const EXP_LINE = /(\d+\s*(?:-|–|to)\s*\d+\s*(?:yrs?|years?)|\bfreshers?\b|\d+\+?\s*(?:yrs?|years?))/i;

function bounded(line) {
  return line.length > MAX_FIELD_LENGTH ? `${line.slice(0, MAX_FIELD_LENGTH - 1).trimEnd()}…` : line;
}

const RATING = /^\d(?:\.\d)?\s*(?:★|\/\s*5)?$/;

function companyAcrossGap(lines, from) {
  for (let i = from, seen = 0; i >= 0 && seen < 4; i--) {
    const line = lines[i].trim();
    if (!line || RATING.test(line)) continue;
    seen++;
    if (URLISH.test(line) || MAIL_HEADER.test(line) || BOILERPLATE.test(line)) return null;
    if (SALARY_LINE.test(line) || EXP_LINE.test(line)) return null;
    return line;
  }
  return null;
}

/** Lines around one job: the block above its link, or the link's own line and what follows. */
function blockFor(lines, lineIndex) {
  const above = [];
  let gapAt = -1;
  for (let i = lineIndex - 1; i >= 0 && above.length < 7; i--) {
    const line = lines[i].trim();
    if (!line) {
      if (above.length) {
        gapAt = i;
        break;
      }
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
  // Card layout (Naukri's own alerts): the company and its star rating sit in
  // a header above the title, across a blank line. Keep it as a fallback for
  // when the block itself names no company.
  if (gapAt >= 0) above.companyAbove = companyAcrossGap(lines, gapAt);
  // Title layout: the link is the title (`Title <url>` or `[Title](url)`),
  // details below. Brackets go first: `\S*` would otherwise swallow the title
  // word glued to `](`.
  const own = lines[lineIndex].replace(/[[\]()<>]/g, ' ').replace(URL_STRIP, '').trim();
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
  // Card header: "{company}" then its star rating ("3.6") right above the
  // title, with no blank line between them (as an HTML alert flattens). The
  // line before the rating is the company, the details follow the rating, and
  // anything above the company (a greeting, the previous card) is not this job.
  const rating = block.findIndex((line) => RATING.test(line.trim()));
  let cardCompany = null;
  if (rating > 0) {
    cardCompany = block[rating - 1];
    block = block.slice(rating + 1);
  }
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
  if (cardCompany && text.length) text.splice(1, 0, cardCompany);
  return { text, salary, years, location };
}

function lineIndexByKey(lines, opts) {
  const index = new Map();
  for (let i = 0; i < lines.length; i++) {
    if (!URLISH.test(lines[i])) continue;
    for (const job of linkMatches(lines[i], opts)) {
      const key = keyOf(job);
      if (!index.has(key)) index.set(key, { line: i, slugTitle: job.slugTitle });
    }
  }
  return index;
}

/**
 * Pipeline offers for parsed jobs: title, company, location, salary (INR) and
 * years of experience, read from the alert text around each link. With no
 * text around a link, the title comes from the link's own words and the
 * company is the site's name.
 *
 * @param {{site: string, id: string, url: string}[]} jobs
 * @param {string} text
 */
export function indiaOffers(jobs, text = '') {
  const body = typeof text === 'string' ? prepare(text) : '';
  const lines = body.split(/\r?\n/);
  const at = lineIndexByKey(lines, {});
  return jobs.map((job) => {
    const spec = SITE_BY_NAME.get(job.site);
    const hit = at.get(keyOf(job));
    const block = hit ? blockFor(lines, hit.line) : [];
    const { text: useful, salary, years, location } = hit
      ? fieldsFromBlock(block)
      : { text: [], salary: null, years: null, location: null };
    if (useful.length === 1 && block.companyAbove) useful.push(block.companyAbove);
    const slugTitle = hit?.slugTitle ?? indiaJobFromUrl(job.url)?.slugTitle ?? null;
    return {
      url: job.url,
      company: useful[1] ? bounded(useful[1]) : (spec?.label ?? job.site),
      title: useful[0] ? bounded(useful[0]) : (slugTitle ? bounded(slugTitle) : 'Job alert'),
      location: location ? bounded(location) : '',
      ...(salary ? { salary } : {}),
      ...(years ? { years: { label: years } } : {}),
      source: `${job.site}-import`,
    };
  });
}

// ---------------------------------------------------------------------------
// Import plan
// ---------------------------------------------------------------------------

function siteList(jobs) {
  const names = [];
  for (const job of jobs) {
    const label = SITE_BY_NAME.get(job.site)?.label ?? job.site;
    if (!names.includes(label)) names.push(label);
  }
  return names.join(', ');
}

/**
 * @param {{added: {site: string}[], already: {site: string}[], found: number, dryRun?: boolean, siteLabel?: string}} p
 */
export function indiaImportMessage({ added, already, found, dryRun = false, siteLabel = '' }) {
  const noun = siteLabel ? `${siteLabel} job` : 'job';
  if (found === 0) {
    const lead = siteLabel
      ? `No ${siteLabel} job links found.`
      : 'No job links from Naukri, Instahyre, Cutshort, Foundit, IIMJobs or Hirist found.';
    return `${lead} Copying an email from Gmail or Outlook in the browser often drops its links. Download the email instead (Gmail: ⋮ → Download message) and run with --file, or paste the job links themselves.`;
  }
  const from = siteLabel ? '' : ` (${siteList(added.length ? added : already)})`;
  if (dryRun && added.length > 0) {
    return `${added.length} ${noun}${added.length === 1 ? '' : 's'} found${from}. Nothing was saved.`;
  }
  if (added.length === 0) {
    return already.length === 1
      ? `That ${noun} is already in your list.`
      : `Those ${already.length} ${noun}s are already in your list.`;
  }
  const addedLine = added.length === 1
    ? `1 ${noun} added${from}. Open Pipeline to review it.`
    : `${added.length} ${noun}s added${from}. Open Pipeline to review them.`;
  if (already.length === 0) return addedLine;
  return `${addedLine} ${already.length === 1 ? '1 was already in your list' : `${already.length} were already in your list`}.`;
}

/**
 * @param {string} text Alert email, a list of URLs, or a saved .eml.
 * @param {string} seenText pipeline.md and applications.md, concatenated.
 * @param {{dryRun?: boolean, sites?: Set<string>, siteLabel?: string}} [options]
 */
export function planIndiaImport(text, seenText, { dryRun = false, sites, siteLabel = '' } = {}) {
  const empty = { found: 0, added: [], already: [] };
  if (typeof text !== 'string' || text.trim() === '') {
    return { ...empty, message: indiaImportMessage({ ...empty, siteLabel }) };
  }
  if (text.length > INDIA_IMPORT_MAX_CHARS) {
    return { ...empty, error: 'too-large', message: TOO_LARGE_MESSAGE };
  }
  const jobs = indiaJobsFromText(text, { sites });
  const seen = new Set(indiaJobsFromText(typeof seenText === 'string' ? seenText : '').map(keyOf));
  const added = [];
  const already = [];
  for (const job of jobs) (seen.has(keyOf(job)) ? already : added).push(job);
  return {
    found: jobs.length,
    added,
    already,
    message: indiaImportMessage({ added, already, found: jobs.length, dryRun, siteLabel }),
  };
}
