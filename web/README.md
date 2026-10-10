# web

The Next.js app behind the live demo.

| Route | What it is |
|---|---|
| `/` | The main board: Schedule / Calendar / Needs confirmation / Applications / Stats / Emails. Static page; all parsing runs in the browser on synthetic emails. |
| `/board` | An earlier board (drag ordering, focus mode, prep notes). On a local machine it can read a SQLite ledger placed one directory above this folder; without one it shows built-in demo data. |

```bash
npm ci
npm run dev       # http://localhost:3000
npm test          # 359 tests
npm run check     # tsc + eslint + tests + production build
```

- `lib/tracker-core/` is a **generated copy** of `../engine/src`. Do not edit it; change the engine, run its tests, then `node scripts/sync-tracker-core.mjs`.
- `lib/demo/sampleEmails.ts` holds the synthetic emails (fictional companies, `.example` domains, dates generated relative to "now").
- `lib/demo/recordedExtractions.json` is recorded model output for those samples, replayed in the browser. Re-record with `scripts/record-extractions.ts`.
- Manual edits (confirm, remove, add, change status) are stored as *decisions* in `localStorage` and re-applied on top of freshly parsed results.
- `.env.local.example` is only needed for the optional Google Calendar connection on `/board`.

To deploy on Vercel, set the project's root directory to `web/`.
