# Add Naukri jobs

Paste a Naukri job alert into CareerOps. The jobs land in your pipeline with salary, experience and city filled in. CareerOps never logs in to Naukri and never opens naukri.com: it reads only the text you paste.

## Paste from the terminal

Copying an email from Gmail in the browser drops its links, so download it instead: open the alert, click **⋮** → **Download message**. Then run:

```bash
node naukri-import.mjs --file ~/Downloads/alert.eml
```

Or pipe it:

```bash
pbpaste | node naukri-import.mjs
```

A plain list of Naukri job links works too. For Instahyre, Cutshort, Foundit, IIMJobs and Hirist as well, use `node india-import.mjs` (see [INDIA_JOBS.md](INDIA_JOBS.md)).

`--dry-run` prints the count and writes nothing. `--json` prints one object with `added`, `already`, `found`, and `message`.

A job that is already in the pipeline or the tracker is not added again.

## What gets saved

| Alert text | Saved as |
|------------|----------|
| `12-18 Lacs PA`, `₹ 30-45 LPA` | `1200000-1800000 INR`, `3000000-4500000 INR` |
| `1-1.5 Cr` | `10000000-15000000 INR` |
| `₹60L - ₹1Cr/year` | `6000000-10000000 INR` |
| `Not disclosed` | no salary |
| `5-8 Yrs`, `3 to 5 years`, `Fresher` | `yrs: 5-8`, `yrs: 3-5`, `yrs: fresher` |
| `Bengaluru, Hybrid`, `Work from home` | `Bengaluru, Hybrid`, `Remote` |

The salary is the advertised CTC range, not in-hand pay. The India mode (`language.modes_dir: modes/in`) explains the difference when it evaluates the job.

Each job keeps its `naukri.com/job-listings-{title}-{id}` address. Tracking links and click redirects in the email are followed to that address. A link that carries only the id becomes `naukri.com/job-listings-{id}`.

Two alert layouts are read: details above an **Apply** link, and the job title as the link with details below it. When the paste has no title, the words in the job link become the title.

## Before you apply

Naukri is a job aggregator, so a listing is unconfirmed until you find the same role on the employer's own careers page. The evaluation does that check (see "Aggregator Listings" in `AGENTS.md`) and applies at the employer when it can.
