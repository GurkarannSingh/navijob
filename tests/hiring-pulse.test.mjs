import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { companyPulse, jobFlags, pulseSignal, regionMatcher } from '../lib/hiring-pulse.mjs';
import { citiesFromPortals, pendingJobs } from '../hiring-pulse.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TODAY = new Date(Date.UTC(2026, 10, 18));
const daysAgo = (n) => new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);
const row = (company, url, { status = 'added', location = 'Bengaluru, India', posted = '' } = {}) =>
  ({ url, company, status, location, posted_at: posted, normalized_company: company.toLowerCase() });

test('city matching is case-insensitive and word-bounded', () => {
  const inCity = regionMatcher(['Pune', 'Bengaluru']);
  assert.ok(inCity('Pune, Maharashtra, India'));
  assert.ok(inCity('bengaluru - India'));
  assert.ok(!inCity('Punekar Road, Mumbai'));
  assert.ok(!inCity('Singapore'));
});

test('signals: active, possible ghost, undated, mixed, none', () => {
  assert.equal(pulseSignal({ inRegion: 5, dated: 5, fresh: 2, stale: 0, reposts: 0 }), 'active');
  assert.equal(pulseSignal({ inRegion: 4, dated: 4, fresh: 0, stale: 3, reposts: 0 }), 'possible_ghost');
  assert.equal(pulseSignal({ inRegion: 3, dated: 3, fresh: 0, stale: 0, reposts: 2 }), 'possible_ghost');
  assert.equal(pulseSignal({ inRegion: 9, dated: 0, fresh: 0, stale: 0, reposts: 0 }), 'undated');
  assert.equal(pulseSignal({ inRegion: 4, dated: 4, fresh: 0, stale: 1, reposts: 0 }), 'mixed');
  assert.equal(pulseSignal({ inRegion: 0, dated: 0, fresh: 0, stale: 0, reposts: 0 }), 'none');
});

test('companyPulse counts only postings in your cities, once each', () => {
  const rows = [
    row('Northwind', 'a', { posted: daysAgo(3) }),
    row('Northwind', 'b', { status: 'skipped_title', posted: daysAgo(10) }),
    row('Northwind', 'b', { status: 'skipped_title', posted: daysAgo(10) }),
    row('Northwind', 'c', { status: 'skipped_location', location: 'London', posted: daysAgo(1) }),
    row('Quill', 'd', { posted: daysAgo(200) }),
    row('Quill', 'e', { status: 'skipped_age', posted: daysAgo(120) }),
    row('Quill', 'f', { status: 'skipped_expired' }),
    row('Faraway', 'g', { status: 'skipped_location', location: 'Berlin' }),
  ];
  const pulse = companyPulse(rows, { cities: ['Bengaluru'], today: TODAY });
  const by = Object.fromEntries(pulse.map((p) => [p.company, p]));
  assert.equal(by.Northwind.inRegion, 2);
  assert.equal(by.Northwind.fresh, 2);
  assert.equal(by.Northwind.signal, 'active');
  assert.equal(by.Quill.stale, 2);
  assert.equal(by.Quill.oldestDays, 200);
  assert.equal(by.Quill.expired, 1);
  assert.equal(by.Quill.signal, 'possible_ghost');
  assert.equal(by.Faraway.signal, 'none');
  assert.deepEqual(pulse.map((p) => p.company), ['Northwind', 'Quill', 'Faraway']);
});

test('job flags name an old posting, a re-listing and a ghost-signal company', () => {
  const rows = [row('Quill', 'old-url', { posted: daysAgo(150) }), row('Quill', 'x', { posted: daysAgo(120) })];
  const reposts = [{ company: 'Quill', repostCount: 3, appearances: [{ url: 'old-url' }] }];
  const pulse = companyPulse(rows, { cities: ['Bengaluru'], today: TODAY, reposts });
  assert.deepEqual(jobFlags({ url: 'old-url', company: 'Quill' }, rows, pulse, { today: TODAY, reposts }),
    ['open 150 days', 're-listed 3×', 'company: possible ghost postings']);
});

test('cities come from portals.yml location_filter; pending jobs from pipeline.md', () => {
  assert.deepEqual(citiesFromPortals('location_filter:\n  allow:\n    - "Pune"\n  always_allow:\n    - "India"\n'), ['Pune', 'India']);
  assert.deepEqual(pendingJobs('## Pending\n\n- [ ] https://x.example/1 | Acme | EM | Pune\n- [x] #1 | done\n'),
    [{ url: 'https://x.example/1', company: 'Acme', title: 'EM' }]);
});

test('the CLI prints a table and a JSON report from a scan history', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pulse-'));
  try {
    mkdirSync(join(dir, 'data'), { recursive: true });
    const header = 'url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\tfingerprint\tposted_at\ttrust_score\ttrust_flags\tnormalized_company\trequisition_id\tlanguage\tlisting_key\tcloses_at\temployment_type';
    const line = (url, posted) => [url, '2026-11-18', 'test', 'EM', 'Northwind', 'added', 'Pune, India', '', posted, '', '', 'northwind', '', '', '', '', ''].join('\t');
    const recent = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    writeFileSync(join(dir, 'data', 'scan-history.tsv'), [header, line('https://x.example/1', recent), line('https://x.example/2', recent)].join('\n') + '\n');
    writeFileSync(join(dir, 'portals.yml'), 'location_filter:\n  allow:\n    - "Pune"\n');
    const env = { ...process.env, CAREER_OPS_ROOT: dir };
    delete env.CAREER_OPS_PORTALS;
    const text = spawnSync(process.execPath, [join(ROOT, 'hiring-pulse.mjs')], { env, encoding: 'utf8' });
    assert.equal(text.status, 0, text.stderr);
    assert.match(text.stdout, /\| Northwind \| 🟢 active \| 2 \| 2 \|/);
    const json = spawnSync(process.execPath, [join(ROOT, 'hiring-pulse.mjs'), '--json'], { env, encoding: 'utf8' });
    assert.equal(JSON.parse(json.stdout).companies[0].signal, 'active');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
