import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluatedFromPipeline, fundingIndex, normalizeCompany, rankJobs } from '../lib/job-priority.mjs';
import { newestFundingFile } from '../job-priority.mjs';

const TODAY = new Date(Date.UTC(2026, 10, 18));
const daysAgo = (n) => new Date(TODAY.getTime() - n * 86_400_000).toISOString().slice(0, 10);

test('company names match across boards, trackers and news', () => {
  assert.equal(normalizeCompany('Visa Consolidated Support Services India'), normalizeCompany('Visa'));
  assert.equal(normalizeCompany('Zeta Technologies Pvt Ltd'), normalizeCompany('Zeta'));
  assert.notEqual(normalizeCompany('Stripe'), normalizeCompany('Swiggy'));
});

test('evaluated scores are read from Processed pipeline lines', () => {
  const text = '## Processed\n\n- [x] #001 | https://x.example/1 | Acme | Lead Engineer | 3.6/5 | PDF ❌\n- [ ] https://x.example/2 | Beta | EM\n';
  assert.deepEqual([...evaluatedFromPipeline(text)], [['https://x.example/1', { report: '001', company: 'Acme', title: 'Lead Engineer', score: 3.6 }]]);
});

test('funding index keys on the normalized company and keeps the newest date', () => {
  const idx = fundingIndex({ companies: [{ company: 'Olyv Pvt Ltd', amount: '₹58 Cr', round: 'Series B', funding: { sources: [{ observed_date: '2026-11-12' }, { observed_date: '2026-11-17' }] } }] });
  assert.deepEqual(idx.get('olyv'), { company: 'Olyv Pvt Ltd', amount: '₹58 Cr', round: 'Series B', date: '2026-11-17' });
});

test('order: apply tier, then unevaluated by points, then below bar', () => {
  const pending = [
    { url: 'u-ghost', company: 'GhostCo', title: 'EM' },
    { url: 'u-fresh', company: 'HotCo', title: 'EM' },
    { url: 'u-funded', company: 'Olyv', title: 'Staff Engineer' },
    { url: 'u-old', company: 'HotCo', title: 'Principal' },
  ];
  const evaluated = new Map([
    ['u-good', { report: '002', company: 'Goodco', title: 'Lead', score: 4.3 }],
    ['u-low', { report: '001', company: 'Lowco', title: 'Lead', score: 3.6 }],
  ]);
  const pulse = [{ company: 'HotCo', signal: 'active' }, { company: 'GhostCo', signal: 'possible_ghost' }, { company: 'Olyv', signal: 'mixed' }];
  const funding = new Map([['olyv', { company: 'Olyv', amount: '₹58 Cr', round: 'Series B', date: '2026-11-17' }]]);
  const rows = [{ url: 'u-fresh', posted_at: daysAgo(2) }, { url: 'u-old', posted_at: daysAgo(150) }];
  const ranked = rankJobs(pending, {
    evaluated, pulse, funding, rows, today: TODAY,
    flagsFor: (job) => (job.url === 'u-old' ? ['open 150 days'] : []),
  });
  assert.deepEqual(ranked.map((j) => j.url), ['u-good', 'u-fresh', 'u-funded', 'u-old', 'u-ghost', 'u-low']);
  const by = Object.fromEntries(ranked.map((j) => [j.url, j]));
  assert.equal(by['u-good'].tier, 'apply');
  assert.equal(by['u-low'].tier, 'below bar');
  assert.equal(by['u-fresh'].points, 4);
  assert.equal(by['u-funded'].points, 3);
  assert.ok(by['u-funded'].why.some((w) => w.startsWith('raised ₹58 Cr Series B')));
  assert.equal(by['u-old'].points, 2);
  assert.equal(by['u-ghost'].points, 0);
});

test('the newest funded-companies file is picked', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prio-'));
  try {
    for (const d of ['2026-10-01', '2026-11-18', '2026-11-02']) writeFileSync(join(dir, `funded-companies-${d}.json`), '{}');
    writeFileSync(join(dir, 'other.json'), '{}');
    assert.equal(newestFundingFile(dir), join(dir, 'funded-companies-2026-11-18.json'));
    assert.equal(newestFundingFile(join(dir, 'missing')), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
