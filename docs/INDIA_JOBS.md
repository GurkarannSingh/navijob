# Add jobs from Indian job sites

Paste a job alert email, or a list of job links, from any of these sites. The jobs land in your pipeline with salary, experience and city filled in.

| Site | Job link it reads |
|------|-------------------|
| Naukri | `naukri.com/job-listings-{title}-{id}` |
| Instahyre | `instahyre.com/job-{id}-{title}-at-{company}/` |
| Cutshort | `cutshort.io/job/{Title-Company}-{code}` |
| Foundit | `foundit.in/job/{title-company-city}-{id}` |
| IIMJobs | `iimjobs.com/j/{title}-{id}` |
| Hirist | `hirist.tech/j/{title}-{id}` (and the older `hirist.com`) |

CareerOps never logs in to these sites and never opens them: it reads only the text you paste. Search and listing pages (`/jobs/...`, `/search/...`) are not jobs and are skipped.

## Paste from the terminal

Open the alert email, select all, copy, and run:

```bash
pbpaste | node india-import.mjs
```

Or save it first:

```bash
node india-import.mjs --file alert.txt
```

- `--site foundit` reads only that site. Repeat it for more than one.
- `--dry-run` prints the count and writes nothing.
- `--json` prints one object with `added`, `already`, `found`, and `message`.

A job that is already in the pipeline or the tracker is not added again. `node naukri-import.mjs` still works and reads Naukri links only (see [NAUKRI_JOBS.md](NAUKRI_JOBS.md)).

## What gets saved

| Alert text | Saved as |
|------------|----------|
| `12-18 Lacs PA`, `₹ 30-45 LPA` | `1200000-1800000 INR`, `3000000-4500000 INR` |
| `1-1.5 Cr` | `10000000-15000000 INR` |
| `Not disclosed` | no salary |
| `5-8 Yrs`, `3 to 5 years`, `Fresher` | `yrs: 5-8`, `yrs: 3-5`, `yrs: fresher` |
| `Bengaluru, Hybrid`, `Work from home` | `Bengaluru, Hybrid`, `Remote` |

The salary is the advertised CTC range, not in-hand pay. The India mode (`language.modes_dir: modes/in`) explains the difference when it evaluates the job.

Two alert layouts are read: details above a **View job** / **Apply** link, and the job title as the link with details below it. When the paste has no title, the words in the job link become the title and the site's name stands in for the company until the job is evaluated.

## Before you apply

These are job aggregators, so a listing is unconfirmed until you find the same role on the employer's own careers page. The evaluation does that check (see "Aggregator Listings" in `AGENTS.md`) and applies at the employer when it can.
