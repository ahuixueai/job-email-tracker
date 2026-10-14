# Evaluation

This document describes how the numbers in the README were produced, and what they do and do not show.

## Data

- **147 real recruiting emails** from the author's own mailbox, exported in one batch covering roughly 60 days.
- Composition after labelling: **92 process emails** (receipts, assessment invites, interview notices, requests for materials, results), **50 promotional emails** (job recommendations, campus-talk ads), **5 unrelated** (verification codes and similar).
- Chinese and English.

The emails, the labels and the per-email outputs are not published. Only aggregate numbers are.

## Labelling

Each email was read in full and labelled **without seeing the system's output**: kind (process / promo / other), company, acceptable event types, whether there is a time and of what nature (fixed start / deadline / none), the exact local time and zone where one exists, and the format (written test, online assessment, AI interview, phone, video, on-site).

**Limitation:** the labels were produced by an AI assistant working from the full text and have not been independently verified by a second human annotator. Where an email was genuinely ambiguous the label lists every acceptable answer, or marks the field as "no single right answer", rather than forcing one.

## Scoring

The full pipeline is run over every email and compared with the labels. Two things are kept strictly apart:

- **Wrong** — the system gave an answer and it was incorrect.
- **No answer** — the system said it was not sure (no company, no time, type not recognised) and sent the item to "needs confirmation".

This distinction is the point of the product: a withheld answer is designed behaviour, a wrong time on the schedule is the failure.

- **Precision** = of the items placed on the schedule, the share where company, event type, time nature and exact moment are *all* correct. Target: > 95%.
- **Recall** = of the 92 process emails, the share that reach the schedule fully correct. Target: > 70%.
- Exact moments are compared in UTC with a small tolerance. "Format" (phone / video / …) is reported separately and does not count toward precision.

Model extractions were recorded once (DeepSeek `deepseek-v4-pro`, temperature 0, no failed calls) and are **replayed** for every subsequent scoring run, so differences between columns come from code changes only, not from model variance.

## Results

| | Rules only | Rules + model, first run | Rules + model, after fixes | + promotional filter |
|---|---|---|---|---|
| Items placed on the schedule | 42 | 68 | 68 | 67 |
| …of which fully correct | 31 | 51 | 67 | 67 |
| **Precision** | 73.8% | 75.0% | 98.5% | **100.0%** |
| **Recall** (of 92) | 33.7% | 55.4% | 72.8% | **72.8%** |
| Promo / unrelated on the schedule (of 55) | 3 | 8 | 1 | **0** |
| Promo / unrelated in "needs confirmation" (of 55) | 14 | 13 | 11 | **2** |
| Process emails folded as promotional (of 92) | — | — | 0 | 2 |
| Process emails dropped by the prefilter | 1 | 1 | 0 | 0 |

Field-level, process emails only (correct · wrong · no answer):

| Field | Rules + model, first run | After fixes | + promotional filter |
|---|---|---|---|
| Company (92) | 91 · 0 · 1 | 91 · 0 · 1 | 91 · 0 · 1 |
| Event type (92) | 77 · 14 · 1 | 82 · 10 · 0 | 84 · 8 · 0 |
| Time nature (89) | 75 · 8 · 6 | 84 · 3 · 2 | 84 · 3 · 2 |
| Exact moment (42–43) | 35 · 3 · 4 | 41 · 0 · 2 | 41 · 0 · 2 |
| Format (45–46) | 37 · 8 · 0 | 45 · 1 · 0 | 45 · 1 · 0 |

None of the remaining event-type errors is on the schedule; they wait in "needs confirmation" (or, for the 2 noted above, are folded).

## What the first run showed

1. **The model solved company names** (59.8% → 98.9%, zero wrong).
2. **Precision barely moved** (73.8% → 75.0%). Items that had been held back for lacking a company name were released onto the schedule together with their other mistakes. Promotional emails on the schedule rose from 3 to 8.
3. **The main error source was the rules' event-type decision**, which fired on keywords: a receipt listing the hiring process ("screening → assessment → interview") was classified as an assessment.
4. **The model's event-type suggestion was better than the rules'** (85/92 vs 77/92), and it labelled 47 of 55 non-process emails as "not a process event" while never saying that about a real process email. At that point the design only consulted the suggestion when the rules had no opinion at all.

## What was changed

- **Disagreement gates the schedule.** When rules and model disagree on event type, the item is held for confirmation. The model cannot change the type or promote an item.
- **Time semantics.** "Effective at X, expires at Y" in one sentence; a deadline marker separated from the time by a short parenthetical; the model-selected time fragment now restricts *which* moments are considered while the surrounding context is still used to judge them; when the model selects a reply deadline but the email also contains a future fixed slot, the slot wins and the item is held for confirmation.
- **Prefilter.** An assessment invite that mentions an SMS verification code in its login instructions is no longer treated as a verification-code email.
- **Text cleaning.** HTML entities and zero-width characters are normalised before parsing.
- Additional relative-deadline phrasings, receipt and rejection phrasings, and a field → subject → body priority for format detection.

### Promotional filter (second round)

In daily use, campus-talk invitations, live streams, employer-brand surveys, job-board recommendations and "applications are open" emails kept landing in "needs confirmation": the rules found no process step, but the model labelled them as interviews, and at that point a model suggestion alone was enough to ask the user.

- The rules now recognise these from the **subject line** and mark the decision as **final**: the model's type suggestion is not consulted for them. Strong markers (campus talk, live stream, special session) fold the email even when the subject also says "offer" or "application received"; weaker ones ("applications open", "recommended jobs", mass mail from a job-board domain) only fold when the subject does *not* name a personal step ("interview invitation", "assessment notice", "application received"…).
- Effect on the same 147 emails: promo / unrelated mail in "needs confirmation" 11 → 2, on the schedule 1 → 0, precision 98.5% → 100%, recall unchanged.
- **Cost:** 2 process emails that previously waited in "needs confirmation" (neither was on the schedule) are now folded. Folded emails stay visible in the Emails view with the reason; they are not deleted.

Every change is covered by a synthetic regression test (`engine/test/realEmailFixes.test.ts`) that keeps the sentence structure that caused the error and nothing else from the original email.

## Threats to validity

- **The "after fixes" and "promotional filter" numbers are in-sample.** The fixes were written by studying errors on these 147 emails and then scored on the same 147. Expect lower numbers on unseen mail. A fresh batch has not been evaluated yet.
- **One mailbox, one job seeker, one season.** Sender mix and phrasing are specific to this sample.
- **Labels are not independently verified** (see above).
- **One email has no recorded model output.** It was dropped by the prefilter in the recorded run, so in the replay it is parsed by rules alone and lands in "needs confirmation".
- **One model.** Results with a different extraction model are unknown; the pipeline degrades to rules-only if a model call fails.

## Reproducing on your own mail

```bash
cd engine
# 1. run the pipeline with a live model and record its extractions
export LLM_BASE_URL=... LLM_MODEL=... LLM_API_KEY=...
npx vite-node tools/eval-extract.ts <emails.json> --out <predictions.jsonl> > <report.md>

# 2. label the emails yourself, then score (no network, no API key)
npx vite-node tools/score-extract.ts <emails.json> <truth.jsonl> <predictions.jsonl> > <score.md>
```

`emails.json` is an array of `{ "date_utc", "from", "subject", "snippet" }`. The truth-file schema is the `Truth` interface in `tools/score-extract.ts`. Keep all three files out of version control.
