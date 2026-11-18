# Hiring signals: who is really hiring, possible ghost jobs, recent funding

Two zero-cost reports that help you decide where to spend applications. Neither logs in anywhere or uses AI tokens.

## Hiring pulse

```bash
node hiring-pulse.mjs              # companies with postings in your cities
node hiring-pulse.mjs --pending    # also flag pending jobs in data/pipeline.md
node hiring-pulse.mjs --company Stripe
node hiring-pulse.mjs --all        # include companies with nothing in your cities
node hiring-pulse.mjs --json
```

It reads `data/scan-history.tsv` (every posting the scanner saw, with its posting date), your cities from `portals.yml` → `location_filter`, and your pending jobs.

| Column | Meaning |
|---|---|
| In your cities | Postings the company has listed in your cities |
| New (≤30d) | Posted in the last 30 days |
| Old (>90d) | Still listed more than 90 days after posting |
| Newest / Oldest | Age of the newest and oldest posting |
| Re-listed | Roles posted again under a new link (fills in as scans repeat) |
| Closed | Postings later found closed (fills in as scans repeat) |

| Signal | Rule |
|---|---|
| 🟢 active | 2+ postings from the last 30 days, or 30%+ of dated postings that recent |
| 🟡 mixed | Postings in your cities, neither clearly active nor stale |
| ⚪ no posting dates | The board does not publish dates (Rippling, Atlassian) |
| 🔴 possible ghost postings | Nothing from the last 30 days, and mostly 90+ day-old or re-listed postings |

With `--pending`, a job is flagged when it has been open 90+ days, was re-listed, or its company shows 🔴.

**What it cannot tell you:** whether anyone was hired. It measures how a company posts. An old posting can be an evergreen role; a busy board can still be slow to hire. Treat 🔴 as "ask the recruiter if the role is open" before investing time.

## Recently funded companies (India, UAE, Australia)

```bash
node company-funded.mjs --sources india,uae,australia --months 3 --dry-run
```

| Group | Sources |
|---|---|
| `india` | Inc42, Entrackr, YourStory |
| `uae` | Wamda, MENAbytes |
| `australia` | Startup Daily, SmartCompany |

Amounts in `$47 Mn`, `₹50 Cr`, `Rs 100 Cr`, `INR 32 Cr` and `AED 20 million` are read, and headlines that start with a place ("Dubai's WheelsOn raises…", "Bengaluru-based Olyv raises…") give the company name. Investment funds closing a fund are left out. The global sources (`techcrunch`, `prnewswire`, `guardian`, `hn`) still work and can be combined: `--sources india,techcrunch`.

Without `--dry-run` it writes a review list. To track a funded company's jobs, run `node discover-ats.mjs <Company>` and add its board to `portals.yml`.

## Job priority: one ordered list

```bash
node job-priority.mjs              # top 25
node job-priority.mjs --limit 60
node job-priority.mjs --json
```

Combines everything above into one list of your open jobs:

1. **apply** — already evaluated at 4.0 or above, highest score first.
2. **evaluate next** — not evaluated yet, ordered by priority points.
3. **below bar** — evaluated under 4.0.

| Priority points | |
|---|---|
| Company hiring signal | 🟢 +3 · 🟡 / ⚪ +2 · no other postings +1 · 🔴 0 |
| Company raised funding (newest `output/funded-companies-*.json`) | +1 |
| Posted in the last 14 days | +1 |
| Each warning (open 90+ days, re-listed) | −1 |

Points only decide which jobs to evaluate first. They say nothing about fit: that comes from the evaluation score. Refresh funding first with `node company-funded.mjs --sources india,uae,australia`.
