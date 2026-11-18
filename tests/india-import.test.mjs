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
  assert.match(planIndiaImport('nothing here', '').message, /^No job links from Naukri, Instahyre/);
});

// Layout of a real Instahyre job alert (2026-11): every link wrapped in a
// click tracker that carries the target, %2F-encoded, in its PATH, plus a
// per-user url_auth_token. Company, id, token and signatures are made up.
const TOKEN = 'FAKEtokenFAKEtoken%253AFAKEsig';
const tracked = (target) => `https://click4.instahyre.com/CL0/${encodeURIComponent(target).replace(/%3A/g, ':')}/2/0000000000000000-aaaa-bbbb/SIG000=258`;
const INSTAHYRE_ALERT = [
  `[Instahyre](${tracked('https://www.instahyre.com')})`,
  'Hey Candidate,',
  'Northwind Systems has just posted a Java Developer job. You look like a good fit for the position.',
  `[Update your preferences »](${tracked(`https://www.instahyre.com/candidate/onboard/?url_auth_token=${TOKEN}`)})`,
  '',
  'Java Developer',
  'Northwind Systems  ',
  '\tBangalore',
  ' ',
  `[Apply here](${tracked(`https://www.instahyre.com/job-400001-java-developer-at-northwind-systems-bangalore/?url_auth_token=${TOKEN}&utm_source=instahyre&utm_medium=email&utm_campaign=job_alert&referrer=job_post`)})`,
  ' ',
  'Northwind Systems provides software services to businesses.',
  'Hibernate JPA Java Microservices REST SQL Spring Spring Boot',
  `[Click here if you want to unsubscribe from this notification](${tracked(`https://www.instahyre.com/candidate/settings/?url_auth_token=${TOKEN}&notification_settings=true`)})`,
  `[LinkedIn](${tracked('https://www.linkedin.com/company/instahyre')})`,
].join('\n');

test('a real-layout Instahyre alert: path-wrapped tracker, details above "Apply here"', () => {
  const jobs = indiaJobsFromText(INSTAHYRE_ALERT);
  assert.deepEqual(jobs, [{
    site: 'instahyre',
    id: '400001',
    url: 'https://www.instahyre.com/job-400001-java-developer-at-northwind-systems-bangalore/',
  }]);
  const [offer] = indiaOffers(jobs, INSTAHYRE_ALERT);
  assert.equal(offer.title, 'Java Developer');
  assert.equal(offer.company, 'Northwind Systems');
  assert.equal(offer.location, 'Bangalore');
});

// Layout of a real Naukri "Jobs for you" alert (2026-11): company and star
// rating in a card header, a blank line, then title, location, salary,
// experience, and a "View & apply" link. Companies and ids are made up; a
// browser copy drops the links, so they are added back as markdown.
const naukriCard = (company, rating, title, place, pay, yrs, id) => [
  '', company, `\t${rating}`, '', '', title, `\t\t${place}`, `\t\t${pay}`, `\t\t${yrs}`, '',
  `[View & apply](https://www.naukri.com/job-listings-${title.toLowerCase().replace(/\W+/g, '-')}-${id}?src=jobsearchDesk)`, '',
].join('\n');
const NAUKRI_CARDS = [
  'Hi ,',
  "We've curated a list of jobs that match your profile & preferences, take a look",
  naukriCard('Northwind Data', '3.6', 'Principal Software Engineer', 'Hybrid - Hyderabad, Bengaluru', '₹60L - ₹1Cr/year', '13-18 Yrs', '181125600001'),
  naukriCard('Quill Bank', '3.6', 'Lead Software Engineer', 'Bengaluru', 'Not Disclosed', '10-15 Yrs', '181125600002'),
  naukriCard('Zeta Freight', '3.4', 'Engineering Manager', 'Bengaluru', '₹40L - ₹1Cr/year', '6-11 Yrs', '181125600003'),
].join('\n');

test('a real-layout Naukri card alert: company above the title, rating skipped, ₹L-₹Cr salary', () => {
  const offers = indiaOffers(indiaJobsFromText(NAUKRI_CARDS), NAUKRI_CARDS);
  assert.deepEqual(offers.map((o) => [o.title, o.company, o.location]), [
    ['Principal Software Engineer', 'Northwind Data', 'Hyderabad, Bengaluru, Hybrid'],
    ['Lead Software Engineer', 'Quill Bank', 'Bengaluru'],
    ['Engineering Manager', 'Zeta Freight', 'Bengaluru'],
  ]);
  assert.deepEqual(offers[0].salary, { min: 6_000_000, max: 10_000_000, currency: 'INR' });
  assert.equal(offers[1].salary, undefined);
  assert.deepEqual(offers[2].salary, { min: 4_000_000, max: 10_000_000, currency: 'INR' });
  assert.deepEqual(offers.map((o) => o.years.label), ['13-18', '10-15', '6-11']);
});

test('a paste whose links were dropped says how to keep them', () => {
  const plain = NAUKRI_CARDS.replace(/\]\([^)]*\)/g, ']').replace(/[[\]]/g, '');
  const plan = planIndiaImport(plain, '');
  assert.equal(plan.found, 0);
  assert.match(plan.message, /drops its links\. Download the email instead/);
});

test('the account login token in an alert link is never saved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'india-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const r = spawnSync(process.execPath, [CLI], { input: INSTAHYRE_ALERT, env: { ...process.env, CAREER_OPS_ROOT: dir }, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    for (const file of ['pipeline.md', 'scan-history.tsv']) {
      const text = readFileSync(join(dir, 'data', file), 'utf8');
      assert.ok(text.includes('job-400001'), `${file} has the job`);
      assert.ok(!/url_auth_token|FAKEtoken|click4\./.test(text), `${file} has no token or tracker`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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
