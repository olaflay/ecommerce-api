# Evidence Index

Every artifact in this directory was **produced by running the real thing** against the shared managed PostgreSQL — not by hand-written claims. The database is a Render free instance, so it suspends after idle; the probes below include a warm-up retry so a recorded artifact reflects post-wake truth rather than a sleep artifact. Nothing below writes to the shared `public` schema except `db:deploy` (migrations) — the smoke and test probes use the isolated `task2_test` schema.

| Artifact | What it proves | Re-run command |
|---|---|---|
| `test-run.log` | Full suite: **2 files, 32/32 tests passed, exit code 0**, 194.88 s. 11 adversarial worker tests (real worker processes, SIGKILL, concurrency) + 21 HTTP contract tests against a real API. | `npm test` |
| `api-smoke.txt` | The API **boots and serves over real HTTP**: `/healthz`, dashboard at `/`, `/api/metrics`, `POST /api/jobs` 202 + idempotent replay (same id, `isDuplicate: true`), 422 unknown type (allowlist named), 400 malformed UUID, 404 unknown route, DLQ pagination, and CORS header behavior (allowed origin echoed, disallowed absent, preflights 204/blocked). The server log line `Invalid prisma.job.create ... Unique constraint failed` is the *expected*, caught duplicate path — the API still returns 202 to both callers. | `npx tsx evidence/probe-api-smoke.ts` |
| `db-verify.txt` | `npm run db:deploy` exit 0 ("No pending migrations"). Applied history in order: Task 1's `init` + `add_check_constraints`, this task's `init_job_queue` + `add_job_heartbeat`, and `apexride_ddl` — a sibling task's migration that landed in the same shared database, confirming this task lives alongside other work without stepping on it. DB probe exit 0: Postgres 18.6, schemas `public, task2_test`, **`public.Job` = 188 pre-existing rows preserved**, heartbeat + index columns present. | `npx tsx evidence/probe-migrations.ts` ; `npx tsx evidence/probe-db.ts` |
| `clock-skew.txt` | Host clock vs. database clock: median offset ~427 ms, within tolerance. All queue-time columns are DB-stamped (`clock_timestamp()`), so this documents that the single-clock design is defensive, not a fix for skew observed here. | `npx tsx evidence/probe-clock-skew.ts` |

## Probe scripts

- `probe-api-smoke.ts` — boots `src/api/server.ts` as a child on a scratch port, issues real requests (including raw-HTTP CORS checks, because Node's `fetch()` strips `Origin` / `Access-Control-Request-Method`), shuts the server down, and cleans the isolated schema it used.
- `probe-db.ts` — connectivity, `public.Job` columns / indexes / row count, schema list.
- `probe-migrations.ts` — applied migration history in order, row counts, Postgres version, `search_path`.
- `probe-clock-skew.ts` — 5 midpoint-compensated samples of `<db clock> - <host clock>` against `clock_timestamp()`, verdict within a 1000 ms tolerance.

## What the evidence deliberately does **not** show

- No secret values: probe outputs contain connection hostnames at most, never credentials (`.env` is gitignored and excluded from the transcript files).
- No fabricated test output: only real transcripts and real exit codes. When a claim in the README is present but not directly captured here, it cites the test name (e.g. Test 3b) rather than inventing numbers.