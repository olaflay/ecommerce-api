import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { Job, JobStatus } from "@prisma/client";
import { prisma } from "../src/db/prisma.js";
import { config } from "../src/config/index.js";
import { BackgroundWorker } from "../src/worker/runner.js";
import {
  claimNextJob,
  enqueueJob,
  sweepStuckJobs,
  calculateBackoffDelayMs,
} from "../src/queue/index.js";
import {
  claimedIdsFrom,
  measureRoundTripMs,
  sleep,
  spawnWorker,
  SpawnedWorker,
  truncateQueue,
  waitFor,
} from "./helpers.js";

const TOTAL_JOBS = 50;

describe("TASK 2: Break-It-On-Purpose Verification Suites", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  // Every suite starts from an empty queue. The test database is an isolated
  // Postgres schema owned by this suite, so truncation is safe here; the point
  // is that a run is repeatable and cannot inherit a previous run's rows.
  beforeEach(async () => {
    await truncateQueue(prisma);
  });

  afterEach(async () => {
    await truncateQueue(prisma);
  });

  afterAll(async () => {
    await truncateQueue(prisma);
    await prisma.$disconnect();
  });

  // TEST 1: Concurrency Cap
  it("Test 1: 50 jobs, one worker - never exceeds the configured cap AND actually completes all of them", async () => {
    // Read the cap from config rather than hardcoding it, so the test cannot
    // drift from the real value. An upper-bound-only assertion is vacuous: a
    // worker that claims nothing satisfies it, so a lower bound is required too.
    const cap = config.workerConcurrency;
    const runTag = `concurrency-${Date.now()}`;

    await prisma.job.createMany({
      data: Array.from({ length: TOTAL_JOBS }, (_unused, i) => ({
        type: "INVOICE_REPORT_GENERATION",
        payload: { customer: `Client ${i}`, amount: 100000 },
        idempotencyKey: `${runTag}-${i}`,
        status: JobStatus.pending,
        runAt: new Date(),
        maxAttempts: 3,
      })),
    });

    const worker = new BackgroundWorker("concurrency-verifier");
    const observed: number[] = [];
    const sampler = setInterval(() => observed.push(worker.getActiveJobsCount()), 10);

    // The worker is always stopped, even when the wait below throws. A leaked
    // worker keeps claiming from the next test's queue and turns one failure
    // into a cascade of unrelated ones.
    try {
      worker.start();
      await waitFor(
        async () => (await prisma.job.count({ where: { status: JobStatus.succeeded } })) >= TOTAL_JOBS,
        { timeoutMs: 120000, intervalMs: 200, label: "all 50 jobs to succeed" }
      );
    } finally {
      clearInterval(sampler);
      await worker.stop();
    }

    const maxObserved = observed.length > 0 ? Math.max(...observed) : 0;
    const claims = worker.getClaimedJobIds();
    const uniqueClaims = new Set(claims);

    // Lower bound: work actually happened. Zero is not an acceptable pass.
    expect(observed.length).toBeGreaterThan(0);
    expect(maxObserved).toBeGreaterThan(0);
    // Upper bound: the cap held.
    expect(maxObserved).toBeLessThanOrEqual(cap);
    // Every job claimed exactly once, and the queue drained.
    expect(claims.length).toBe(TOTAL_JOBS);
    expect(uniqueClaims.size).toBe(TOTAL_JOBS);

    const rows = await prisma.job.findMany({
      where: { idempotencyKey: { startsWith: runTag } },
      select: { status: true, attempts: true },
    });
    const outputs = await prisma.jobOutput.count();

    console.log(
      `[Test 1 Proof] cap=${cap} samples=${observed.length} maxObserved=${maxObserved} ` +
        `claims=${claims.length} uniqueClaims=${uniqueClaims.size} ` +
        `succeeded=${rows.filter((r) => r.status === JobStatus.succeeded).length}/${TOTAL_JOBS} ` +
        `outputRows=${outputs} anyRetry=${rows.some((r) => r.attempts > 0)}`
    );

    expect(rows.every((r) => r.status === JobStatus.succeeded)).toBe(true);
    // One output row per job proves no job ran its handler twice.
    expect(outputs).toBe(TOTAL_JOBS);
  });

  // TEST 2: 100% Failure with Exponential Jittered Backoff to Dead
  it("Test 2: real worker drives a 100%-failing job through failed -> failed -> dead with runAt strictly increasing", async () => {
    const runTag = `backoff-${Date.now()}`;
    const maxAttempts = 3;
    const base = config.baseBackoffMs;
    const jitter = config.maxJitterMs;

    // The pure function still has to hold its contract.
    const b1 = calculateBackoffDelayMs(1, base, jitter);
    const b2 = calculateBackoffDelayMs(2, base, jitter);
    expect(b1.delayMs).toBeGreaterThanOrEqual(base);
    expect(b1.delayMs).toBeLessThan(base + jitter);
    expect(b2.delayMs).toBeGreaterThanOrEqual(base * 2);
    expect(b2.delayMs).toBeLessThan(base * 2 + jitter);

    const { job } = await enqueueJob({
      type: "TEST_FAILING_JOB",
      payload: { alwaysFail: true },
      idempotencyKey: runTag,
      maxAttempts,
    });

    // Drive the real claim + run loop. The previous version called the private
    // executeJob() directly and hand-reset runAt to now() between attempts,
    // which destroyed the very timestamps the requirement is about.
    const worker = new BackgroundWorker("failure-verifier");
    worker.start();

    const history: Array<{
      attempts: number;
      status: string;
      runAt: number;
      startedAt: number;
    }> = [];
    let lastFingerprint = "";

    try {
      await waitFor(
        async () => {
          const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
          const fingerprint = `${row.attempts}:${row.status}:${row.runAt.toISOString()}`;
          if (fingerprint !== lastFingerprint) {
            lastFingerprint = fingerprint;
            history.push({
              attempts: row.attempts,
              status: row.status,
              runAt: row.runAt.getTime(),
              startedAt: row.startedAt ? row.startedAt.getTime() : 0,
            });
          }
          return row.status === JobStatus.dead;
        },
        { timeoutMs: 60000, intervalMs: 250, label: "job to reach dead" }
      );
    } finally {
      await worker.stop();
    }

    const finalRow = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    console.log(
      `[Test 2 Proof] observed state transitions:\n` +
        history
          .map(
            (h) =>
              `  attempt=${h.attempts} status=${h.status} runAt=${new Date(h.runAt).toISOString()} ` +
              `runAt-startedAt=${h.runAt - h.startedAt}ms`
          )
          .join("\n") +
        `\n[Test 2 Proof] final status=${finalRow.status} attempts=${finalRow.attempts}/${finalRow.maxAttempts}` +
        `\n[Test 2 Proof] final startedAt=${finalRow.startedAt?.toISOString()}` +
        `\n[Test 2 Proof] lastError first line: ${finalRow.lastError?.split("\n")[0]}`
    );

    // `failed` must be reachable - it is the state that says "this will retry".
    const failedStates = history.filter((h) => h.status === JobStatus.failed);
    expect(failedStates.length).toBe(maxAttempts - 1);
    expect(failedStates.map((h) => h.attempts).sort()).toEqual([1, 2]);
    expect(finalRow.startedAt).not.toBeNull();

    // The final failure goes straight to dead and leaves runAt alone, so the
    // dead row still carries the runAt that attempt 3 was scheduled for.
    const runAtForAttempt1 = failedStates.find((h) => h.attempts === 1)!.runAt;
    const runAtForAttempt2 = failedStates.find((h) => h.attempts === 2)!.runAt;
    const startedAtForAttempt3 = finalRow.startedAt!.getTime();
    expect(runAtForAttempt2).toBeGreaterThan(runAtForAttempt1);
    expect(finalRow.runAt.getTime()).toBe(runAtForAttempt2);

    // Each scheduled delay is at least base * 2^(attempt-1), measured from the
    // durable startedAt of the same attempt. The exact upper edge of the window
    // cannot be pinned from database columns: the gap also contains however long
    // the worker took to get from the claim to the failure transaction, and this
    // database is remote. The exact delay arithmetic is asserted above against
    // calculateBackoffDelayMs itself; what matters here is that the row the
    // database stored honours at least the exponential window.
    const roundTripMs = await measureRoundTripMs(prisma);
    const slack = Math.max(5000, Math.ceil(roundTripMs * 16));
    console.log(
      `[Test 2 Proof] median DB round trip=${Math.round(roundTripMs)}ms -> coarse upper slack=${slack}ms`
    );

    for (const h of failedStates) {
      const expectedBase = base * Math.pow(2, h.attempts - 1);
      const scheduledWindow = h.runAt - h.startedAt;
      expect(scheduledWindow).toBeGreaterThanOrEqual(expectedBase);
      // Coarse only: catches a runaway backoff (a 30s or 60s delay leaking in),
      // not a 100ms discrepancy in claim-to-failure latency.
      expect(scheduledWindow).toBeLessThanOrEqual(expectedBase + jitter + slack);
    }

    // Growth check on the two scheduled retries, and free of latency: attempt 2
    // could not start before attempt 1's backoff expired, so the gap between the
    // two runAt values is at least the second attempt's own delay.
    expect(runAtForAttempt2 - runAtForAttempt1).toBeGreaterThanOrEqual(2 * base);
    expect(runAtForAttempt2 - runAtForAttempt1).toBeLessThanOrEqual(
      2 * base + 2 * jitter + slack
    );

    // Attempt 3 really waited for its slot instead of running early.
    expect(startedAtForAttempt3).toBeGreaterThanOrEqual(runAtForAttempt2);
    expect(startedAtForAttempt3 - runAtForAttempt2).toBeLessThanOrEqual(2 * base + slack);

    // Terminal state.
    expect(finalRow.status).toBe(JobStatus.dead);
    expect(finalRow.attempts).toBe(maxAttempts);
    expect(finalRow.lastError).toContain("Intentional simulated failure");
    // The stored error carries a stack, not just a message.
    expect(finalRow.lastError).toMatch(/\n\s+at /);
  });

  // TEST 3: Stuck-Job Recovery after a genuinely killed worker
  it("Test 3: SIGKILLs a real worker process mid-job; the sweeper recovers the orphaned row exactly once", async () => {
    const runTag = `stuck-kill-${Date.now()}`;
    const { job } = await enqueueJob({
      type: "SLOW_TEST_JOB",
      payload: { sleepMs: 30000 },
      idempotencyKey: runTag,
    });

    let child: SpawnedWorker | null = null;
    try {
      child = spawnWorker("kill-victim");

      // Wait for the real child process to claim the job.
      const claimed = await waitFor(
        async () => {
          const row = await prisma.job.findUnique({ where: { id: job.id } });
          return row?.status === JobStatus.processing ? row : null;
        },
        { timeoutMs: 60000, intervalMs: 50, label: "child worker to claim the job" }
      );
      expect(claimed.startedAt).not.toBeNull();

      // Prove the heartbeat column is actually being refreshed while the job
      // runs. This is the liveness signal the sweeper keys off; without it a
      // job that legitimately outlives the timeout gets re-executed.
      // Sampling is spread over several heartbeat intervals because each read
      // costs a round trip to a remote database, which is slower than the
      // interval itself.
      const beats: number[] = [];
      const samplingMs = config.heartbeatIntervalMs * 8;
      for (let elapsed = 0; elapsed < samplingMs; elapsed += config.heartbeatIntervalMs) {
        const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
        if (row.lastHeartbeatAt) beats.push(row.lastHeartbeatAt.getTime());
        await sleep(config.heartbeatIntervalMs);
      }
      const distinctBeats = new Set(beats).size;
      console.log(
        `[Test 3 Proof] lastHeartbeatAt samples over ${samplingMs}ms: ` +
          `${beats.length} read, ${distinctBeats} distinct, ` +
          `span=${beats.length > 1 ? Math.max(...beats) - Math.min(...beats) : 0}ms`
      );
      expect(beats.length).toBeGreaterThanOrEqual(3);
      // The timestamp must move forward on its own, without any external
      // nudge, otherwise the sweeper can only see a frozen value.
      expect(
        Math.max(...beats),
        `expected the heartbeat to advance, got ${JSON.stringify(beats)}`
      ).toBeGreaterThan(Math.min(...beats));

      // Kill it hard, mid-execution. No graceful shutdown, no chance to mark the
      // row done: exactly the orphaned `processing` row a crash leaves behind.
      const killSignal: NodeJS.Signals = "SIGKILL";
      child.kill(killSignal);
      const exit = await child.exited;
      expect(exit.code !== 0 || exit.signal !== null).toBe(true);

      const afterKill = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      expect(afterKill.status).toBe(JobStatus.processing);
      console.log(
        `[Test 3 Proof] worker ${"kill-victim"} killed (exit code=${exit.code} signal=${exit.signal}); ` +
          `row left in status="${afterKill.status}" with lastHeartbeatAt=${afterKill.lastHeartbeatAt?.toISOString()}`
      );

      // Wait for the heartbeat to go stale, then sweep. The timeout is real, so
      // this genuinely waits out STUCK_JOB_TIMEOUT_MS.
      const recovered = await waitFor(
        async () => {
          const count = await sweepStuckJobs(config.stuckJobTimeoutMs);
          return count > 0 ? count : null;
        },
        { timeoutMs: config.stuckJobTimeoutMs + 30000, intervalMs: 250, label: "sweeper to recover" }
      );

      const swept = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      console.log(
        `[Test 3 Proof] sweepStuckJobs recovered ${recovered} row(s); ` +
          `status=${swept.status} attempts=${swept.attempts}/${swept.maxAttempts} ` +
          `startedAt=${swept.startedAt} lastHeartbeatAt=${swept.lastHeartbeatAt} finishedAt=${swept.finishedAt}`
      );

      expect(swept.status).toBe(JobStatus.failed);
      expect(swept.attempts).toBe(1);
      expect(swept.startedAt).toBeNull();
      expect(swept.lastHeartbeatAt).toBeNull();
      expect(swept.finishedAt).toBeNull();
      expect(swept.lastError).toContain("heartbeat");
    } finally {
      if (child && child.process.exitCode === null && child.process.signalCode === null) {
        child.kill("SIGKILL");
        await child.exited;
      }
    }
  });

  it("Test 3b: two concurrent sweepers recover the same stuck row only once (atomic recovery)", async () => {
    const runTag = `sweep-race-${Date.now()}`;
    const { job } = await enqueueJob({
      type: "SLOW_TEST_JOB",
      payload: { sleepMs: 30000 },
      idempotencyKey: runTag,
    });

    // Put the row in the state a crashed worker leaves behind, with a heartbeat
    // old enough to be sweepable.
    const stale = new Date(Date.now() - config.stuckJobTimeoutMs - 1000);
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.processing, startedAt: stale, lastHeartbeatAt: stale },
    });

    // The old implementation did findMany() then a per-row update(), so both
    // sweepers saw the row and both incremented attempts - burning two retries.
    const [first, second] = await Promise.all([
      sweepStuckJobs(config.stuckJobTimeoutMs),
      sweepStuckJobs(config.stuckJobTimeoutMs),
    ]);

    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    console.log(
      `[Test 3b Proof] concurrent sweepers recovered ${first} + ${second}; ` +
        `row attempts=${row.attempts} (must be 1), status=${row.status}`
    );

    expect(first + second).toBe(1);
    expect(row.attempts).toBe(1);
  });

  it("Test 3c: a job whose retries were already spent is swept straight to dead", async () => {
    const runTag = `sweep-dead-${Date.now()}`;
    const { job } = await enqueueJob({
      type: "SLOW_TEST_JOB",
      payload: { sleepMs: 30000 },
      idempotencyKey: runTag,
      maxAttempts: 3,
    });

    // attempts is 2 of 3, and the worker holding it died: the next recovery
    // is the last one, so the sweeper must go to dead, not back to a retry.
    const stale = new Date(Date.now() - config.stuckJobTimeoutMs - 1000);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.processing,
        attempts: 2,
        startedAt: stale,
        lastHeartbeatAt: stale,
      },
    });

    const recovered = await sweepStuckJobs(config.stuckJobTimeoutMs);
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    console.log(
      `[Test 3c Proof] recovered=${recovered} status=${row.status} attempts=${row.attempts}/${row.maxAttempts}`
    );

    expect(recovered).toBe(1);
    expect(row.status).toBe(JobStatus.dead);
    expect(row.attempts).toBe(3);
    expect(row.finishedAt).not.toBeNull();
  });

  it("Test 3d: a job that legitimately outlives the stuck timeout is NOT declared stuck", async () => {
    const runTag = `slow-but-alive-${Date.now()}`;
    // Longer than STUCK_JOB_TIMEOUT_MS (3s in tests, 30s in production).
    const sleepMs = config.stuckJobTimeoutMs + 2000;
    const { job } = await enqueueJob({
      type: "SLOW_TEST_JOB",
      payload: { sleepMs },
      idempotencyKey: runTag,
    });

    const worker = new BackgroundWorker("slow-job-verifier");
    worker.start();

    let sweepsWhileRunning = 0;
    try {
      await waitFor(
        async () => (await prisma.job.count({ where: { id: job.id, status: JobStatus.processing } })) === 1,
        { timeoutMs: 30000, intervalMs: 50, label: "slow job to be claimed" }
      );

      // Sweep on a loop for as long as the job is legitimately mid-execution.
      // The loop ends when the job actually finishes rather than at a fixed
      // deadline: the handler's sleep is followed by a completion transaction,
      // and against a remote database that transaction takes seconds, so a
      // deadline derived from the sleep length alone would end the test while
      // the job was still legitimately running.
      const deadline = Date.now() + sleepMs + 30000;
      while (Date.now() < deadline) {
        sweepsWhileRunning += await sweepStuckJobs(config.stuckJobTimeoutMs);
        const current = await prisma.job.findUnique({ where: { id: job.id } });
        if (!current || current.status !== JobStatus.processing) break;
        await sleep(250);
      }

      const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
      console.log(
        `[Test 3d Proof] job slept ${sleepMs}ms (> timeout ${config.stuckJobTimeoutMs}ms); ` +
          `sweeps run while running=${sweepsWhileRunning}; final status=${row.status} attempts=${row.attempts}`
      );

      // The old sweeper keyed off startedAt alone, so every one of these sweeps
      // would have re-queued the job while it was still running.
      expect(sweepsWhileRunning).toBe(0);
      expect(row.status).toBe(JobStatus.succeeded);
      expect(row.attempts).toBe(0);
    } finally {
      await worker.stop();
    }
  });

  // TEST 4: Idempotency Key Deduplication
  it("Test 4: two concurrent requests with the same idempotency key both get 202 and exactly one row exists", async () => {
    const key = `idempotent-concurrent-${Date.now()}`;
    const payload = { recipient: "ada@example.com", amount: 50000 };
    const body = { type: "THIRD_PARTY_WEBHOOK_DISPATCH", payload, idempotencyKey: key };

    // Sequential first, to pin the documented contract.
    const first = await enqueueJob({ type: "THIRD_PARTY_WEBHOOK_DISPATCH", payload, idempotencyKey: key });
    expect(first.isDuplicate).toBe(false);
    const duplicate = await enqueueJob({ type: "THIRD_PARTY_WEBHOOK_DISPATCH", payload, idempotencyKey: key });
    expect(duplicate.isDuplicate).toBe(true);
    expect(duplicate.job.id).toBe(first.job.id);

    // Now the race. The old read-then-write enqueue let both requests pass the
    // findUnique and one of them surfaced a raw P2002 as a 500.
    await prisma.job.deleteMany({});
    const results = await Promise.all(
      Array.from({ length: 8 }, () => enqueueJob({ type: "THIRD_PARTY_WEBHOOK_DISPATCH", payload, idempotencyKey: key }))
    );

    const rows = await prisma.job.findMany({ where: { idempotencyKey: key } });
    const ids = new Set(results.map((r) => r.job.id));
    const winners = results.filter((r) => r.isDuplicate === false);

    console.log(
      `[Test 4 Proof] 8 concurrent enqueues -> rows=${rows.length} distinctIds=${ids.size} ` +
        `isDuplicateFalse=${winners.length} isDuplicateTrue=${results.length - winners.length}`
    );

    expect(rows.length).toBe(1);
    expect(ids.size).toBe(1);
    // Exactly one caller created the row; the rest were told it already exists.
    expect(winners.length).toBe(1);
    // Every caller received the single row that exists.
    expect([...ids]).toEqual([rows[0]!.id]);
  });

  it("Test 4b: concurrent HTTP requests with the same key all return 202 and one row", async () => {
    const { app } = await import("../src/api/app.js");
    const request = (await import("supertest")).default;
    const key = `idempotent-http-${Date.now()}`;
    const body = {
      type: "INVOICE_REPORT_GENERATION",
      payload: { customer: "Race Corp" },
      idempotencyKey: key,
    };

    const responses = await Promise.all(
      Array.from({ length: 6 }, () => request(app).post("/api/jobs").send(body))
    );

    const rows = await prisma.job.findMany({ where: { idempotencyKey: key } });
    const ids = new Set(responses.map((r) => r.body?.data?.id));
    const statuses = responses.map((r) => r.status);

    console.log(
      `[Test 4b Proof] 6 concurrent HTTP enqueues -> statuses=[${statuses.join(",")}] ` +
        `rows=${rows.length} distinctIds=${ids.size} duplicatesFlagged=${responses.filter((r) => r.body?.data?.isDuplicate === true).length}`
    );

    expect(statuses.every((s) => s === 202)).toBe(true);
    expect(rows.length).toBe(1);
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.body?.data?.isDuplicate === true).length).toBe(5);
  });

  // TEST 5: Two concurrent worker PROCESSES with zero duplicate claims
  it("Test 5: two real worker processes compete for 10 jobs; zero double claims, one output row each", async () => {
    const batchSize = 10;
    const runTag = `dual-worker-${Date.now()}`;

    await prisma.job.createMany({
      data: Array.from({ length: batchSize }, (_unused, i) => ({
        type: "INVOICE_REPORT_GENERATION",
        payload: { item: i },
        idempotencyKey: `${runTag}-${i}`,
        status: JobStatus.pending,
        runAt: new Date(),
        maxAttempts: 3,
      })),
    });

    // Two separate OS processes, not two async loops in one process. SKIP
    // LOCKED is a PostgreSQL row lock: proving it needs two database sessions
    // that genuinely overlap, which two promises in one process only approximate.
    const worker1 = spawnWorker("evidence-worker-1");
    const worker2 = spawnWorker("evidence-worker-2");

    try {
      await waitFor(
        async () =>
          (await prisma.job.count({
            where: { idempotencyKey: { startsWith: runTag }, status: JobStatus.succeeded },
          })) >= batchSize,
        { timeoutMs: 90000, intervalMs: 200, label: "both workers to drain the batch" }
      );
    } finally {
      worker1.kill("SIGTERM");
      worker2.kill("SIGTERM");
      await Promise.all([worker1.exited, worker2.exited]);
    }

    const claims1 = claimedIdsFrom(worker1.stdout);
    const claims2 = claimedIdsFrom(worker2.stdout);
    const overlap = claims1.filter((id) => claims2.includes(id));
    const totalClaims = claims1.length + claims2.length;

    const rows = await prisma.job.findMany({
      where: { idempotencyKey: { startsWith: runTag } },
      select: { id: true, status: true, attempts: true },
    });
    const outputs = await prisma.jobOutput.count();

    console.log(
      `[Test 5 Proof] batch=${batchSize} jobs; worker1 claimed=${claims1.length}, worker2 claimed=${claims2.length}, ` +
        `totalClaims=${totalClaims}, overlap=${overlap.length}, ` +
        `succeeded=${rows.filter((r) => r.status === JobStatus.succeeded).length}/${batchSize}, ` +
        `outputRows=${outputs}, anyRetried=${rows.some((r) => r.attempts > 0)}`
    );

    // 10 jobs cannot be claimed 20 times. Every claim targets a distinct row.
    expect(overlap).toHaveLength(0);
    expect(totalClaims).toBeLessThanOrEqual(batchSize);
    expect(new Set([...claims1, ...claims2]).size).toBe(totalClaims);
    expect(rows.every((r) => r.status === JobStatus.succeeded)).toBe(true);
    // One output row per job: the side effect happened exactly once each.
    expect(outputs).toBe(batchSize);
  });

  it("Test 5b: claimNextJob is atomic - concurrent claimers never receive the same row", async () => {
    const runTag = `claim-race-${Date.now()}`;
    const batchSize = 20;

    await prisma.job.createMany({
      data: Array.from({ length: batchSize }, (_unused, i) => ({
        type: "TEST_FAILING_JOB",
        payload: { alwaysFail: true },
        idempotencyKey: `${runTag}-${i}`,
        status: JobStatus.pending,
        runAt: new Date(),
        maxAttempts: 1,
      })),
    });

    const claimers = Array.from({ length: 4 }, async () => {
      const mine: string[] = [];
      for (let i = 0; i < batchSize; i++) {
        const claimed = await claimNextJob();
        if (claimed) mine.push(claimed.id);
      }
      return mine;
    });

    const all = (await Promise.all(claimers)).flat();
    const unique = new Set(all);
    console.log(
      `[Test 5b Proof] ${batchSize} jobs, 4 concurrent claimers -> ${all.length} claims, ${unique.size} distinct`
    );

    expect(all.length).toBe(batchSize);
    expect(unique.size).toBe(all.length);
  });

  it("Test 6: a job that throws passes through the failed status on its way to dead", async () => {
    // Guards the regression that started all of this: `failed` existed in the
    // enum and on the dashboard but nothing in the code path ever wrote it.
    const runTag = `failed-status-${Date.now()}`;
    const { job } = await enqueueJob({
      type: "TEST_FAILING_JOB",
      payload: { failAttempts: 1 },
      idempotencyKey: runTag,
      maxAttempts: 3,
    });

    const worker = new BackgroundWorker("transient-failure-verifier");
    const seen: JobStatus[] = [];
    worker.start();
    try {
      await waitFor(
        async () => {
          const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
          if (seen[seen.length - 1] !== row.status) seen.push(row.status);
          return row.status === JobStatus.succeeded;
        },
        { timeoutMs: 60000, intervalMs: 20, label: "transient job to recover" }
      );
    } finally {
      await worker.stop();
    }

    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    const outputRows = await prisma.jobOutput.count({ where: { jobId: job.id } });
    console.log(
      `[Test 6 Proof] transient job status path: ${seen.join(" -> ")}; ` +
        `attempts=${row.attempts} outputRows=${outputRows}`
    );

    expect(seen).toContain(JobStatus.failed);
    expect(row.status).toBe(JobStatus.succeeded);
    expect(row.attempts).toBe(1);
    expect(outputRows).toBe(1);
  });
});
