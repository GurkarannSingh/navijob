#!/usr/bin/env node
/**
 * job-priority.mjs — one ordered list of your open jobs: evaluated 4.0+
 * first, then unevaluated jobs by hiring signal, recent funding and
 * freshness, then evaluated jobs under 4.0. Zero network, zero tokens.
 *
 *   node job-priority.mjs              Top 25
 *   node job-priority.mjs --limit 60
 *   node job-priority.mjs --json
 *
 * Funding comes from the newest output/funded-companies-*.json; refresh it
 * with `node company-funded.mjs --sources india,uae,australia`.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { flagValue, hasFlag, validateFlags } from './lib/cli-flags.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { getCareerOpsRoot } from './path-resolver.mjs';
import { detectReposts, parseScanHistory } from './detect-reposts.mjs';
import { parsedScanHistory } from './lib/scan-history-columns.mjs';
import { companyPulse, jobFlags } from './lib/hiring-pulse.mjs';
import { evaluatedFromPipeline, fundingIndex, rankJobs } from './lib/job-priority.mjs';
import { citiesFromPortals, pendingJobs } from './hiring-pulse.mjs';

const USAGE = `One ordered list of your open jobs.

  node job-priority.mjs              Top 25
  node job-priority.mjs --limit 60
  node job-priority.mjs --json

Order: evaluated 4.0+ ("apply"), then not yet evaluated ("evaluate next")
by company hiring signal, recent funding and posting freshness, then
evaluated under 4.0 ("below bar"). Points only order the unevaluated jobs;
they are not a fit score. Funding: newest output/funded-companies-*.json.
`;

function readIf(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') return '';
    throw err;
  }
}

export function newestFundingFile(dir) {
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => /^funded-companies-\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort();
  } catch {
    return null;
  }
  return names.length ? join(dir, names[names.length - 1]) : null;
}

async function main() {
  const args = process.argv.slice(2);
  validateFlags(args, ['--limit', '--json', '--help', '-h'], USAGE, { valueFlags: ['--limit'] });
  if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
    console.log(USAGE);
    return;
  }
  const limitRaw = flagValue(args, '--limit');
  const limit = limitRaw === undefined ? 25 : Number(limitRaw);
  if (!Number.isInteger(limit) || limit <= 0) {
    console.error('--limit must be a positive whole number.');
    process.exit(1);
  }

  const root = getCareerOpsRoot();
  const historyText = readIf(join(root, 'data', 'scan-history.tsv'));
  const parsed = historyText ? parsedScanHistory(historyText) : [];
  const rows = Array.isArray(parsed) ? parsed : parsed.rows || [];
  const reposts = historyText ? detectReposts(parseScanHistory(historyText)) : [];
  const cities = citiesFromPortals(readIf(process.env.CAREER_OPS_PORTALS || join(root, 'portals.yml')));
  const today = new Date();
  const pulse = companyPulse(rows, { cities, today, reposts });
  const pipelineText = readIf(process.env.CAREER_OPS_PIPELINE || join(root, 'data', 'pipeline.md'));
  const fundingPath = newestFundingFile(join(root, 'output'));
  const funding = fundingPath ? fundingIndex(JSON.parse(readIf(fundingPath) || '{}')) : new Map();

  const ranked = rankJobs(pendingJobs(pipelineText), {
    evaluated: evaluatedFromPipeline(pipelineText),
    pulse,
    funding,
    rows,
    today,
    flagsFor: (job) => jobFlags(job, rows, pulse, { today, reposts }).filter((f) => !f.startsWith('company:')),
  });

  if (hasFlag(args, '--json')) {
    console.log(JSON.stringify({ funding: fundingPath, jobs: ranked.slice(0, limit) }, null, 2));
    return;
  }
  const counts = ranked.reduce((acc, j) => ({ ...acc, [j.tier]: (acc[j.tier] || 0) + 1 }), {});
  console.log(`# Job priority — ${today.toISOString().slice(0, 10)}\n`);
  console.log(`${ranked.length} open jobs: ${counts.apply || 0} apply · ${counts['evaluate next'] || 0} evaluate next · ${counts['below bar'] || 0} below bar`);
  console.log(`Funding data: ${fundingPath ? fundingPath.replace(`${root}/`, '') : 'none (run node company-funded.mjs --sources india,uae,australia)'}\n`);
  console.log('| # | Tier | Company | Role | Score | Points | Why |');
  console.log('|---|---|---|---|---|---|---|');
  ranked.slice(0, limit).forEach((j, i) => {
    console.log(`| ${i + 1} | ${j.tier} | ${j.company} | ${j.title} | ${j.score == null ? '—' : `${j.score}/5`} | ${j.tier === 'evaluate next' ? j.points : '—'} | ${j.why.join('; ')} |`);
  });
  if (ranked.length > limit) console.log(`\n${ranked.length - limit} more: --limit ${ranked.length}`);
  console.log('\nPoints only order jobs not yet evaluated; they are not a fit score. Evaluate the top ones with /career-ops pipeline.');
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
