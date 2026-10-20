# 准点 · InterviewTrack

**Turns recruiting emails into a schedule you can trust, in your own time zone.** Built for students abroad applying to jobs back home: a Beijing 13:30 interview shows up as 01:30 where you are, the night before you get an email with the meeting link, and your calendar rings 30 minutes before. It reads application receipts, assessment invites, interview notices and rejections, works out *what* each one is and *when* it happens (in which time zone), and puts it on a board. When it is not sure, it says so instead of guessing.

**Try it:** https://board.interviewtrack.me (public beta, limited seats; sign in with an email code)
**Live demo:** https://job-command-center-eta-two.vercel.app (all companies and emails fictional; everything runs in the browser)

![The board: schedule in your time zone, the original email with the time highlighted, calendar, stats](docs/images/demo.gif)

[中文说明](./README.zh-CN.md)

---

## Why this exists

During campus recruiting I was getting dozens of emails a week across two languages and four time zones. The costly mistakes are specific:

- A **fixed exam slot** read as a deadline → you miss the exam.
- A **deadline** read as a fixed slot → you sit waiting for something that never starts.
- A time shown in the **wrong time zone** → you are 12 hours off.
- An invite's *"this link becomes valid at 09:09"* read as the event time → the board says "overdue" the moment the email arrives.

A general-purpose LLM asked to "extract the date" makes all four, confidently. So the design goal is not "extract as much as possible". It is **never show a wrong time**.

## The core idea: the model extracts, rules decide

```mermaid
flowchart LR
    A[Raw email] --> B[Clean<br/>strip quotes, decode entities]
    B --> C{Prefilter<br/>rules}
    C -- noise --> X[Dropped<br/>with a reason]
    C -- pass --> D[LLM extraction<br/>verbatim fragments only]
    D --> E[Grounding check<br/>fragment must appear in the email]
    E --> F[Rules<br/>event type · time zone · time semantics]
    F --> G[Confidence<br/>weakest signal wins]
    G -- high / medium --> H[Schedule + calendar]
    G -- low --> I[Needs your confirmation]
```

The LLM is only allowed to **copy fragments out of the email**: the company name, the role, the sentence that talks about time, a location, and a suggested event type. It never outputs a date, a time zone or a decision.

Everything that can hurt the user is decided by deterministic rules that can be read, tested and corrected one at a time:

| Decision | Made by | Why |
|---|---|---|
| Company / role / "which sentence is about time" | LLM | Rules are bad at free-form names; models are good at it |
| Is this fragment really in the email? | Rule (grounding check) | Blocks hallucinated dates and places |
| Fixed start vs. deadline vs. date-only | Rules | The most expensive mistake; must be explainable |
| Time zone | Rules, from explicit evidence only | Never inferred from language, never defaulted |
| Same event as an earlier email? | Rules (dedup key) | Reminders merge into the original instead of duplicating |
| Does it go on the schedule? | Rules (confidence) | "Uncertain" is a first-class outcome, not a failure |

Two properties follow from this split:

1. **The model has a veto but no vote.** If the model and the rules disagree about what an email is, the item goes to "needs confirmation". The model can keep something *off* the schedule; it can never put something *on* it.
2. **Every result is explainable.** Each card has a detail view showing the highlighted source fragments and the reason behind every step.

## Results on real email

Measured on 147 of my own recruiting emails (92 process emails, 50 job ads, 5 unrelated). Full method and caveats: [docs/EVALUATION.md](./docs/EVALUATION.md).

| | Rules only | Rules + model, first run | Rules + model, after fixes | + promotional filter |
|---|---|---|---|---|
| **Precision** — items on the schedule that are fully correct (target > 95%) | 73.8% | 75.0% | 98.5% | **100%** (67 / 67) |
| **Recall** — process emails that land on the schedule fully correct (target > 70%) | 33.7% | 55.4% | 72.8% | **72.8%** |
| Ads / unrelated email wrongly put on the schedule (of 55) | 3 | 8 | 1 | **0** |
| Ads / unrelated email sent to "needs confirmation" (of 55) | 14 | 13 | 11 | **2** |
| Company name correct (of 92) | 59.8% | 98.9% | 98.9% | 98.9% |

**Read this honestly:** the last two columns are measured on the *same* 147 emails the fixes were written against, so they are optimistic. A fresh, unseen batch has not been scored yet. The first-run column is the uncontaminated number. The promotional filter also has a cost: 2 process emails that used to wait in "needs confirmation" are now folded away as promotional (see [docs/EVALUATION.md](./docs/EVALUATION.md)).

The first run is the interesting part: adding the model fixed company names almost completely (60% → 99%) but barely moved precision, because items that had been held back for "no company name" were now released onto the schedule *along with their other errors*. That is what led to the "veto, no vote" rule above.

## What the demo shows

| View | What it is |
|---|---|
| Today | The next thing to do with a countdown, what is due in 48 hours, and what needs a follow-up. |
| Schedule | One card per event: company, role, time in *your* time zone, the assessment link / meeting ID on the card. Mark done; past items you have not marked are asked about ("did you do it?") instead of being assumed done. |
| Calendar | The same items on a month grid, placed by the viewer's local date. |
| Needs confirmation | Items the system would not guess on, each with a plain-language reason: schedule it, record it only, ignore it, or mark the sender as an ad. Bulk select. |
| Applications | One row per company; status inferred from the emails (receipts and results count here and nowhere else), editable. Bulk "followed up, check again in 7 days". Cards instead of a table on phones. |
| Stats | Funnel, status breakdown, the next two weeks, weekly volume, and how much the system handled without help. |
| Emails | Every email, newest first: relevant ones on top, ignored ones (ads, codes) folded below with the reason, deleted ones in a restorable trash. |
| Settings | What the board has learned from you (blocked senders, renamed companies, confirmed time zones), each removable; clear all changes. |

Across all views: edit any item (the original email is never changed), undo the last step (button or Ctrl/Cmd+Z), search, and confirm twice before anything irreversible.

The demo ships 28 synthetic emails. Thirteen are each built to exercise one specific failure mode (a fixed exam slot, a relative "within 72 hours" deadline, an "effective at" trap, an English email for an event in Hong Kong, an invite with no time zone, a reminder that must merge, and so on); the other fifteen are three weeks of ordinary history (receipts, a second-round and a final interview, an offer, rejections) so the applications table and the stats have something to show. Model output for these samples was recorded once and is replayed in the browser, so the public site makes no API calls.

## The hosted product (`worker/`)

The demo is the front end only. `worker/` is the server side behind https://board.interviewtrack.me, on Cloudflare (Workers + D1 + Email Routing + Email Service), using the same engine and the same board component:

| Feature | How |
|---|---|
| Accounts | Sign in with an email one-time code (6 digits, 10 minutes, 5 attempts; per-email and per-IP rate limits; unknown addresses get the same answer so accounts cannot be enumerated), behind Cloudflare Turnstile. Open registration up to a seat cap. Every table is keyed by user; nobody sees anyone else's mail. |
| Real email in | Each user gets a private inbox address. Gmail forwards only recruiting mail with a one-paste filter; QQ Mail, NetEase 163 and Outlook forward everything, and the Worker keeps only what looks like recruiting mail (subject, body or a known applicant-tracking sender). The rest is dropped on arrival: not stored, never sent to the model. Forwarding confirmations (Gmail codes, QQ "accept" links) appear on the board as one-click buttons. Manual forwards (including QQ's multi-message forward) are unwrapped to the original sender and time. |
| Your time zone | You pick where you are and where you are job-hunting; times are shown in your zone with the original zone in the details. |
| Email reminders | The evening before an interview or exam, an email with the time (yours and theirs), the link, any exam code and your notes; 24 h and 3 h before an assessment deadline unless you marked it done. |
| Calendar subscription | A per-user `.ics` feed for Apple or Google Calendar, rings 30 minutes before by default. The link can be rotated if it leaks. |
| AI, optional | Quick add from one sentence; interview prep from the item's emails and your résumé (converted to text in the browser). Per-user daily quota; can be switched off, in which case only rules run. |
| Privacy | Plain-language privacy policy, delete-my-account, security headers, sign-in logs purged after 2 days, a 6-hourly health check. |

<img src="docs/images/reminder-email.png" alt="An email reminder: the interview time where you are and where it happens, the meeting link, exam code and your notes" width="520">

Deploy steps and the security notes are in [worker/README.md](./worker/README.md) (Chinese). Before deploying, replace the placeholders in `worker/wrangler.toml` (domain, e-mail, database id) with your own.

## Repository layout

```
engine/   Parsing engine. Pure TypeScript, zero runtime dependencies. 509 tests.
web/      Next.js app (the demo). The engine is vendored into web/lib/tracker-core. 166 tests.
worker/   Cloudflare Worker: email intake, accounts, reminders, calendar feed, AI endpoints, and the board (Vite). 138 tests.
docs/     Evaluation method and numbers.
```

## Run it

Requires Node.js 20.9 or later; the worker tests need 22.13 or later (they use node:sqlite).

```bash
# engine
cd engine
npm ci
npm test                 # 509 tests
npm run check            # type-check + tests with per-file coverage threshold

# web
cd web
npm ci
npm run dev              # http://localhost:3000
npm test                 # 166 tests
npm run check            # types + lint + tests + production build

# worker (install web first: the board reuses its components)
cd worker
npm ci
npm run check            # types + 138 tests + board build (needs Node 22.13+ for node:sqlite in tests)
```

To use a real model instead of the recorded output, any OpenAI-compatible chat endpoint works:

```bash
cd web
export LLM_BASE_URL=https://api.deepseek.com/v1 LLM_MODEL=deepseek-v4-pro LLM_API_KEY=...
npx vite-node scripts/record-extractions.ts
```

To score the engine on your own mailbox, see `engine/tools/eval-extract.ts` and `engine/tools/score-extract.ts`. Keep your emails and their outputs out of version control.

## Known limitations

- **Not validated on unseen email yet.** See the note under the results table.
- **The demo has no backend.** Manual edits there live in the browser's local storage. The server side lives in `worker/` (see above).
- **Beta.** Seats are capped and the sending quota is shared between sign-in codes and reminders. "Forward everything" has been verified end to end for QQ Mail; NetEase 163 and Outlook follow the same pattern but have not been walked through yet.
- **Promotional filtering is rule-based and in-sample.** Campus talks, live streams, job-board recommendations and "applications are open" mail are recognised from the subject line and folded; new marketing phrasings will slip through until a rule is added. The "mark as ad" button blocks a sender as a fallback.
- **"Conditional future" mentions.** A receipt that says "you will be invited to an assessment within 24 hours" is still classified as an assessment by the rules. It is now caught by the model's veto and held for confirmation, but the rule itself is not fixed.
- **Emails with no time-zone evidence** are held for confirmation by design, even when a human could guess the zone from the company.
- Source comments are in Chinese and occasionally reference internal design notes that are not part of this repository.

## What is not in this repository

Real emails, the hand-labelled truth set, and the regression tests that replay real emails are kept private. This repository contains code, synthetic data, and aggregate evaluation numbers only.

My own deployment's configuration (domain, e-mail addresses, database id, keys) is replaced with placeholders in `worker/wrangler.toml`. Secrets are never in the repository; they are set with `wrangler secret put`.

## How it was built

Built by one person working with an AI coding assistant (Claude). The product decisions, the invariants the engine must never break, and the acceptance of each change were mine; much of the code and the first-pass truth labelling were produced with the assistant. See [docs/EVALUATION.md](./docs/EVALUATION.md) for what that means for the numbers.

## License

MIT — see [LICENSE](./LICENSE).
