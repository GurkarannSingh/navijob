import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeQuotedPrintable, emailToText, htmlToText } from '../lib/email-text.mjs';
import { indiaJobsFromText, indiaOffers } from '../lib/india-import.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

// The card layout of a Naukri "Jobs for you" alert, as HTML table cells.
// Companies, ids and the tracking query are made up.
const card = (company, rating, title, place, pay, yrs, id) => `
<table><tr><td><span>${company}</span></td><td>${rating}</td></tr>
<tr><td><b>${title}</b></td></tr>
<tr><td>${place}</td></tr><tr><td>${pay}</td></tr><tr><td>${yrs}</td></tr>
<tr><td><a href="https://www.naukri.com/job-listings-x-${id}?src=alert&amp;xp=1" style="color:#fff">View &amp; apply</a></td></tr></table>`;
const HTML = `<html><head><style>td{color:red}</style></head><body>
<p>Hi ,</p><p>We&#39;ve curated a list of jobs that match your profile &amp; preferences</p>
${card('Northwind Data', '3.6', 'Principal Software Engineer', 'Hybrid - Hyderabad, Bengaluru', '&#8377;60L - &#8377;1Cr/year', '13-18 Yrs', '181125700001')}
${card('Quill Bank', '3.6', 'Lead Software Engineer', 'Bengaluru', 'Not Disclosed', '10-15 Yrs', '181125700002')}
<p><a href="https://www.naukri.com/unsubscribe?x=1">Unsubscribe</a></p></body></html>`;

const eml = (encoding, body) => [
  'From: Naukri <alerts@naukri.example>',
  'Subject: Jobs for you',
  'MIME-Version: 1.0',
  'Content-Type: multipart/alternative; boundary="b1"',
  '',
  '--b1',
  'Content-Type: text/plain; charset="UTF-8"',
  '',
  'Plain part without links.',
  '--b1',
  'Content-Type: text/html; charset="UTF-8"',
  `Content-Transfer-Encoding: ${encoding}`,
  '',
  body,
  '--b1--',
].join('\r\n');

const base64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{76}/g, '$&\r\n');
const quotedPrintable = (s) => [...Buffer.from(s, 'utf8')]
  .map((b) => (b === 61 || b > 126 ? `=${b.toString(16).toUpperCase().padStart(2, '0')}` : String.fromCharCode(b)))
  .join('')
  .replace(/(.{70})/g, '$1=\r\n');

function expectNaukriCards(text) {
  const offers = indiaOffers(indiaJobsFromText(text), text);
  assert.deepEqual(offers.map((o) => [o.title, o.company, o.location, o.years?.label]), [
    ['Principal Software Engineer', 'Northwind Data', 'Hyderabad, Bengaluru, Hybrid', '13-18'],
    ['Lead Software Engineer', 'Quill Bank', 'Bengaluru', '10-15'],
  ]);
  assert.deepEqual(offers[0].salary, { min: 6_000_000, max: 10_000_000, currency: 'INR' });
  assert.equal(offers[0].url, 'https://www.naukri.com/job-listings-x-181125700001');
}

test('HTML becomes lines, each link written as "label url"', () => {
  const text = htmlToText('<p>Hello &amp; welcome</p><a href="https://a.example/x?y=1&amp;z=2"><b>View</b> job</a><style>p{}</style>');
  assert.equal(text, 'Hello & welcome\nView job https://a.example/x?y=1&z=2');
});

test('quoted-printable decodes UTF-8 byte runs', () => {
  assert.equal(decodeQuotedPrintable('=E2=82=B960L =3D soft=\r\nbreak'), '₹60L = softbreak');
});

test('a base64 HTML email is read like a pasted alert', () => {
  expectNaukriCards(emailToText(eml('base64', base64(HTML))));
});

test('a quoted-printable HTML email is read like a pasted alert', () => {
  expectNaukriCards(emailToText(eml('quoted-printable', quotedPrintable(HTML))));
});

// Real Naukri alert links (2026-11): dl.naukri.com/?data=…&redirect=<encoded
// www.naukri.com/aurus/job-{8 letters}-{12-digit id}?aurusRequest=true&…>.
// The letters look per-recipient; values here are made up.
test('a Naukri aurus deep link behind dl.naukri.com keeps only the job id', () => {
  const target = 'https://www.naukri.com/aurus/job-qwErtyUi-271026900001?src=aurusJobRecurringMailer&aurusRequest=true&utm_source=mail';
  const link = `https://dl.naukri.com/?data=FAKEdataFAKEdata&redirect=${encodeURIComponent(target)}`;
  const text = `Northwind Data\n3.6\nPrincipal Software Engineer\nBengaluru\n₹60L - ₹1Cr/year\n13-18 Yrs\nView & apply ${link}`;
  const jobs = indiaJobsFromText(text);
  assert.deepEqual(jobs, [{ site: 'naukri', id: '271026900001', url: 'https://www.naukri.com/job-listings-271026900001' }]);
  const [offer] = indiaOffers(jobs, text);
  assert.equal(offer.company, 'Northwind Data');
  assert.equal(offer.title, 'Principal Software Engineer');
  assert.ok(!JSON.stringify(offer).includes('qwErtyUi'), 'the per-recipient code is not kept');
});

test('text that is not an email comes back unchanged', () => {
  const pasted = 'Java Developer\nhttps://www.instahyre.com/job-1-x/';
  assert.equal(emailToText(pasted), pasted);
});

test('india-import and naukri-import read a saved .eml with --file', () => {
  const dir = mkdtempSync(join(tmpdir(), 'eml-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const file = join(dir, 'alert.eml');
    writeFileSync(file, eml('base64', base64(HTML)));
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    const dry = spawnSync(process.execPath, [join(ROOT, 'naukri-import.mjs'), '--dry-run', '--file', file], { env, encoding: 'utf8' });
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /2 Naukri jobs found/);
    const run = spawnSync(process.execPath, [join(ROOT, 'india-import.mjs'), '--file', file], { env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    const pipeline = readFileSync(join(dir, 'data', 'pipeline.md'), 'utf8');
    assert.match(pipeline, /job-listings-x-181125700001 \| Northwind Data \| Principal Software Engineer \| Hyderabad, Bengaluru, Hybrid \| 6000000-10000000 INR/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
