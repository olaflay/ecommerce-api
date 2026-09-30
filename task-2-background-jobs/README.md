# TASK 2: Background Jobs Done Properly

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.5-1B222D.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18.6-336791.svg)](https://www.postgresql.org/)
[![Vitest](https://img.shields.io/badge/Tests-32%2F32%20Passing-success.svg)](https://vitest.dev/)

A resilient, production-grade background job queue and worker execution system that takes slow, compute-heavy, and unreliable operations off the request path, survives process death, guarantees idempotency, and gives full visibility into every job state through a dead-letter queue and metrics API.

> **Verified, not asserted.** Every claim in this file is backed by a captured artifact in [`evidence/`](evidence/README.md) — the full 32-test suite running against a real PostgreSQL, a live boot of the API with real HTTP requests, and a database probe proving migrations applied without disturbing other schemas.

---

## 1. System Topology

```
[ Client / Producer ]
        │
        │ 1. POST /api/jobs (with idempotencyKey)
        ▼
┌───────────────────────────────────────────────────────────────┐
│                     API / Enqueue Path                        │
│  - Validates request with Zod (type allowlist, payload)       │
│  - Unique index on idempotencyKey enforced by the database    │
│  - Returns HTTP 202 Accepted immediately with the job ID      │
└───────────────────────────────┬───────────────────────────────┘
                                │  2. INSERT; on conflict, return the
                                │     existing row (isDuplicate: true)
                                ▼
┌───────────────────────────────────────────────────────────────┐
│               PostgreSQL Job Storage ("Job")                  │
│                                                               │
│   Columns:                                                    │
│   • id (uuid)              • attempts (int, default 0)        │
│   • type (varchar)         • maxAttempts (int, default 3)     │
│   • payload (jsonb)        • lastError (text)                 │
│   • status (enum)          • runAt (timestamptz)              │
│   • idempotencyKey (uniq)  • startedAt / finishedAt           │
│   • lastHeartbeatAt (timestamptz, nulled on completion)       │
└──────────────▲──────────────────────────────▲─────────────────┘
               │                              │
  3. Atomic claim (FOR UPDATE   4. Heartbeat (clock_timestamp())
     SKIP LOCKED, one statement)   + stuck-job sweeper
               │                              │
┌──────────────┴──────────────────────────────┴─────────────────┐
│                     Background Worker                        │
│                                                               │
│  ├── Concurrency cap (per-process, env-configurable)          │
│  ├── Idempotent output writer ("JobOutput", ON CONFLICT ...)  │
│  ├── Exponential backoff with jitter (DB-stamped runAt)       │
│  └── Heartbeat to prove liveness while a job is processing    │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Job State Lifecycle

A strict finite state machine across five statuses:

```
                  ┌───────────────┐
                  │    pending    │◄─────────────────┐
                  └───────┬───────┘                  │
                          │                          │ (Retry with
             Atomic Claim │                          │ exponential
                          ▼                          │ jittered backoff)
                  ┌───────────────┐                  │
                  │  processing   │                  │
                  └───────┬───────┘                  │
                          │                          │
              ┌───────────┴───────────┐              │
       Success│                  Error│              │
              ▼                       ▼              │
      ┌───────────────┐       ┌───────────────┐      │
      │   succeeded   │       │    failed     ├──────┘
      └───────────────┘       └───────┬───────┘
                                      │
                     attempts >= max  │
                                      ▼
                              ┌───────────────┐
                              │     dead      │ (DLQ: needs a human)
                              └───────┬───────┘
                                      │  POST /api/dead-letter/:id/retry
                                      ▼
                              ┌───────────────┐
                              │    pending    │
                              └───────────────┘
```

**Why `failed` differs from `dead`:**
- `failed` = a transient error, retries not exhausted. The row is scheduled via `runAt` for another attempt with exponential jittered backoff. No human needed.
- `dead` = `attempts >= maxAttempts`. The job is quarantined in the dead-letter queue with its original payload and `lastError` (message + stack, truncated) preserved for inspection. Recovery is a manual `POST /api/dead-letter/:id/retry`, which resets to `pending`, clears the error, and zeroes `attempts`.

---

## 3. Core Resilience Mechanisms

### 3.1 Atomic job claiming
One SQL statement performs the row lock **and** the pending→processing transition, so two workers can never double-claim:

```sql
UPDATE "Job"
SET status = 'processing'::"JobStatus",
    "startedAt" = NOW(),
    "lastHeartbeatAt" = NOW(),
    "updatedAt" = NOW()
WHERE id = (
  SELECT id FROM "Job"
  WHERE status IN ('pending'::"JobStatus", 'failed'::"JobStatus")
    AND "runAt" <= NOW()
  ORDER BY "runAt" ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

- `FOR UPDATE` locks the candidate exclusively.
- `SKIP LOCKED` makes concurrent workers skip an already-locked row instead of waiting, so N workers scale without lock contention.
- `failed` rows are claimable because `failed` means "scheduled to retry", a non-terminal state.

### 3.2 Exponential backoff with jitter
On failure the next retry slot is

```
delay = baseBackoffMs * 2^(attempts - 1) + uniform_random(0, maxJitterMs)
```

`runAt` is written **by the database** as `clock_timestamp() + (delayMs || ' milliseconds')::interval`, not by the app process — the claim query measures `runAt` against Postgres time, so a worker host with a drifted clock cannot make the fleet retry too early or too late. `clock_timestamp()` rather than `NOW()`, because `NOW()` is pinned to the transaction start, which began a network round trip ago and would silently shorten the delay.

*Why jitter:* dozens of jobs that fail together against a flapping third party would otherwise all retry at the same millisecond — a self-inflicted thundering herd against the very service that just went down.

### 3.3 Heartbeat + stuck-job sweeper
A running worker refreshes `lastHeartbeatAt` in SQL (`UPDATE ... SET "lastHeartbeatAt" = clock_timestamp() WHERE id = ... AND status = 'processing'`). A background sweeper recovers rows whose owner stopped heartbeating — one atomic statement, so two sweepers can't double-recover the same row:

```sql
UPDATE "Job" AS j
SET status = CASE
               WHEN j."attempts" + 1 >= j."maxAttempts" THEN 'dead'::"JobStatus"
               ELSE 'failed'::"JobStatus"
             END,
    "attempts" = j."attempts" + 1,
    "lastError" = 'Worker heartbeat stopped for more than <timeout>ms. Job recovered by sweeper.',
    "runAt" = clock_timestamp(),
    "startedAt" = NULL,
    "lastHeartbeatAt" = NULL,
    "finishedAt" = CASE
                     WHEN j."attempts" + 1 >= j."maxAttempts" THEN clock_timestamp()
                     ELSE NULL
                   END
WHERE j.id IN (
  SELECT s.id FROM "Job" AS s
  WHERE s.status = 'processing'::"JobStatus"
    AND (
      (s."lastHeartbeatAt" IS NOT NULL
        AND s."lastHeartbeatAt" <= clock_timestamp() - (<timeout> || ' milliseconds')::interval)
      OR (s."lastHeartbeatAt" IS NULL AND s."startedAt" IS NOT NULL
        AND s."startedAt" <= clock_timestamp() - (<timeout> || ' milliseconds')::interval)
    )
  ORDER BY s."lastHeartbeatAt" ASC NULLS FIRST, s."startedAt" ASC NULLS FIRST
  LIMIT <batchSize>
  FOR UPDATE SKIP LOCKED
)
RETURNING j.*;
```

Key properties:
- **Single clock.** `runAt`, `lastHeartbeatAt` write and the sweeper cutoff are all `clock_timestamp()` from the same database. An app host whose clock drifts cannot make healthy jobs look stuck or stuck jobs look healthy. Evidence (`evidence/clock-skew.txt`) shows this host is within ~430 ms of the DB clock, so the design is defensive rather than fixing a skew seen in practice.
- **`startedAt` fallback.** Rows written before the heartbeat column existed are still recovered by the `lastHeartbeatAt IS NULL` branch.
- **Grace, not brute force.** A job that legitimately outlives the stuck timeout is *not* declared stuck: the heartbeat keeps it fresh. This is explicitly tested (Test 3d).

### 3.4 Idempotent outputs
`JSend`-style, the output write and the status transition are one transaction. The output insert is atomic under concurrency:

```sql
INSERT INTO "JobOutput" ("id", "jobId", "result", "createdAt")
VALUES ($id, $jobId, $result, NOW())
ON CONFLICT ("jobId") DO NOTHING
RETURNING "result";
```

`ON CONFLICT DO NOTHING` is used instead of Prisma `upsert` deliberately: `upsert` with an empty `update` emits a plain `INSERT`, and two concurrent completions of the same job would collide on the unique index. With `ON CONFLICT`, the first writer's result wins and every concurrent caller returns it. The final `succeeded` transition is conditional on the row still being `processing`, so a recovered-and-re-claimed job is never stamped `succeeded` by its dead predecessor.

### 3.5 Concurrency cap (known limitation)
Each worker process runs at most `WORKER_CONCURRENCY` jobs. The cap is **per process, not global across a fleet** — the queue itself is unbounded by design. For a single-instance deployment (the bootcamp scope) the per-process cap is exactly the enforced limit, and Test 1 verifies it sticks under a 50-job burst. A fleet-wide cap would require a distributed semaphore or a shared reservation table, which is future work. See `DECISIONS.md`-style notes in the code comments for the reasoning.

---

## 4. API Reference

All endpoints serve the same response envelope: success under `data`, errors as `{ error: { code, message, details? } }`. Envelope, codes, and clamping contract carried over from Task 1.

| Method & path | Success | Errors |
|---|---|---|
| `GET /healthz` | `200 {status,timestamp,uptimeSeconds}` | — |
| `GET /` | `200` dashboard HTML | — |
| `POST /api/jobs` | `202` job row (or existing row + `isDuplicate: true`) | `422` validation, `400` bad JSON, `413` payload too large |
| `GET /api/jobs/:id` | `200` full job with `output` | `400` malformed UUID, `404` unknown |
| `GET /api/dead-letter?limit=&offset=` | `200` dead jobs + `meta` (`limit` default 20, max 100, clamps like Task 1) | — |
| `POST /api/dead-letter/:id/retry` | `200` job reset to `pending` | `400` bad UUID, `404` unknown, `409` not `dead` |
| `GET /api/metrics` | `200` counts per status + total | — |
| anything else | — | `404` NOT_FOUND |

**Enqueue request:**

```json
{ "type": "INVOICE_REPORT_GENERATION", "payload": { "customer": "Acme Inc" }, "idempotencyKey": "invoice-2026-09-001" }
```

`type` must be in `INVOICE_REPORT_GENERATION | THIRD_PARTY_WEBHOOK_DISPATCH | TEST_FAILING_JOB | SLOW_TEST_JOB`. A client typo otherwise becomes a well-formed job that fails `maxAttempts` times and pollutes the DLQ — hence the allowlist.

The interactive dashboard lives at `/` (not `/dead-letter`), dispatching sample jobs, showing metrics, listing the DLQ, and offering manual Retry.

Full contract edge cases are exercised in `tests/api-contract.test.ts` (21 tests), including CORS allowlist-ing, malformed JSON, the `413` ceiling, and pagination clamping.

---

## 5. Empirical Evidence

Two test suites, 32 tests, all passing in a single run (`evidence/test-run.log`, 194.88 s, exit code 0), driving **real worker child processes**, real SIGKILLs, and real concurrent requests against a remote PostgreSQL — not mocks:

```bash
npm test
```

| # | Attack scenario | Invariant verified | Result |
|---|---|---|---|
| 1 | Enqueue 50 jobs against one worker | concurrency never exceeds the cap; all 50 complete | PASS |
| 2 | 100%-failing job, `maxAttempts=3`, `BASE_BACKOFF_MS=2000` | `failed → failed → dead`; `runAt` strictly increasing; attempt spacing ~`2*base` | PASS |
| 3 | SIGKILL a real worker mid-job | sweeper recovers the orphaned row exactly once | PASS |
| 3b | Two concurrent sweepers on one stuck row | recovery is atomic; attempts incremented exactly once | PASS |
| 3c | Retries already spent when swept | swept straight to `dead`, not `failed` | PASS |
| 3d | Job legitimately outlives the stuck timeout | heartbeat keeps it alive; NOT declared stuck | PASS |
| 4 | Two concurrent requests, same idempotency key | both `202`; exactly one row | PASS |
| 4b | Concurrent HTTP duplicates | one row, same ID returned to all | PASS |
| 5 | Two real workers compete for 10 jobs | zero double claims; one output row each | PASS |
| 5b | Raw `claimNextJob()` race | concurrent claimers never receive the same row | PASS |
| 6 | Handler throws mid-job | passes through `failed` on the way to `dead` | PASS |
| +21 | HTTP contract suite | envelope, status codes, clamping, CORS, rate of health | PASS |

### Reproduce-by-hand smoke

`evidence/probe-api-smoke.ts` boots the real API on a scratch port and makes real HTTP requests (health, dashboard, idempotent enqueue, 422/400/404 paths, DLQ pagination, CORS headers over raw HTTP, because Node's `fetch()` strips `Origin`), then shuts it down. Transcript: `evidence/api-smoke.txt`. It runs against the isolated test schema and touches nothing in `public`.

---

## 6. Quick Start

Requirements: Node 20+, a PostgreSQL 14+ instance (the repo targets a managed Render instance, but any Postgres works).

1. `npm install`
2. `cp .env.example .env` and fill in `DATABASE_URL`. Optionally set `CORS_ALLOWED_ORIGINS` for browser clients on other origins (the served dashboard is same-origin and needs none).
3. `npm run db:deploy` — applies migrations to the configured database.
4. `npm run worker` — start a worker process (concurrency 5 by default).
5. `npm run dev:api` — start the API + dashboard.

### Scripts

| Script | Purpose |
|---|---|
| `dev:api` | API + dashboard (watch mode) |
| `worker` | background worker process |
| `start` | API only |
| `db:migrate` | `prisma migrate dev` (local schema work) |
| `db:deploy` | `prisma migrate deploy` (applies migrations to any DB) |
| `db:generate` | regenerate Prisma client |
| `db:test:deploy` | apply migrations to the isolated test schema |
| `db:test:reset` | destructively reset the isolated test schema |
| `test` | full suite (`break-it` + API contract) |
| `test:break-it` | adversarial worker/queue suite (11 tests) |
| `test:api` | HTTP contract suite (21 tests) |
| `typecheck` | `tsc --noEmit` |

### Environment variables (`.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | Postgres connection string with `sslmode=require` |
| `PORT` | `5000` | API port |
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `WORKER_CONCURRENCY` | `5` | per-process max parallel jobs |
| `MAX_ATTEMPTS` | `3` | default retry quota |
| `BASE_BACKOFF_MS` | `1000` | backoff base for `2^(attempts-1)` |
| `MAX_JITTER_MS` | `500` | uniform jitter ceiling |
| `STUCK_JOB_TIMEOUT_MS` | `30000` | heartbeat staleness before sweeper recovery |
| `POLL_INTERVAL_MS` | `500` | queue poll cadence |
| `SWEEP_INTERVAL_MS` | `10000` | sweeper cadence |
| `HEARTBEAT_INTERVAL_MS` | `10000` | worker heartbeat cadence (must be < `STUCK_JOB_TIMEOUT_MS`, enforced at boot) |
| `SWEEPER_BATCH_SIZE` | `50` | max rows per sweep pass |
| `MAX_ERROR_CHARS` | `4000` | `lastError` truncation length |
| `BODY_LIMIT` | `100kb` | request body ceiling |
| `CORS_ALLOWED_ORIGINS` | *(none)* | comma-separated browser origin allowlist; empty = no cross-origin access |
| `TEST_DATABASE_URL` / `TEST_DB_SCHEMA` | `DATABASE_URL` + `task2_test` | where the test suite runs |

### Tests never touch shared data
The suite runs against an isolated Postgres schema (`task2_test` by default; see `scripts/test-db.mjs` and `vitest.config.ts`). The `public` schema — Task 1's tables and this repo's demo rows — is untouched by any test. `evidence/db-verify.txt` proves it: the same database that reports 188 pre-existing `public.Job` rows passes the full run.

---

## 7. Operational Notes

- **Feeding free-tier Postgres.** The managed database here is a Render free instance: it suspends after idle and the first connection after waking can fail with `P1001` for a second or two. The worker/API reconnect on their normal poll cadence; the evidence probes include a warm-up retry so the artifacts record post-wake truth, not a sleep artifact.
- **Single clock on purpose.** All queue-time columns (`runAt`, `lastHeartbeatAt`, sweeper cutoff) come from Postgres `clock_timestamp()`. Do not "simplify" this to `new Date()` stamps — it is the difference between a fleet that respects retry slots and one that retries early or late when a host clock drifts.
- **Dashboard path.** The DLQ dashboard is at `/`. `GET /dead-letter` is intentionally not wired.
- **Git.** `.env` is gitignored; `.env.example` is the canonical shape. Real credentials must never be committed.

---

## 8. Defence Q&A

**Q: Two workers are running. How do you guarantee they never process the same job?**
> One atomic `UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`. The row lock and the status transition to `processing` happen in the same statement. Worker 2's subquery skips the locked row and claims the next candidate; it can never receive the same row. Verified by Test 5 and Test 5b.

**Q: Your worker crashed after doing the work but before marking the job done. What happens on restart?**
> The row stays `processing`; the sweeper recovers it once `lastHeartbeatAt` ages past `STUCK_JOB_TIMEOUT_MS`, setting status to `failed` (or `dead` if retries were spent) and incrementing `attempts`. The restarted worker re-claims it; the handler checks `JobOutput` by `jobId` first, and if an output exists it returns the stored result instead of re-running the side effect.

**Q: Why jitter? Show me the line.**
> `src/queue/index.ts`:
> ```ts
> const jitterMs = Math.floor(Math.random() * maxJitterMs);
> return { delayMs: baseDelay + jitterMs, jitterMs };
> ```
> Without it, a hundred jobs that failed together would retry at the same millisecond — a self-inflicted DDoS against the service that just flapped.

**Q: A job has been in `processing` for an hour. What does the system do and when?**
> Nothing, if the worker is alive — it heartbeats and the sweeper leaves it alone (Test 3d). If the worker died, the sweeper (every `SWEEP_INTERVAL_MS`, 10 s) recovers it by setting `failed` + a future `runAt` (or `dead`), resetting `startedAt`, and nulling the heartbeat.

**Q: What if two sweepers run?**
> Recovery is one statement with `FOR UPDATE SKIP LOCKED`; the loser matches zero rows. `attempts` is incremented inside the database, not computed from a stale in-memory copy. Verified by Test 3b.

---

## 9. Evidence Index

See [`evidence/README.md`](evidence/README.md) for the artifact map and how to re-run each probe.