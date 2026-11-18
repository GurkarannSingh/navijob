#!/usr/bin/env node
/**
 * hiring-pulse.mjs — which companies are really hiring in your cities, and
 * which postings look like ghost jobs. Zero network, zero tokens: it reads
 * data/scan-history.tsv (every posting the scanners saw, with its posting
 * date), your cities from portals.yml location_filter, and data/pipeline.md.
 *
 *   node hiring-pulse.mjs              Company table (companies with postings in your cities)
 *   node hiring-pulse.mjs --all        Include companies with none in your cities
 *   node hiring-pulse.mjs --pending    Also flag pending jobs in data/pipeline.md
 *   node hiring-pulse.mjs --company Stripe
 *   node hiring-pulse.mjs --json
 *
 * Signals are about how a company POSTS, not whether it hired: see
 * lib/hiring-pulse.mjs.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { loadYaml } from './lib/yaml-document.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { detectReposts, parseScanHistory } from './detect-reposts.mjs';
import { parsedScanHistory } from './lib/scan-history-columns.mjs';
import { companyPulse, jobFlags, SIGNAL_LABEL, FRESH_DAYS, STALE_DAYS } from './lib/hiring-pulse.mjs';

const USAGE = `Which companies are really hiring in your cities, and which postings look like ghost jobs.

  node hiring-pulse.mjs              Companies with postings in your cities
  node hiring-pulse.mjs --all        Include companies with none in your cities
  node hiring-pulse.mjs --pending    Also flag pending jobs in data/pipeline.md
  node hiring-pulse.mjs --company <name>
  node hiring-pulse.mjs --json

Reads data/scan-history.tsv, portals.yml (location_filter) and data/pipeline.md.
No network. Signals describe how a company posts, not whether it hired.
`;

function readIf(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

export function citiesFromPortals(text) {
  const doc = loadYaml(text) || {};
  const lf = doc.location_filter || {};
  return [...new Set([...(lf.allow || []), ...(lf.always_allow || [])].map(String))];
}

export function pendingJobs(pipelineText) {
  const jobs = [];
  for (const line of String(pipelineText || '').split('\n')) {
    const m = line.match(/^- \[ \] (\S+)(?:\s*\|\s*([^|]*))?(?:\s*\|\s*([^|]*))?/);
    if (m) jobs.push({ url: m[1], company: (m[2] || '').trim(), title: (m[3] || '').trim() });
  }
  return jobs;
}

const age = (d) => (d == null ? '—' : `${d}d`);

function companyTable(pulse) {
  const lines = [
    `| Company | Signal | In your cities | New (≤${FRESH_DAYS}d) | Old (>${STALE_DAYS}d) | Newest | Oldest | Re-listed | Closed |`,
    '|---|---|---|---|---|---|---|---|---|',
  ];
  for (const p of pulse) {
    lines.push(`| ${p.company} | ${SIGNAL_LABEL[p.signal]} | ${p.inRegion} | ${p.fresh} | ${p.stale} | ${age(p.newestDays)} | ${age(p.oldestDays)} | ${p.reposts} | ${p.expired} |`);
  }
  return lines.join('\n');
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, ['--all', '--pending', '--company', '--json', '--help', '-h'], USAGE, { valueFlags: ['--company'] });
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(USAGE);
    return;
  }
  const root = getCareerOpsRoot();
  const historyText = readIf(join(root, 'data', 'scan-history.tsv'));
  if (!historyText.trim()) {
    console.log('No scan history yet. Run node scan.mjs first.');
    return;
  }
  // Two parsers on purpose: detectReposts wants its own row shape (with a
  // parsed first-seen Date); the pulse needs every column, posted_at included.
  const reposts = detectReposts(parseScanHistory(historyText));
  const parsed = parsedScanHistory(historyText);
  const rows = Array.isArray(parsed) ? parsed : parsed.rows || [];
  const cities = citiesFromPortals(readIf(process.env.CAREER_OPS_PORTALS || join(root, 'portals.yml')));
  const today = new Date();
  let pulse = companyPulse(rows, { cities, today, reposts });
  const only = flagValue(args, '--company');
  if (only) pulse = pulse.filter((p) => p.company.toLowerCase() === only.toLowerCase());
  else if (!hasFlag(args, '--all')) pulse = pulse.filter((p) => p.signal !== 'none');

  const pending = hasFlag(args, '--pending')
    ? pendingJobs(readIf(process.env.CAREER_OPS_PIPELINE || join(root, 'data', 'pipeline.md')))
      .map((job) => ({ ...job, flags: jobFlags(job, rows, pulse.length ? pulse : companyPulse(rows, { cities, today, reposts }), { today, reposts }) }))
      .filter((job) => job.flags.length)
    : null;

  if (hasFlag(args, '--json')) {
    console.log(JSON.stringify({ cities, companies: pulse, ...(pending ? { flaggedPending: pending } : {}) }, null, 2));
    return;
  }

  const counts = pulse.reduce((acc, p) => ({ ...acc, [p.signal]: (acc[p.signal] || 0) + 1 }), {});
  console.log(`# Hiring pulse — ${today.toISOString().slice(0, 10)}\n`);
  console.log(`Cities: ${cities.length ? cities.join(', ') : 'any (no location_filter set)'}`);
  console.log(`Companies: ${counts.active || 0} active · ${counts.mixed || 0} mixed · ${counts.undated || 0} no dates · ${counts.possible_ghost || 0} possible ghost postings\n`);
  console.log(companyTable(pulse));
  console.log(`\nSignals describe how a company posts in your cities, not whether it hired. 🟢 2+ postings from the last ${FRESH_DAYS} days. 🔴 nothing recent and mostly ${STALE_DAYS}+ day-old or re-listed postings. Re-listed and Closed fill in as scans repeat.`);
  if (pending) {
    console.log(`\n## Pending jobs with warnings (${pending.length})\n`);
    if (!pending.length) console.log('None.');
    for (const job of pending) console.log(`- ${job.company} — ${job.title}: ${job.flags.join('; ')}\n  ${job.url}`);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
