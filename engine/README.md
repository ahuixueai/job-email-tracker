# engine

The parsing engine. Pure TypeScript, zero runtime dependencies, so it runs unchanged in Node, in the browser and in edge runtimes.

```
RawEmail → toCleanEmail → prefilter → LLMExtractor → parseEmail → InboxStore
```

| Module | Responsibility |
|---|---|
| `rawEmail.ts`, `text.ts` | Strip quoted history, decode HTML entities, normalise full-width characters |
| `prefilter.ts`, `noise.ts` | Drop only what is provably not a recruiting email; default is to pass |
| `extract.ts`, `llmExtractor.ts` | Extraction interface, grounding check, OpenAI-compatible client, rule-only stub |
| `eventType.ts`, `eventFormat.ts` | What the email is (assessment, interview, receipt, result…) and in what form |
| `timezone.ts` | Time zone from explicit evidence only; never guessed, never defaulted |
| `dateParse.ts`, `timeParse.ts`, `relative.ts`, `dueType.ts` | Fixed start vs. deadline vs. date-only, absolute and relative |
| `company.ts`, `dedup.ts` | Company normalisation and the "same event" key that merges reminders |
| `confidence.ts`, `inbox.ts` | Confidence by weakest signal, routing to schedule / needs-confirmation / folded |
| `pipeline.ts` | Wires the above together and keeps the full trace of every decision |

```bash
npm ci
npm test          # 485 tests
npm run check     # tsc + tests + per-file line coverage >= 80%
```

Source comments are in Chinese. They sometimes cite an internal design note ("方案 v0.2") or a baseline report that are not part of this repository.

`tools/eval-extract.ts` and `tools/score-extract.ts` run and score the pipeline on your own exported emails; see `../docs/EVALUATION.md`.
