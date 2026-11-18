/**
 * naukri-import.mjs — Naukri-only view of lib/india-import.mjs, kept for
 * `node naukri-import.mjs` and its callers. The parsing lives in
 * india-import.mjs (links, alert layouts) and india-fields.mjs (LPA / Cr
 * salary, experience, Indian cities).
 *
 * Reads only the text the candidate pastes. Never logs in to Naukri and never
 * fetches naukri.com.
 */

import {
  INDIA_IMPORT_MAX_CHARS,
  INDIA_SITES,
  MAX_FIELD_LENGTH,
  indiaJobsFromText,
  indiaOffers,
  planIndiaImport,
} from './india-import.mjs';

export { parseExperience, parseIndianSalary, parseLocation, INDIAN_CITIES } from './india-fields.mjs';
export { MAX_FIELD_LENGTH };

export const NAUKRI_IMPORT_MAX_CHARS = INDIA_IMPORT_MAX_CHARS;

const NAUKRI = new Set(['naukri']);
const naukriSpec = INDIA_SITES.find((s) => s.site === 'naukri');

/**
 * @param {string} id
 * @returns {string}
 */
export function canonicalNaukriJobUrl(id) {
  return `https://www.naukri.com/job-listings-${id}`;
}

/**
 * The Naukri job id in this URL, or null.
 *
 * @param {URL} u
 * @returns {string|null}
 */
export function naukriJobId(u) {
  if (!naukriSpec.host.test(u.hostname)) return null;
  return naukriSpec.match(u)?.id ?? null;
}

/**
 * @param {string} text
 * @returns {{id: string, url: string}[]}
 */
export function naukriJobsFromText(text) {
  return indiaJobsFromText(text, { sites: NAUKRI }).map(({ id, url }) => ({ id, url }));
}

/**
 * @param {{id: string, url: string}[]} jobs
 * @param {string} text
 */
export function naukriOffers(jobs, text = '') {
  return indiaOffers(jobs.map((job) => ({ site: 'naukri', ...job })), text);
}

/**
 * @param {string} text
 * @param {string} seenText
 * @param {{dryRun?: boolean}} [options]
 */
export function planNaukriImport(text, seenText, { dryRun = false } = {}) {
  const plan = planIndiaImport(text, seenText, { dryRun, sites: NAUKRI, siteLabel: 'Naukri' });
  const strip = (jobs) => jobs.map(({ id, url }) => ({ id, url }));
  return { ...plan, added: strip(plan.added), already: strip(plan.already) };
}
