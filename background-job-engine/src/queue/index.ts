import { Job, JobStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { config } from "../config/index.js";

export interface EnqueueOptions {
  type: string;
  payload: Record<string, any>;
  idempotencyKey: string;
  maxAttempts?: number;
  runAt?: Date;
}

export interface EnqueueResult {
  job: Job;
  isDuplicate: boolean;
}

/**
 * Calculates exponential backoff with random jitter.
 * Formula: baseDelay * 2^(attempts - 1) + uniform_random(0, maxJitter)
 */
export function calculateBackoffDelayMs(
  attempt: number,
  baseBackoffMs = config.baseBackoffMs,
  maxJitterMs = config.maxJitterMs
): { delayMs: number; jitterMs: number } {
  const exponentialMultiplier = Math.pow(2, Math.max(0, attempt - 1));
  const baseDelay = baseBackoffMs * exponentialMultiplier;
  const jitterMs = Math.floor(Math.random() * maxJitterMs);
  return {
    delayMs: baseDelay + jitterMs,
    jitterMs,
  };
}

/**
 * Enqueues a job row with pending status, enforcing idempotency at the database level.
 */
export async function enqueueJob(options: EnqueueOptions): Promise<EnqueueResult> {
  const existingJob = await prisma.job.findUnique({
    where: { idempotencyKey: options.idempotencyKey },
  });

  if (existingJob) {
    return {
      job: existingJob,
      isDuplicate: true,
    };
  }

  const newJob = await prisma.job.create({
    data: {
      type: options.type,
      payload: options.payload,
      idempotencyKey: options.idempotencyKey,
      maxAttempts: options.maxAttempts ?? config.maxAttempts,
      status: JobStatus.pending,
      runAt: options.runAt ?? new Date(),
    },
  });

  return {
    job: newJob,
    isDuplicate: false,
  };
}

/**
 * Atomically claims the next eligible pending job using row-level locking.
 * Guarantees that concurrent workers never double-claim the same job row.
 */
export async function claimNextJob(): Promise<Job | null> {
  // Using an atomic UPDATE with a subquery and FOR UPDATE SKIP LOCKED
  const claimedJobs = await prisma.$queryRaw<Array<Job>>`
    UPDATE "Job"
    SET status = 'processing'::"JobStatus",
        "startedAt" = NOW(),
        "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'pending'::"JobStatus"
        AND "runAt" <= NOW()
      ORDER BY "runAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
  `;

  if (!claimedJobs || claimedJobs.length === 0) {
    return null;
  }

  return claimedJobs[0]!;
}

/**
 * Marks a job as successfully completed.
 */
export async function markJobSucceeded(jobId: string): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.succeeded,
      finishedAt: new Date(),
    },
  });
}

/**
 * Records job failure and applies exponential backoff with jitter, or transitions to DEAD.
 */
export async function markJobFailed(
  job: Job,
  errorMessage: string
): Promise<{ job: Job; transitionedToDead: boolean; delayMs: number }> {
  const nextAttempt = job.attempts + 1;
  const isDead = nextAttempt >= job.maxAttempts;

  if (isDead) {
    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        attempts: nextAttempt,
        status: JobStatus.dead,
        lastError: errorMessage,
        finishedAt: new Date(),
      },
    });
    return { job: updated, transitionedToDead: true, delayMs: 0 };
  } else {
    const { delayMs, jitterMs } = calculateBackoffDelayMs(nextAttempt);
    const nextRunAt = new Date(Date.now() + delayMs);

    const updated = await prisma.job.update({
      where: { id: job.id },
      data: {
        attempts: nextAttempt,
        status: JobStatus.pending,
        lastError: errorMessage,
        runAt: nextRunAt,
      },
    });

    console.log(
      `[Queue:Retry] Job ${job.id} failed (attempt ${nextAttempt}/${job.maxAttempts}). Retrying in ${delayMs}ms (base + ${jitterMs}ms jitter) at ${nextRunAt.toISOString()}`
    );

    return { job: updated, transitionedToDead: false, delayMs };
  }
}

/**
 * Sweeper: resets stuck jobs that have been in "processing" longer than the timeout.
 */
export async function sweepStuckJobs(
  timeoutMs = config.stuckJobTimeoutMs
): Promise<number> {
  const cutoff = new Date(Date.now() - timeoutMs);

  const stuckJobs = await prisma.job.findMany({
    where: {
      status: JobStatus.processing,
      startedAt: { lte: cutoff },
    },
    select: { id: true, attempts: true, maxAttempts: true },
  });

  let recoveredCount = 0;
  for (const job of stuckJobs) {
    const nextAttempt = job.attempts + 1;
    const isDead = nextAttempt >= job.maxAttempts;

    await prisma.job.update({
      where: { id: job.id },
      data: {
        status: isDead ? JobStatus.dead : JobStatus.pending,
        attempts: nextAttempt,
        lastError: `Worker heartbeat timeout exceeded (${timeoutMs}ms). Job recovered by sweeper.`,
        runAt: new Date(),
      },
    });
    recoveredCount++;
  }

  return recoveredCount;
}

/**
 * Manually retries a dead-letter job.
 */
export async function retryDeadJob(jobId: string): Promise<Job> {
  return prisma.job.update({
    where: { id: jobId },
    data: {
      status: JobStatus.pending,
      attempts: 0,
      runAt: new Date(),
      lastError: null,
      finishedAt: null,
      startedAt: null,
    },
  });
}
