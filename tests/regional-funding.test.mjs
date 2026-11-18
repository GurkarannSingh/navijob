import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractCompanyFromFundingTitle,
  extractFundingDetails,
  parseSources,
  SOURCE_GROUPS,
} from '../company-funded.mjs';

// Headline shapes copied from Inc42, Entrackr, MENAbytes, Wamda and Startup
// Daily (2026-11); company names changed.
test('Indian, Gulf and Australian headline shapes yield the company', () => {
  const cases = [
    ['Northwind Labs Raises $47 Mn To Collect Training Data For Robots', 'Northwind Labs'],
    ['Saudi’s Quillbank raises $3.6 million in Prosus-led seed', 'Quillbank'],
    ['Dubai’s RideOn raises $12.5 million in debt and equity', 'RideOn'],
    ['Bengaluru-based Zetapay raises ₹50 Cr in Series B', 'Zetapay'],
    ['Exclusive: Swiftbees raises Rs 100 Cr debt from BlackSoil', 'Swiftbees'],
    ['Acme founders pocket $3.65 million Seed round for insolvency fintech', 'Acme'],
    ['Medi.ai raises INR 32 Cr led by Prime Venture Partners', 'Medi.ai'],
  ];
  for (const [title, company] of cases) assert.equal(extractCompanyFromFundingTitle(title), company, title);
});

test('a possessive owner description is not taken as a company name', () => {
  assert.equal(extractCompanyFromFundingTitle('Expat’s remote surgery medtech scores $92 million Series B'), '');
});

test('amounts in Mn, Cr, ₹, Rs, INR and AED are read; words ending in "rs" are not rupees', () => {
  assert.equal(extractFundingDetails('Acme Raises $47 Mn To Expand').amount, '$47 Mn');
  assert.equal(extractFundingDetails('Acme raises ₹50 Cr in Series B').amount, '₹50 Cr');
  assert.equal(extractFundingDetails('Acme raises Rs 100 Cr debt').amount, 'Rs 100 Cr');
  assert.equal(extractFundingDetails('Acme raises INR 32 Cr').amount, 'INR 32 Cr');
  assert.equal(extractFundingDetails('Acme raises AED 20 million').amount, 'AED 20 million');
  assert.equal(extractFundingDetails('Acme secures Series B from investors, others').amount, '');
});

test('region groups expand to their feeds', () => {
  assert.deepEqual(parseSources('india'), SOURCE_GROUPS.india);
  assert.deepEqual(parseSources('uae,australia'), [...SOURCE_GROUPS.uae, ...SOURCE_GROUPS.australia]);
  assert.deepEqual(parseSources('techcrunch,india'), ['techcrunch', ...SOURCE_GROUPS.india]);
  assert.throws(() => parseSources('nowhere'), /unknown source/);
});
