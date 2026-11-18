import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  indiaJobFromUrl,
  indiaJobsFromText,
  indiaOffers,
  planIndiaImport,
} from '../lib/india-import.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CLI = join(ROOT, 'india-import.mjs');

// Link shapes copied from live listings (2026-11); ids changed.
const LINKS = {
  naukri: 'https://www.naukri.com/job-listings-backend-engineer-acme-pune-3-to-6-years-181125500201',
  instahyre: 'https://www.instahyre.com/job-157100-software-engineer-at-quillfeather-work-from-home/',
  cutshort: 'https://cutshort.io/job/Backend-Developer-Northwind-rbX1mqKC',
  foundit: 'https://www.foundit.in/job/sr-software-engineer-devops-northwind-bengaluru-bangalore-69800001',
  iimjobs: 'https://www.iimjobs.com/j/product-manager-ecommerce-4-10-yrs-1672600?jobPos=5',
  hirist: 'https://www.hirist.tech/j/-net-core-backend-developer-1521100',
};

test('each site\'s job link is recognised with its id', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(LINKS).map(([site, url]) => {
      const job = indiaJobFromUrl(url);
      return [site, job && `${job.site}:${job.id}`];
    })),
    {
      naukri: 'naukri:181125500201',
      instahyre: 'instahyre:157100',
      cutshort: 'cutshort:rbX1mqKC',
      foundit: 'foundit:69800001',
      iimjobs: 'iimjobs:1672600',
      hirist: 'hirist:1521100',
    },
  );
});

test('tracking queries are dropped and the old hirist.com host maps to hirist.tech', () => {
  assert.equal(indiaJobFromUrl(LINKS.iimjobs).url, 'https://www.iimjobs.com/j/product-manager-ecommerce-4-10-yrs-1672600');
  assert.equal(indiaJobFromUrl('https://www.hirist.com/j/golang-developer-1588000.html').url, 'https://www.hirist.tech/j/golang-developer-1588000');
});

test('titles come from the link words when the paste has none', () => {
  const offers = indiaOffers(indiaJobsFromText(Object.values(LINKS).join('\n')), '');
  assert.deepEqual(offers.map((o) => [o.title, o.company]), [
    ['Backend Engineer Acme Pune', 'Naukri'],
    ['Software Engineer', 'Instahyre'],
    ['Backend Developer Northwind', 'Cutshort'],
    ['Sr Software Engineer Devops Northwind Bengaluru Bangalore', 'Foundit'],
    ['Product Manager Ecommerce', 'IIMJobs'],
    ['Net Core Backend Developer', 'Hirist'],
  ]);
  assert.deepEqual(offers.map((o) => o.source), [
    'naukri-import', 'instahyre-import', 'cutshort-import', 'foundit-import', 'iimjobs-import', 'hirist-import',
  ]);
});

test('listing, search and look-alike pages are not jobs', () => {
  const text = [
    'https://www.instahyre.com/software-engineering-jobs/',
    'https://cutshort.io/jobs/backend-developer-jobs-in-pune',
    'https://www.foundit.in/search/software-engineer-jobs-in-bengaluru-bangalore',
    'https://www.iimjobs.com/myprofile',
    'https://www.hirist.tech/c/backend-development',
    'https://cutshort.io/job/Backend-Developer-Acme-abcdefgh',
    'https://foundit.in.evil.example/job/x-69800001',
    'https://notiimjobs.com/j/x-1672600',
  ].join('\n');
  assert.deepEqual(indiaJobsFromText(text), []);
});

test('details around the link are read the same way on every site', () => {
  const alert = [
    'Jobs matching your profile',
    '',
    'Platform Engineer',
    'Zeta Payments',
    '4-7 Yrs | ₹ 25-35 LPA | Hyderabad',
    `View job ${LINKS.foundit}`,
    '',
    `[Data Scientist](${LINKS.cutshort})`,
    'Northwind Labs',
    '2-4 years · 15-22 Lacs PA · Remote',
  ].join('\n');
  const offers = indiaOffers(indiaJobsFromText(alert), alert);
  assert.equal(offers[0].title, 'Platform Engineer');
  assert.equal(offers[0].company, 'Zeta Payments');
  assert.equal(offers[0].location, 'Hyderabad');
  assert.deepEqual(offers[0].salary, { min: 2_500_000, max: 3_500_000, currency: 'INR' });
  assert.deepEqual(offers[0].years, { label: '4-7' });
  assert.equal(offers[1].title, 'Data Scientist');
  assert.equal(offers[1].company, 'Northwind Labs');
  assert.equal(offers[1].location, 'Remote');
  assert.deepEqual(offers[1].years, { label: '2-4' });
});

test('the same id on two sites is two jobs; the same job twice is one', () => {
  const text = [
    'https://www.iimjobs.com/j/analyst-1672600',
    'https://www.hirist.tech/j/analyst-1672600',
    'https://www.iimjobs.com/j/1672600',
  ].join('\n');
  assert.deepEqual(indiaJobsFromText(text).map((j) => `${j.site}:${j.id}`), ['iimjobs:1672600', 'hirist:1672600']);
});

test('the import plan names the sites and skips jobs already listed', () => {
  const seen = `- [ ] ${LINKS.instahyre} | Quillfeather | Software Engineer`;
  const plan = planIndiaImport(Object.values(LINKS).join('\n'), seen);
  assert.equal(plan.found, 6);
  assert.equal(plan.already.length, 1);
  assert.equal(plan.message, '5 jobs added (Naukri, Cutshort, Foundit, IIMJobs, Hirist). Open Pipeline to review them. 1 was already in your list.');
  const one = planIndiaImport(Object.values(LINKS).join('\n'), '', { sites: new Set(['foundit']) });
  assert.deepEqual(one.added.map((j) => j.site), ['foundit']);
  assert.match(planIndiaImport('nothing here', '').message, /^No jobs from Naukri, Instahyre/);
});

test('the CLI writes jobs from every site once, and --site limits it', () => {
  const dir = mkdtempSync(join(tmpdir(), 'india-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    const input = Object.values(LINKS).join('\n');
    const only = spawnSync(process.execPath, [CLI, '--json', '--dry-run', '--site', 'hirist'], { input, env, encoding: 'utf8' });
    assert.equal(only.status, 0, only.stderr);
    assert.equal(JSON.parse(only.stdout).found, 1);
    const first = spawnSync(process.execPath, [CLI, '--json'], { input, env, encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(JSON.parse(first.stdout).added, 6);
    const pipeline = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
    for (const url of ['instahyre.com/job-157100', 'cutshort.io/job/Backend-Developer-Northwind-rbX1mqKC', 'hirist.tech/j/-net-core']) {
      assert.ok(pipeline.includes(url), `${url} in pipeline`);
    }
    const again = spawnSync(process.execPath, [CLI, '--json'], { input, env, encoding: 'utf8' });
    assert.equal(JSON.parse(again.stdout).added, 0);
    const bad = spawnSync(process.execPath, [CLI, '--site', 'monster'], { input, env, encoding: 'utf8' });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Unknown site: monster/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
