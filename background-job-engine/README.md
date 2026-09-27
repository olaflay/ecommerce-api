# TASK 2: Background Jobs Done Properly

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Prisma](https://img.shields.io/badge/Prisma-6.5-1B222D.svg)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791.svg)](https://www.postgresql.org/)
[![Vitest](https://img.shields.io/badge/Tests-5%2F5%20Break--It%20Passing-success.svg)](https://vitest.dev/)

A resilient, production-grade background job queue and worker execution system designed to take slow, compute-heavy, and unreliable operations off the request path, survive process failure, guarantee idempotency, and provide full visibility into every job state.

---

## 1. System Topology & Architecture

```
[ Client / Producer ]
        │
        │ 1. POST /api/jobs (with idempotencyKey)
        ▼
┌───────────────────────────────────────────────────────────────┐
│                    API Gateway / Enqueue Path                 │
│  - Validates request payload with Zod                         │
│  - Enforces database unique index on idempotencyKey           │
│  - Returns HTTP 202 Accepted immediately with job ID          │
└───────────────────────────────┬───────────────────────────────┘
                                │
                                │ 2. INSERT ... ON CONFLICT DO NOTHING
                                ▼
┌───────────────────────────────────────────────────────────────┐
│              PostgreSQL Job Queue Storage ("Job")             │
│                                                               │
│   Columns:                                                    │
│   • id (UUID v4)             • attempts (Int, default 0)      │
│   • type (VarChar 100)       • maxAttempts (Int, default 3)   │
│   • payload (JSONB)          • lastError (Text)               │
│   • status (Enum)            • runAt (DateTime)               │
│   • idempotencyKey (Unique)  • startedAt / finishedAt         │
└───────────────────▲───────────────────────▲───────────────────┘
                    │                       │
      3. Atomic Claim                       │ 5. Heartbeat Sweep
 (FOR UPDATE SKIP LOCKED)                   │ (startedAt <= NOW - 30s)
                    │                       │
┌───────────────────┴───────────────────────┴───────────────────┐
│                  Background Worker Daemon                     │
│                                                               │
│  ├── Concurrency Cap Manager (processes at most N jobs)       │
│  ├── Work Execution Registry (Invoice report, Webhook sync)   │
│  ├── Idempotent Output Writer ("JobOutput" table)             │
│  ├── Exponential Backoff with Jitter Calculator               │
│  └── Stuck-Job Recovery Sweeper (recovers dead worker rows)   │
└───────────────────────────────────────────────────────────────┘
```

---

## 2. Job State Lifecycle

The status column enforces a strict finite state machine:

```
                  ┌───────────────┐
                  │    pending    │◄─────────────────┐
                  └───────┬───────┘                  │
                          │                          │ (Retry with
             Atomic Claim │                          │  exponential
                          ▼                          │  jittered backoff)
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
                              │     dead      │ (Requires human review /
                              └───────┬───────┘  manual retry via DLQ)
                                      │
                         Manual Retry │
                                      ▼
                              ┌───────────────┐
                              │    pending    │
                              └───────────────┘
```

### Why "failed" and "dead" are fundamentally different:
- **`failed`**: The job encountered a transient error (e.g. 503 from external webhook, temporary socket timeout), but **has not exhausted its retry quota**. It is scheduled for a future attempt via exponential backoff with jitter (`runAt = NOW() + delay`). No human intervention is needed.
- **`dead`**: The job has reached `maxAttempts` (default 3) and cannot proceed automatically. It moves to the **Dead-Letter Queue (DLQ)** to preserve system health and alert operators.

---

## 3. Core Resilience Engineering Mechanisms

### 3.1 Atomic Job Claiming (Eliminating Race Conditions)
To ensure that two concurrent workers never process the same job, claiming is executed as an **atomic single SQL statement** using row-level locking with `SKIP LOCKED`:

```sql
UPDATE "Job"
SET status = 'processing', "startedAt" = NOW(), "updatedAt" = NOW()
WHERE id = (
  SELECT id FROM "Job"
  WHERE status = 'pending' AND "runAt" <= NOW()
  ORDER BY "runAt" ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```
- `FOR UPDATE`: Locks the candidate row exclusively.
- `SKIP LOCKED`: Informs concurrent workers to skip already-locked candidate rows instead of blocking, enabling parallel scale without lock contention or duplicate execution.

### 3.2 Exponential Backoff with Jitter
When a job fails, the next retry timestamp is calculated using exponential backoff with randomized uniform jitter:
$$\text{Delay} = \text{baseBackoffMs} \times 2^{\text{attempts} - 1} + \text{random}(0, \text{maxJitterMs})$$

```typescript
export function calculateBackoffDelayMs(attempt: number, baseBackoffMs = 1000, maxJitterMs = 500) {
  const exponentialMultiplier = Math.pow(2, Math.max(0, attempt - 1));
  const baseDelay = baseBackoffMs * exponentialMultiplier;
  const jitterMs = Math.floor(Math.random() * maxJitterMs);
  return { delayMs: baseDelay + jitterMs, jitterMs };
}
```
*Why Jitter Matters:* If a third-party dependency experiences a transient network outage, dozens of failed jobs retry. Without jitter, all failed jobs retry at the exact same millisecond, creating a "thundering herd" that overwhelms the downstream service. Jitter spreads out retry arrivals evenly.

### 3.3 Stuck-Job Recovery (Worker Crash Protection)
If a worker crashes or is abruptly killed (`kill -9`) mid-execution, the claimed job row remains orphaned in `processing` status.
Our system runs a continuous background sweeper:
```typescript
const cutoff = new Date(Date.now() - config.stuckJobTimeoutMs);
const stuckJobs = await prisma.job.findMany({
  where: { status: "processing", startedAt: { lte: cutoff } }
});
```
Any job whose `startedAt` is older than `stuckJobTimeoutMs` (30s) is automatically recovered back to `pending` with an incremented attempt count.

### 3.4 Idempotent Work Outputs
Because a worker can crash after completing external work but before marking the job row `succeeded`, the job may be re-run by a second worker.
All work handlers inspect the `JobOutput` table first:
```typescript
const existingOutput = await prisma.jobOutput.findUnique({ where: { jobId } });
if (existingOutput) return { result: existingOutput.result };
```
Output results are snapshotted and keyed strictly by `jobId`.

---

## 4. API Reference

### 1. Enqueue Job
- **Path**: `POST /api/jobs`
- **Status**: `202 Accepted`
- **Request Body**:
  ```json
  {
    "type": "INVOICE_REPORT_GENERATION",
    "payload": { "customer": "Acme Inc", "amount": 500000 },
    "idempotencyKey": "invoice-2026-09-001"
  }
  ```
- **Response**:
  ```json
  {
    "data": {
      "id": "c1f7289b-8109-4bf9-8924-f7b539c8116d",
      "type": "INVOICE_REPORT_GENERATION",
      "status": "pending",
      "idempotencyKey": "invoice-2026-09-001",
      "isDuplicate": false,
      "message": "Job accepted for background processing"
    }
  }
  ```

### 2. Job Status
- **Path**: `GET /api/jobs/:id`
- **Response**: Returns full job state, attempt counts, execution timestamps, and error messages.

### 3. Dead-Letter Queue
- **List Dead Jobs**: `GET /api/dead-letter`
- **Retry Dead Job**: `POST /api/dead-letter/:id/retry` (resets status to `pending`, clears error, re-schedules immediately).

---

## 5. Break-It-On-Purpose Empirical Evidence

The system has been empirically verified using 5 adversarial test suites (`tests/break-it.test.ts`):

```bash
npm run test:break-it
```

| Test # | Adversarial Attack Scenario | Expected Invariant | Verified Terminal Result | Status |
|---|---|---|---|---|
| **Test 1** | Enqueue 50 jobs at once with worker running | Concurrency cap strictly enforced ($N \le 5$) | Max observed concurrency was exactly 5; zero queue runaway | **PASS** |
| **Test 2** | 100% failure simulation with `maxAttempts = 3` | Exponential jittered backoff ($1\text{s} \to 2\text{s} \to 4\text{s}$), transition to `dead` | Job progressed through attempts 1, 2, 3 and transitioned to DEAD | **PASS** |
| **Test 3** | Worker killed mid-job (simulated crash) | Stuck job swept and reset to `pending` with incremented attempt | Sweeper detected row older than 30s, recovered to pending | **PASS** |
| **Test 4** | Duplicate submission of same `idempotencyKey` | Exactly 1 job row created; 2nd call returns `isDuplicate: true` | DB count = 1; same job ID returned on both requests | **PASS** |
| **Test 5** | Two simultaneous workers competing for queue | Zero double claims across workers | Intersection of claimed job IDs between Worker 1 & 2 is strictly 0 | **PASS** |

---

## 6. Defence Questions & Prepared Answers

#### 1. Two workers are running. Walk me through exactly how you guarantee they never process the same job.
> **Answer:** We execute an atomic `UPDATE ... RETURNING` query combined with PostgreSQL's `SELECT ... FOR UPDATE SKIP LOCKED` inside a single statement. When Worker 1 acquires the lock on the top pending row, Worker 2's query does not block or wait; instead, `SKIP LOCKED` instructs Postgres to skip that locked row and claim the next available row. Because the row lock and status transition to `processing` occur atomically in the same query, two workers can never claim the same job.

#### 2. Your worker crashed after sending the email but before marking the job done. What happens when it restarts?
> **Answer:** When the worker crashed, the job row was left in `processing` status. After 30 seconds (configurable via `STUCK_JOB_TIMEOUT_MS`), our stuck-job sweeper detects that `startedAt` has exceeded the timeout and resets the row back to `pending`, incrementing `attempts`. When the restarted worker claims the job for attempt 2, the handler checks the `JobOutput` table using `jobId` as the unique key. If the output record exists, it skips sending the email a second time and marks the job `succeeded`.

#### 3. Why jitter? Show me the line.
> **Answer:** Jitter prevents thundering-herd stampedes where dozens of jobs that failed simultaneously due to a temporary network blip all retry at the exact same millisecond. In [`src/queue/index.ts`](src/queue/index.ts#L29):
> ```typescript
> const jitterMs = Math.floor(Math.random() * maxJitterMs);
> return { delayMs: baseDelay + jitterMs, jitterMs };
> ```
> Adding a randomized offset (0–500ms) desynchronizes retry arrivals and protects downstream services.

#### 4. A job has been in processing for an hour. What does your system do about it and when?
> **Answer:** Our stuck-job sweeper runs every 10 seconds (`SWEEP_INTERVAL_MS`). It queries all jobs in `status: 'processing'` where `startedAt <= NOW() - 30s`. The stuck job is caught on the sweeper's next pass, its attempt counter is incremented, its `lastError` is set to explain the heartbeat timeout, and its status is either reset to `pending` (if `attempts < maxAttempts`) or transitioned to `dead` (if attempts reached `maxAttempts`).
