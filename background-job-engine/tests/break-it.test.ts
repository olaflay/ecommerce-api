import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/api/app.js";
import { prisma } from "../src/db/prisma.js";
import { BackgroundWorker } from "../src/worker/runner.js";
import {
  enqueueJob,
  claimNextJob,
  sweepStuckJobs,
  calculateBackoffDelayMs,
} from "../src/queue/index.js";
import { JobStatus } from "@prisma/client";

describe("TASK 2: Break-It-On-Purpose Verification Suites", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // TEST 1: Concurrency Cap
  it("Test 1: Enqueues 50 jobs at once and confirms the concurrency cap strictly holds", async () => {
    const concurrencyCap = 5;
    const totalJobs = 50;

    // Batch insert 50 pending jobs in one SQL command for speed and reliability
    const enqueuedKeys: string[] = [];
    const jobsData = [];
    const timestamp = Date.now();
    for (let i = 0; i < totalJobs; i++) {
      const key = `concurrency-test-${timestamp}-${i}`;
      enqueuedKeys.push(key);
      jobsData.push({
        type: "INVOICE_REPORT_GENERATION",
        payload: { customer: `Client ${i}`, amount: 100000 },
        idempotencyKey: key,
        status: JobStatus.pending,
        runAt: new Date(),
        maxAttempts: 3,
      });
    }

    await prisma.job.createMany({ data: jobsData });

    const worker = new BackgroundWorker("concurrency-verifier");
    const observedConcurrency: number[] = [];

    // Sample active job counts every 25ms during execution
    const sampler = setInterval(() => {
      observedConcurrency.push(worker.getActiveJobsCount());
    }, 25);

    worker.start();

    // Allow worker to claim and process concurrently for 4 seconds
    await new Promise((resolve) => setTimeout(resolve, 4000));

    clearInterval(sampler);
    await worker.stop();

    // Verify that observed concurrency never breached the cap
    const maxObserved = Math.max(...observedConcurrency, 0);
    console.log(
      `[Test 1 Proof] Max observed concurrent jobs: ${maxObserved} (Cap: ${concurrencyCap})`
    );
    expect(maxObserved).toBeLessThanOrEqual(concurrencyCap);
  }, 45000);

  // TEST 2: 100% Failure with Exponential Jittered Backoff to Dead
  it("Test 2: Fails 100% of the time, progresses through attempts, logs backoff, and lands in DEAD status", async () => {
    const key = `failing-test-${Date.now()}`;
    const maxAttempts = 3;

    // Verify calculation formula: base * 2^(attempts-1) + jitter
    const b1 = calculateBackoffDelayMs(1, 1000, 500);
    const b2 = calculateBackoffDelayMs(2, 1000, 500);
    const b3 = calculateBackoffDelayMs(3, 1000, 500);

    expect(b1.delayMs).toBeGreaterThanOrEqual(1000);
    expect(b1.delayMs).toBeLessThanOrEqual(1500);
    expect(b2.delayMs).toBeGreaterThanOrEqual(2000);
    expect(b2.delayMs).toBeLessThanOrEqual(2500);
    expect(b3.delayMs).toBeGreaterThanOrEqual(4000);
    expect(b3.delayMs).toBeLessThanOrEqual(4500);

    console.log(
      `[Test 2 Proof] Backoff progression with jitter: Attempt 1: ${b1.delayMs}ms, Attempt 2: ${b2.delayMs}ms, Attempt 3: ${b3.delayMs}ms`
    );

    // Enqueue failing job
    const { job } = await enqueueJob({
      type: "TEST_FAILING_JOB",
      payload: { alwaysFail: true },
      idempotencyKey: key,
      maxAttempts,
    });

    const worker = new BackgroundWorker("failure-verifier");

    // Manually drive the 3 attempts sequentially to observe transition to dead
    // Attempt 1
    let currentJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    await (worker as any).executeJob(currentJob);
    const afterAttempt1 = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(afterAttempt1.status).toBe(JobStatus.pending);
    expect(afterAttempt1.attempts).toBe(1);

    // Fast-forward runAt for Attempt 2
    currentJob = await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await (worker as any).executeJob(currentJob);
    const afterAttempt2 = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(afterAttempt2.status).toBe(JobStatus.pending);
    expect(afterAttempt2.attempts).toBe(2);

    // Fast-forward runAt for Final Attempt 3
    currentJob = await prisma.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await (worker as any).executeJob(currentJob);
    const finalDeadJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    // Must be DEAD after exhausting maxAttempts
    console.log(
      `[Test 2 Proof] Final Job Status: ${finalDeadJob.status}, Attempts: ${finalDeadJob.attempts}/${finalDeadJob.maxAttempts}, Error: ${finalDeadJob.lastError}`
    );
    expect(finalDeadJob.status).toBe(JobStatus.dead);
    expect(finalDeadJob.attempts).toBe(3);
    expect(finalDeadJob.lastError).toContain("Intentional simulated failure");
  }, 45000);

  // TEST 3: Stuck-Job Recovery after Worker Crash
  it("Test 3: Simulates killed worker mid-job and confirms stuck job is recovered by sweeper", async () => {
    const key = `stuck-recovery-${Date.now()}`;
    const { job } = await enqueueJob({
      type: "INVOICE_REPORT_GENERATION",
      payload: { customer: "Crashed Node Worker" },
      idempotencyKey: key,
    });

    // Simulate worker crashing while job is in "processing":
    // Set status = processing, and backdate startedAt by 60 seconds (older than timeout 30s)
    const crashedStartedAt = new Date(Date.now() - 60000);
    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: JobStatus.processing,
        startedAt: crashedStartedAt,
      },
    });

    console.log(`[Test 3 Proof] Job ${job.id} simulated as stuck in processing since ${crashedStartedAt.toISOString()}`);

    // Execute stuck-job sweeper (timeout 30,000ms)
    const recoveredCount = await sweepStuckJobs(30000);
    expect(recoveredCount).toBeGreaterThanOrEqual(1);

    // Verify job was reset to pending with incremented attempt count
    const recoveredJob = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    console.log(
      `[Test 3 Proof] Recovered Job State: Status: ${recoveredJob.status}, Attempts: ${recoveredJob.attempts}, Error: ${recoveredJob.lastError}`
    );
    expect(recoveredJob.status).toBe(JobStatus.pending);
    expect(recoveredJob.attempts).toBe(1);
    expect(recoveredJob.lastError).toContain("Worker heartbeat timeout exceeded");
  }, 30000);

  // TEST 4: Idempotency Key Deduplication
  it("Test 4: Submits the same idempotency key twice and confirms exactly one job exists", async () => {
    const key = `idempotent-single-row-${Date.now()}`;
    const payload = { recipient: "ada@example.com", amount: 50000 };

    // 1st request via HTTP endpoint
    const res1 = await request(app).post("/api/jobs").send({
      type: "THIRD_PARTY_WEBHOOK_DISPATCH",
      payload,
      idempotencyKey: key,
    });
    expect(res1.status).toBe(202);
    expect(res1.body.data.isDuplicate).toBe(false);
    const originalJobId = res1.body.data.id;

    // 2nd request with IDENTICAL idempotencyKey
    const res2 = await request(app).post("/api/jobs").send({
      type: "THIRD_PARTY_WEBHOOK_DISPATCH",
      payload,
      idempotencyKey: key,
    });
    expect(res2.status).toBe(202);
    expect(res2.body.data.isDuplicate).toBe(true);
    expect(res2.body.data.id).toBe(originalJobId);

    // Confirm database row count is strictly 1
    const matchingJobs = await prisma.job.findMany({
      where: { idempotencyKey: key },
    });
    console.log(
      `[Test 4 Proof] Database rows with key '${key}': ${matchingJobs.length} (Row ID: ${matchingJobs[0]?.id})`
    );
    expect(matchingJobs.length).toBe(1);
  }, 30000);

  // TEST 5: Two Concurrent Workers with Zero Duplicate Claims
  it("Test 5: Runs two workers simultaneously against the same queue and confirms zero double claims", async () => {
    const batchSize = 10;
    const timestamp = Date.now();
    const jobsData = [];

    // Insert 10 pending jobs in one batch
    for (let i = 0; i < batchSize; i++) {
      jobsData.push({
        type: "INVOICE_REPORT_GENERATION",
        payload: { item: i },
        idempotencyKey: `dual-worker-${timestamp}-${i}`,
        status: JobStatus.pending,
        runAt: new Date(),
        maxAttempts: 3,
      });
    }

    await prisma.job.createMany({ data: jobsData });

    const worker1Claims: string[] = [];
    const worker2Claims: string[] = [];

    // Worker 1 and Worker 2 race to claim jobs concurrently
    const worker1Task = async () => {
      for (let i = 0; i < batchSize; i++) {
        const claimed = await claimNextJob();
        if (claimed) worker1Claims.push(claimed.id);
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    const worker2Task = async () => {
      for (let i = 0; i < batchSize; i++) {
        const claimed = await claimNextJob();
        if (claimed) worker2Claims.push(claimed.id);
        await new Promise((r) => setTimeout(r, 10));
      }
    };

    await Promise.all([worker1Task(), worker2Task()]);

    console.log(`[Test 5 Proof] Worker 1 claimed: ${worker1Claims.length} jobs`);
    console.log(`[Test 5 Proof] Worker 2 claimed: ${worker2Claims.length} jobs`);

    // Check intersection: No job ID can appear in both worker1Claims and worker2Claims
    const overlap = worker1Claims.filter((id) => worker2Claims.includes(id));
    console.log(`[Test 5 Proof] Overlapping claims between workers: ${overlap.length}`);
    expect(overlap.length).toBe(0);
  }, 45000);
});
