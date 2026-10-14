# web

The Next.js app behind the live demo: one static page (`/`), all parsing runs in the browser on synthetic emails.

```bash
npm ci
npm run dev       # http://localhost:3000
npm test          # 156 tests
npm run check     # route types + tsc + eslint + tests + production build
```

| Path | What it is |
|---|---|
| `components/demo/` | The board: Today, Schedule, Calendar, Needs confirmation, Applications, Stats, Emails, Settings, detail panel, edit form. |
| `lib/demo/` | Pure logic behind the board: where each parsed email goes (`agenda.ts`), the applications table (`applications.ts`), your edits and undo (`userEdits.ts`), search, stats. |
| `lib/demo/sampleEmails.ts` | The synthetic emails (fictional companies, `.example` domains, dates relative to "now"). |
| `lib/demo/recordedExtractions.json` | Recorded model output for those samples, replayed in the browser. Re-record with `scripts/record-extractions.ts`. |
| `lib/tracker-core/` | A **generated copy** of `../engine/src`. Do not edit it; change the engine, run its tests, then `node scripts/sync-tracker-core.mjs` (`--check` only compares). |

Your edits in the demo (confirm, ignore, edit, mark done, delete, block a sender…) are stored in `localStorage` and re-applied on top of freshly parsed results; the emails themselves are never changed.

To deploy on Vercel, set the project's root directory to `web/`.
