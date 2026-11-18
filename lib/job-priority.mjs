/**
 * job-priority.mjs — one ordered list of open jobs, from signals already on
 * disk: the evaluation score when a job has one, the company's hiring pulse,
 * recent funding, and the posting's own age and warnings. Pure functions.
 *
 * Order:
 *   1. "apply": evaluated at 4.0 or above, highest score first.
 *   2. "evaluate next": not evaluated yet, highest priority points first.
 *   3. "below bar": evaluated under 4.0, highest score first.
 *
 * Priority points (only for ordering unevaluated jobs, never a fit score):
 *   company hiring signal  active +3 · mixed / no dates +2 · none +1 · possible ghost 0
 *   company raised funding in the window  +1
 *   posted in the last 14 days            +1
 *   each warning (open 90+ days, re-listed)  -1
 */

import { parseDay } from './hiring-pulse.mjs';

export const APPLY_MIN = 4.0;
export const FRESH_POST_DAYS = 14;

const SIGNAL_POINTS = { active: 3, mixed: 2, undated: 2, none: 1, possible_ghost: 0 };
const DAY_MS = 86_400_000;

/** Company names as they appear across boards, trackers and news. */
export function normalizeCompany(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|inc|llc|technologies|technology|india|global|services|solutions|consolidated|support)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

/** Score in a pipeline "Processed" line: `- [x] #001 | url | Company | Role | 3.6/5 | …`. */
export function evaluatedFromPipeline(text) {
  const out = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^- \[x\] #(\d+) \| (\S+) \| ([^|]*)\| ([^|]*)\| ([\d.]+)\/5/);
    if (m) out.set(m[2], { report: m[1], company: m[3].trim(), title: m[4].trim(), score: Number(m[5]) });
  }
  return out;
}

/**
 * @param {{companies?: {company: string, amount?: string, round?: string, funding?: {sources?: {observed_date?: string}[]}}[]}} fundingJson
 * @returns {Map<string, {company: string, amount: string, round: string, date: string}>}
 */
export function fundingIndex(fundingJson) {
  const out = new Map();
  for (const c of fundingJson?.companies || []) {
    const key = normalizeCompany(c.company);
    if (!key) continue;
    const date = (c.funding?.sources || []).map((s) => s.observed_date).filter(Boolean).sort().pop() || '';
    out.set(key, { company: c.company, amount: c.amount || '', round: c.round || '', date });
  }
  return out;
}

/**
 * @param {{url: string, company: string, title: string}[]} pending
 * @param {object} ctx
 * @param {Map<string, {score: number, report: string, company: string, title: string}>} ctx.evaluated
 * @param {{company: string, signal: string}[]} ctx.pulse
 * @param {Map<string, object>} ctx.funding
 * @param {object[]} ctx.rows scan-history rows (url, posted_at)
 * @param {(job: object) => string[]} ctx.flagsFor warnings for one job
 * @param {Date} [ctx.today]
 */
export function rankJobs(pending, { evaluated = new Map(), pulse = [], funding = new Map(), rows = [], flagsFor = () => [], today = new Date() } = {}) {
  const now = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const pulseBy = new Map(pulse.map((p) => [normalizeCompany(p.company), p]));
  const postedBy = new Map(rows.filter((r) => r.posted_at).map((r) => [r.url, parseDay(r.posted_at)]));

  const jobs = [...pending.map((j) => ({ ...j, score: null, report: null }))];
  for (const [url, e] of evaluated) {
    if (!jobs.some((j) => j.url === url)) jobs.push({ url, company: e.company, title: e.title, score: e.score, report: e.report });
    else Object.assign(jobs.find((j) => j.url === url), { score: e.score, report: e.report });
  }

  const ranked = jobs.map((job) => {
    const key = normalizeCompany(job.company);
    const why = [];
    const signal = pulseBy.get(key)?.signal || 'none';
    let points = SIGNAL_POINTS[signal] ?? 1;
    why.push({ active: 'company hiring actively', mixed: 'company hiring (mixed)', undated: 'board has no dates', none: 'no other postings seen', possible_ghost: 'company: possible ghost postings' }[signal]);
    const funded = funding.get(key);
    if (funded) {
      points += 1;
      why.push(`raised ${[funded.amount, funded.round].filter(Boolean).join(' ') || 'funding'}${funded.date ? ` (${funded.date})` : ''}`);
    }
    const posted = postedBy.get(job.url);
    const ageDays = posted ? Math.round((now - posted.getTime()) / DAY_MS) : null;
    if (ageDays != null && ageDays <= FRESH_POST_DAYS) {
      points += 1;
      why.push(`posted ${ageDays}d ago`);
    }
    const flags = flagsFor(job);
    points -= flags.length;
    why.push(...flags);
    const tier = job.score == null ? 'evaluate next' : job.score >= APPLY_MIN ? 'apply' : 'below bar';
    return { ...job, tier, points, signal, ageDays, funded: Boolean(funded), why };
  });

  const tierOrder = { apply: 0, 'evaluate next': 1, 'below bar': 2 };
  return ranked.sort((a, b) =>
    tierOrder[a.tier] - tierOrder[b.tier]
    || (b.score ?? 0) - (a.score ?? 0)
    || b.points - a.points
    || (a.ageDays ?? 9999) - (b.ageDays ?? 9999)
    || a.company.localeCompare(b.company));
}
