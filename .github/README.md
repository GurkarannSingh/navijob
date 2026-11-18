# Navijob

**Your job-search navigator for India, the UAE and Australia.**

Navijob finds jobs that fit your CV, scores each one, tailors your CV for the good ones and prepares the application. **You press Submit.**

It runs on your own machine with your AI coding assistant (Claude Code, Codex, Gemini CLI and others). Your CV, job list and reports stay on your computer.

> Navijob is based on [career-ops](https://github.com/career-ops-hq/career-ops) by Santiago Fernández de Valderrama (MIT). It adds job sources, salary formats and hiring rules for India first, then the UAE and Australia. See [NOTICE.md](../NOTICE.md).

---

## Why Navijob

Most job-search tools are built for the US and Europe, with India, the Gulf and Australia added later, if at all. Navijob starts from how hiring works in these markets:

- **Local job sources.** Naukri, Instahyre, Cutshort, Foundit, IIMJobs and Hirist alerts today; Bayt, GulfTalent and Seek next.
- **Local salary and hiring terms.** LPA and crore ranges, CTC vs. in-hand pay, notice period and buyout; AED packages and gratuity; superannuation and visa subclasses.
- **Your accounts stay safe.** Navijob never logs in to job sites, never scrapes them and never auto-applies. It reads the alert emails you already receive and companies' own public career pages.
- **Hiring signals.** See which companies are actively hiring in your cities, which postings look like ghost jobs (open 90+ days, re-listed), and which startups in India, the UAE and Australia just raised funding. One command (`node job-priority.mjs`) puts it all in a single ordered list of what to evaluate and apply to next. See [Hiring signals](../docs/HIRING_SIGNALS.md).
- **Quality over volume.** Every job gets a 1–5 score against your real CV. Below 4, Navijob recommends not applying.
- **No made-up experience.** Tailored CVs reorder and reword what is in your CV. They never invent skills or numbers.

## Markets

| Market | Status | What's included |
|---|---|---|
| 🇮🇳 India | **In progress** | Alert import from Naukri, Instahyre, Cutshort, Foundit, IIMJobs and Hirist (pasted text or saved `.eml`); salary in LPA / Cr; India evaluation rules (CTC, notice period, freshers) |
| 🇦🇪 UAE | Planned | English UAE rules (AED, housing allowance, visa sponsorship, gratuity); Bayt, GulfTalent and Naukrigulf alerts |
| 🇦🇺 Australia | Planned | Australia rules (super, visa subclasses, award rates); Seek and company career pages |

## How it works

1. **Find.** Scan companies' own career pages (Greenhouse, Lever, Ashby, Workday, Darwinbox, Keka and more) and import job-alert emails.
2. **Check.** Confirm each job is still open on the employer's own site.
3. **Score.** Compare the job description with your CV: requirements met and missing, level, pay, posting legitimacy.
4. **Tailor.** For jobs scoring 4 or more, produce a CV PDF tailored to that job.
5. **Prepare.** Fill the application form and draft answers. You review and press Submit.

## Quick start

Requires Node.js 22.13 or later and an AI coding CLI.

```bash
git clone https://github.com/GurkarannSingh/career-ops.git navijob
cd navijob
npm install
node doctor.mjs
```

Then open your AI assistant in the folder (for example, run `claude`) and give it your CV. It sets up your profile, target roles, cities and salary.

Import a job alert:

```bash
node india-import.mjs --file ~/Downloads/alert.eml
```

Guides: [Indian job sites](../docs/INDIA_JOBS.md) · [Hiring signals](../docs/HIRING_SIGNALS.md) · [Naukri](../docs/NAUKRI_JOBS.md) · [career-ops documentation](../README.md)

## Credits and license

Navijob is a fork of [career-ops](https://github.com/career-ops-hq/career-ops), created by [Santiago Fernández de Valderrama](https://github.com/santifer) and its contributors, released under the MIT License. The original copyright notice is kept in [LICENSE](../LICENSE). Navijob's additions are © 2026 Gurkaran Pal Singh, also under the MIT License; see [NOTICE.md](../NOTICE.md).

"career-ops" is the original project's name. Navijob is an independent project and is not affiliated with or endorsed by career-ops.
