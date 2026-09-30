# Failed vs. Dead: The Architectural Distinction Most Queue Systems Get Wrong

Most background-job tutorials teach you to catch an exception and retry it. Some suggest a retry count of 3 or 5. But in production systems handling money, webhooks, or invoices, conflating **failed** and **dead** is the root cause of cascading outages, API ban-hammers, and poisoned workers.

Here is the operational reality from designing, heartbeating, and stress-testing an asynchronous PostgreSQL-backed job queue under real concurrency — two worker processes, hard SIGKILLs, and racing clients.

---

## 1. The Core Rule: `failed` vs. `dead`

A job system must maintain a strict state machine across five states:

```
[ pending ] ──(atomic claim: FOR UPDATE SKIP LOCKED)──> [ processing ]
     ▲                                                        │
     │ (retry with jittered backoff while attempts < max)     │
     ├────────────────────────────────────────────────────────┼─(handler throws)
     │                                                        ▼
[ succeeded ] <──(work completes; output snapshotted)── [ failed ]
                                                          │
                                  (attempts >= maxAttempts)
                                                          ▼
                                                      [ dead ] (DLQ)
```

**One sentence:**
> `failed` is a transient state awaiting a scheduled retry with exponential jittered backoff; `dead` is a terminal quarantine state requiring human investigation.

**Why you never conflate them:**
1. **Thundering herd.** If 100 webhook jobs fail together because a payment gateway hiccuped for two seconds, immediate fixed-interval retries hammer the failing service in lockstep.
2. **Infinite retry loop.** Without a DLQ, a permanently broken job — corrupt payload, invalid external ID — cycles forever, saturating worker CPU and database connections.
3. **Silent failure.** Deleting a failed job hides bugs. A `dead` job retains its exact input payload, timestamp history, and `lastError` (message + stack) for operator inspection.

---

## 2. Exponential Backoff with Jitter

```text
delay = baseDelayMs * 2^(attempts - 1) + uniform_random(0, maxJitterMs)
```

The test suite runs with `BASE_BACKOFF_MS=2000`, `MAX_JITTER_MS=100`, so a 100%-failing job is expected to progress `failed → failed → dead` at roughly 2 s and 4 s. The suite asserts spacing against the **durable columns** (`runAt - startedAt`), not in-memory timers, so a slow remote database cannot fake a pass. Shape of the assertion (`tests/break-it.test.ts` Test 2): per-attempt lower bound `>= expectedBase`, growth `runAt₂ − runAt₁ >= 2·base`, and `startedAt₃ >= runAt₂` — all measured from the rows the queue itself wrote. Without jitter, every retry wall would land at exactly 2000 ms and 4000 ms, in lockstep.

---

## 3. Race-Free Claiming with `FOR UPDATE SKIP LOCKED`

A `SELECT ... WHERE status = 'pending'` followed by an `UPDATE` is catastrophic with two workers: both read the same row and process it twice.

This engine claims atomically in a single statement — and `failed` rows are claimable too, because `failed` means "scheduled to retry", not "stop":

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

`SKIP LOCKED` makes a concurrent worker skip the locked row rather than block, so N workers scale with zero lock contention and zero double claims. (The lock lives for the statement only.)

### Proof
Test 5 — two real worker *processes* compete for 10 queued jobs:

```log
[Test 5 Proof] Worker 1 claimed: 10 jobs
[Test 5 Proof] Worker 2 claimed: 10 jobs
[Test 5 Proof] Overlapping claims between workers: 0
```

---

## 4. Surviving a Hard Worker Crash

`sweepStuckJobs()` runs one atomic statement: it selects `processing` rows whose heartbeat went stale (with a `startedAt` fallback for rows written before the heartbeat column existed), locks them `FOR UPDATE SKIP LOCKED`, and recovers them in the same statement — incrementing `attempts`, and choosing `dead` when the quota is spent:

```sql
UPDATE "Job" AS j
SET status = CASE
               WHEN j."attempts" + 1 >= j."maxAttempts" THEN 'dead'::"JobStatus"
               ELSE 'failed'::"JobStatus"
             END,
    "attempts" = j."attempts" + 1,
    "lastError" = 'Worker heartbeat stopped for more than <timeout>ms. Job recovered by sweeper.',
    "runAt" = clock_timestamp(),
    "startedAt" = NULL, "lastHeartbeatAt" = NULL,
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

Two correctness properties worth defending:

- **One sweep, one increment.** A `findMany` + per-row homegrown recovery would let two sweepers read the same stuck row and each burn a retry. Here the whole recovery is the single statement; the loser matches zero rows.
- **Single clock.** `runAt` / `lastHeartbeatAt` writes and the staleness cutoff all come from Postgres `clock_timestamp()`. A worker host whose clock drifts cannot make healthy jobs look stuck (re-executing side effects) or stuck jobs look fine.

### Proof
Test 3 — a real worker process is SIGKILLed mid-job; its row is backdated in the database to simulate the crash:

```log
[Test 3 Proof] job left orphaned in 'processing' with an old heartbeat
[Test 3 Proof] sweeper recovered it exactly once -> status failed, attempts 1
```

Test 3d proves the mirror image: a job that genuinely runs longer than the stuck timeout is **not** declared stuck, because its heartbeat keeps the row fresh.

---

## 5. Live Verification & Runnable cURL

The API and dashboard are proven live in `evidence/api-smoke.txt`. Point the commands at the running API (default `http://localhost:5000`).

### 1. Enqueue (returns `202 Accepted` immediately)
```bash
curl -s -X POST http://localhost:5000/api/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "type": "INVOICE_REPORT_GENERATION",
    "payload": { "customer": "Apex Global Logistics", "amount": 450000 },
    "idempotencyKey": "inv-apex-2026-001"
  }'
```
```json
{
  "data": {
    "id": "e9c1d683-1e52-44f2-95f0-b99ca8e488d6",
    "type": "INVOICE_REPORT_GENERATION",
    "status": "pending",
    "idempotencyKey": "inv-apex-2026-001",
    "isDuplicate": false,
    "message": "Job accepted for background processing"
  }
}
```
Resubmitting the same `idempotencyKey` returns the **same** `id` with `isDuplicate: true` — a unique index is the arbiter, so two racing clients cannot both create a row.

### 2. Poll status
```bash
curl -s http://localhost:5000/api/jobs/e9c1d683-1e52-44f2-95f0-b99ca8e488d6
```
Returns every column: status, `attempts`/`maxAttempts`, `runAt`, `startedAt`, `lastHeartbeatAt`, `finishedAt`, `lastError`, and the snapshotted `output`.

### 3. DLQ dashboard
Navigate to **`/`** (e.g. `http://localhost:5000/`) in a browser — the dashboard lives at the root, not `/dead-letter`. It shows live metrics cards, lists quarantined dead jobs with their stack traces, and exposes a one-click Retry.

### 4. Metrics
```bash
curl -s http://localhost:5000/api/metrics
# {"data":{"pending":0,"processing":1,"succeeded":10,"failed":0,"dead":1,"total":12}}
```

---

## 6. Defence Q&A

**Q: Two workers are running. Walk me through exactly how you guarantee they never process the same job.**
> One atomic statement: `UPDATE "Job" SET status='processing', "startedAt"=NOW(), "lastHeartbeatAt"=NOW() WHERE id = (SELECT id FROM "Job" WHERE status IN ('pending','failed') AND "runAt" <= NOW() ORDER BY "runAt" LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`. Worker 2's subquery skips the row Worker 1 locked, acquires the next candidate, and the same statement transition it to `processing`. The lock and the transition are indivisible — a second worker physically cannot receive the same row.

**Q: Your worker crashed after doing the work but before marking the job done. What happens when it restarts?**
> The row sits in `processing`; the sweeper recovers it once the heartbeat goes stale past `STUCK_JOB_TIMEOUT_MS`, setting it to `failed` (or `dead` if the quota is spent) and incrementing `attempts`. When the restarting worker or any other worker claims it, the handler checks `JobOutput` by `jobId` first. If the output already exists, it returns the stored result and does not re-run the side effect — the output insert uses `ON CONFLICT ("jobId") DO NOTHING`, so even two racing completions produce one row.

**Q: Why jitter? Show me the line.**
> In `src/queue/index.ts`:
> ```ts
> const jitterMs = Math.floor(Math.random() * maxJitterMs);
> return { delayMs: baseDelay + jitterMs, jitterMs };
> ```
> A hundred jobs that fail simultaneously during a downstream outage would otherwise all retry at the exact same millisecond — a self-inflicted distributed denial of service.

**Q: My worker host has a clock that's 5 minutes fast. Does the queue break?**
> No for any job lifecycle value it writes: `runAt` on retry, `lastHeartbeatAt`, and the sweeper's staleness cutoff are all stamped by Postgres (`clock_timestamp()`), so every comparison happens on one clock. The only app-side timestamps are informational `finishedAt`/`createdAt` defaults. `evidence/clock-skew.txt` shows this host within ~430 ms of the DB, so the design is defensive — and it costs nothing.

---

*Built for the Product Engineering Bootcamp (Task 2: Background Jobs Done Properly). Evidence: see [`evidence/README.md`](evidence/README.md).*