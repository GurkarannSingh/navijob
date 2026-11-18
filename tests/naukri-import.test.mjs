import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  naukriJobsFromText,
  naukriOffers,
  planNaukriImport,
  parseIndianSalary,
  parseExperience,
  parseLocation,
  canonicalNaukriJobUrl,
} from '../lib/naukri-import.mjs';
import { formatPipelineOffer } from '../scan.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'naukri-import.mjs');

const A = '181125500101';
const B = '181125500102';
const C = '181125500103';

// Layout 1: details above an "Apply" link (synthetic, not a real alert).
const ALERT_ABOVE = [
  'From: alerts' + '@' + 'naukri.example',
  'Subject: 3 new jobs matching your profile',
  '',
  'Senior Backend Engineer',
  'Northwind Fintech Pvt Ltd',
  '5-8 Yrs | 30-45 Lacs PA | Bengaluru, Hybrid',
  `Apply https://www.naukri.com/job-listings-senior-backend-engineer-northwind-fintech-bengaluru-5-to-8-years-${A}?src=jobalert&sid=x`,
  '',
  'Data Analyst',
  'Quill Analytics',
  'Fresher',
  'Not disclosed',
  'Pune',
  `View job: https://click.naukri.com/r?u=${encodeURIComponent(`https://www.naukri.com/job-listings-data-analyst-quill-analytics-pune-0-to-1-years-${B}`)}`,
].join('\n');

// Layout 2: the title is the link, details follow.
const ALERT_TITLE_LINK = [
  `[Engineering Manager](https://www.naukri.com/job-listings-engineering-manager-acme-gurugram-10-to-15-years-${C}?xp=1)`,
  'Acme Software India',
  '10-15 Yrs · ₹ 1-1.5 Cr · Gurugram',
].join('\n');

test('links in an alert become job ids once each, keeping the slug URL', () => {
  const jobs = naukriJobsFromText(`${ALERT_ABOVE}\nhttps://www.naukri.com/job-listings-${A}`);
  assert.deepEqual(jobs.map((j) => j.id), [A, B]);
  assert.match(jobs[0].url, /^https:\/\/www\.naukri\.com\/job-listings-senior-backend-engineer-.*-181125500101$/);
  assert.ok(!jobs[0].url.includes('?'), 'tracking query is stripped');
});

test('a tracking redirect is followed to the job page', () => {
  const [job] = naukriJobsFromText(`https://click.naukri.com/r?u=${encodeURIComponent(`https://www.naukri.com/job-listings-x-${B}`)}`);
  assert.equal(job.id, B);
});

test('a bare id link falls back to job-listings-{id}', () => {
  assert.deepEqual(naukriJobsFromText(`naukri.com/job-listings-${A}`), [{ id: A, url: canonicalNaukriJobUrl(A) }]);
});

test('look-alike hosts and non-job links are ignored', () => {
  const text = [
    `https://naukri.com.evil.example/job-listings-x-${A}`,
    `https://notnaukri.com/job-listings-x-${A}`,
    'https://www.naukri.com/mnjuser/profile',
    'https://www.naukri.com/job-listings-x-2024',
  ].join('\n');
  assert.deepEqual(naukriJobsFromText(text), []);
});

test('Indian salary text becomes a rupee range', () => {
  assert.deepEqual(parseIndianSalary('12-18 Lacs PA'), { min: 1_200_000, max: 1_800_000, currency: 'INR' });
  assert.deepEqual(parseIndianSalary('₹ 30-45 LPA'), { min: 3_000_000, max: 4_500_000, currency: 'INR' });
  assert.deepEqual(parseIndianSalary('1-1.5 Cr'), { min: 10_000_000, max: 15_000_000, currency: 'INR' });
  assert.deepEqual(parseIndianSalary('8,00,000 - 12,00,000 P.A.'), { min: 800_000, max: 1_200_000, currency: 'INR' });
  assert.equal(parseIndianSalary('Not disclosed'), null);
});

test('experience and location are read', () => {
  assert.equal(parseExperience('5-8 Yrs'), '5-8');
  assert.equal(parseExperience('3 to 5 years'), '3-5');
  assert.equal(parseExperience('Fresher'), 'fresher');
  assert.equal(parseLocation('Bengaluru, Hybrid'), 'Bengaluru, Hybrid');
  assert.equal(parseLocation('Work from home'), 'Remote');
  assert.equal(parseLocation('Delhi NCR / Noida'), 'Delhi NCR, Noida');
});

test('details above the link fill title, company, salary, experience, location', () => {
  const offers = naukriOffers(naukriJobsFromText(ALERT_ABOVE), ALERT_ABOVE);
  assert.equal(offers[0].title, 'Senior Backend Engineer');
  assert.equal(offers[0].company, 'Northwind Fintech Pvt Ltd');
  assert.equal(offers[0].location, 'Bengaluru, Hybrid');
  assert.deepEqual(offers[0].salary, { min: 3_000_000, max: 4_500_000, currency: 'INR' });
  assert.deepEqual(offers[0].years, { label: '5-8' });
  assert.equal(offers[1].title, 'Data Analyst');
  assert.equal(offers[1].company, 'Quill Analytics');
  assert.equal(offers[1].location, 'Pune');
  assert.equal(offers[1].salary, undefined);
  assert.deepEqual(offers[1].years, { label: 'fresher' });
  assert.equal(offers[1].source, 'naukri-import');
});

test('a title link with details below is read too', () => {
  const offers = naukriOffers(naukriJobsFromText(ALERT_TITLE_LINK), ALERT_TITLE_LINK);
  assert.equal(offers[0].title, 'Engineering Manager');
  assert.equal(offers[0].company, 'Acme Software India');
  assert.equal(offers[0].location, 'Gurugram');
  assert.deepEqual(offers[0].salary, { min: 10_000_000, max: 15_000_000, currency: 'INR' });
});

test('with no text around it, the slug becomes the title', () => {
  const text = `https://www.naukri.com/job-listings-site-reliability-engineer-zeta-hyderabad-3-to-6-years-${A}`;
  const [offer] = naukriOffers(naukriJobsFromText(text), text);
  assert.equal(offer.title, 'Site Reliability Engineer Zeta Hyderabad');
  assert.equal(offer.company, 'Naukri');
});

test('the pipeline row carries location, INR salary and experience', () => {
  const [offer] = naukriOffers(naukriJobsFromText(ALERT_ABOVE), ALERT_ABOVE);
  const line = formatPipelineOffer(offer);
  assert.match(line, /\| Northwind Fintech Pvt Ltd \| Senior Backend Engineer \| Bengaluru, Hybrid \| 3000000-4500000 INR/);
  assert.match(line, /\| yrs: 5-8/);
});

test('jobs already in the pipeline or tracker are skipped', () => {
  const seen = `- [ ] https://www.naukri.com/job-listings-anything-${A} | X | Y`;
  const plan = planNaukriImport(ALERT_ABOVE, seen);
  assert.deepEqual(plan.added.map((j) => j.id), [B]);
  assert.deepEqual(plan.already.map((j) => j.id), [A]);
  assert.equal(plan.message, '1 Naukri job added. Open Pipeline to review it. 1 was already in your list.');
  assert.match(planNaukriImport('', '').message, /No Naukri jobs found/);
});

test('the CLI writes new jobs to the pipeline once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'naukri-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    const run = () => spawnSync(process.execPath, [CLI, '--json'], { input: ALERT_ABOVE, env, encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).added, 2);
    const pipeline = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, new RegExp(A));
    assert.match(pipeline, new RegExp(B));
    const second = run();
    assert.equal(JSON.parse(second.stdout).added, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--dry-run writes nothing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'naukri-'));
  try {
    writeFileSync(join(dir, 'alert.txt'), ALERT_ABOVE);
    const r = spawnSync(process.execPath, [CLI, '--dry-run', '--file', join(dir, 'alert.txt')], {
      env: { ...process.env, CAREER_OPS_ROOT: dir }, encoding: 'utf8',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /2 Naukri jobs found\. Nothing was saved\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
