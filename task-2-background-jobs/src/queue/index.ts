import { randomUUID } from "node:crypto";
import { Job, JobStatus, Prisma } from "@prisma/client";
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

export interface JobFailureResult {
  job: Job;
  transitionedToDead: boolean;
  delayMs: number;
}

export interface JobCompletionResult {
  job: Job;
  persistedResult: Prisma.JsonValue;
  markedSucceeded: boolean;
}

/**
 * Statuses a worker is allowed to claim. `failed` is claimable because it means
 * "a previous attempt threw and this job is scheduled to retry" - it is not a
 * terminal state. `pending` means "never attempted yet".
 */
export const CLAIMABLE_STATUSES: JobStatus[] = [JobStatus.pending, JobStatus.failed];

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
 * Renders a thrown value as `message + stack`, truncated so a pathological
 * stack cannot bloat the row. Without the stack, a dead job's `lastError` gives
 * an operator the message but no trace of where it came from.
 */
export function formatErrorForStorage(error: unknown, maxChars = config.maxErrorChars): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.stack ? error.stack : `${error.name}: ${error.message}`);
  } else {
    parts.push(String(error));
  }

  const rendered = parts.join("\n");
  if (rendered.length <= maxChars) return rendered;
  return `${rendered.slice(0, maxChars)}\n... [truncated, original length ${rendered.length}]`;
}

function isUniqueConstraintViolation(error: unknown): error is Prisma.PrismaClientKnownRequestError {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Enqueues a job row, enforcing idempotency at the database level.
 *
 * This is deliberately a write-first / read-on-conflict sequence rather than
 * read-then-write. A `findUnique` followed by a `create` lets two concurrent
 * requests for the same key both pass the find, and the loser surfaces a raw
 * P2002 as an opaque 500. Attempting the insert and treating the unique
 * violation as "somebody beat me to it" is race-free: the unique index is the
 * only arbiter, and the winner's row is the one returned to both callers.
 */
export async function enqueueJob(options: EnqueueOptions): Promise<EnqueueResult> {
  try {
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

    return { job: newJob, isDuplicate: false };
  } catch (error) {
    if (!isUniqueConstraintViolation(error)) throw error;

    const existingJob = await prisma.job.findUnique({
      where: { idempotencyKey: options.idempotencyKey },
    });

    // A P2002 is only ever raised once the conflicting row is visible, so this
    // read is guaranteed to find it. Re-throw anything unexpected.
    if (!existingJob) throw error;

    return { job: existingJob, isDuplicate: true };
  }
}

/**
 * Atomically claims the next eligible job using row-level locking.
 * Guarantees that concurrent workers never double-claim the same job row.
 */
export async function claimNextJob(): Promise<Job | null> {
  // Single atomic statement: the row lock and the status transition happen in
  // the same statement, so two workers can never both win the same row.
  const claimedJobs = await prisma.$queryRaw<Array<Job>>`
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
  `;

  if (!claimedJobs || claimedJobs.length === 0) {
    return null;
  }

  return claimedJobs[0]!;
}

/**
 * Refreshes the liveness timestamp for a job that is still executing.
 * Returns false when the row is no longer `processing`, which means the sweeper
 * already handed this job to somebody else and the heartbeat is now pointless.
 *
 * The timestamp is written by the database for the same reason the retry slot
 * is: this column is measured against Postgres `clock_timestamp()` when the
 * sweeper decides a job is stuck, so stamping it from the app process clock
 * would mean a worker host with a drifted clock could have healthy, running
 * jobs declared stuck (and re-executed) or stuck jobs never recovered.
 */
export async function heartbeatJob(jobId: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Job"
    SET "lastHeartbeatAt" = clock_timestamp(),
        "updatedAt" = clock_timestamp()
    WHERE id = ${jobId}::uuid
      AND status = 'processing'::"JobStatus"
    RETURNING id;
  `;

  return rows.length > 0;
}

/**
 * Records job failure and applies exponential backoff with jitter, or transitions to DEAD.
 *
 * `failed` means "will retry"; `dead` means "retries exhausted". The attempt
 * counter is incremented inside the database rather than computed from the
 * in-memory `job` argument, so a concurrent sweeper recovery of the same row
 * cannot be silently overwritten by a stale `job.attempts + 1`.
 */
export async function markJobFailed(job: Job, error: unknown): Promise<JobFailureResult> {
  const lastError = formatErrorForStorage(error);

  return prisma.$transaction(async (tx) => {
    // Read the authoritative attempt count back out of the database.
    const afterAttempt = await tx.job.update({
      where: { id: job.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });

    if (afterAttempt.attempts >= afterAttempt.maxAttempts) {
      const updated = await tx.job.update({
        where: { id: job.id },
        data: {
          status: JobStatus.dead,
          lastError,
          finishedAt: new Date(),
          lastHeartbeatAt: null,
        },
      });
      console.log(
        `[Queue:Dead] Job ${job.id} exhausted retries (${afterAttempt.attempts}/${afterAttempt.maxAttempts}). Moved to dead-letter queue.`
      );
      return { job: updated, transitionedToDead: true, delayMs: 0 };
    }

    const { delayMs, jitterMs } = calculateBackoffDelayMs(afterAttempt.attempts);

    // The retry slot is stamped by the DATABASE clock, not by this process.
    // `claimNextJob` decides what is claimable by comparing `runAt` against
    // Postgres time, so every queue-time column has to come from the same
    // clock: an application host whose clock drifts is a worker fleet that
    // silently retries too early or too late. `clock_timestamp()` rather than
    // `NOW()`, because `NOW()` is pinned to the start of the transaction and
    // this transaction began a round trip ago, which would shorten the delay.
    const rows = await tx.$queryRaw<Job[]>`
      UPDATE "Job"
      SET "status" = 'failed'::"JobStatus",
          "lastError" = ${lastError},
          "runAt" = clock_timestamp() + (${delayMs} || ' milliseconds')::interval,
          "lastHeartbeatAt" = NULL,
          "updatedAt" = clock_timestamp()
      WHERE id = ${job.id}::uuid
      RETURNING *;
    `;
    const updated = rows[0]!;

    console.log(
      `[Queue:Retry] Job ${job.id} failed (attempt ${afterAttempt.attempts}/${afterAttempt.maxAttempts}). Retrying in ${delayMs}ms (base + ${jitterMs}ms jitter) at ${updated.runAt.toISOString()}`
    );

    return { job: updated, transitionedToDead: false, delayMs };
  });
}

/**
 * Marks a job as successfully completed and snapshots its output.
 *
 * The output write and the status transition are one transaction: a crash
 * between them would otherwise leave a `succeeded` job with no output, or an
 * output with a job that re-runs the side effect. The status update is
 * conditional on the job still being `processing` so a worker whose job was
 * already recovered by the sweeper cannot stamp a re-claimed row as succeeded.
 */
export async function completeJob(
  jobId: string,
  result: Prisma.InputJsonValue
): Promise<JobCompletionResult> {
  const resultJson = JSON.stringify(result ?? null);

  return prisma.$transaction(async (tx) => {
    // Atomic insert-or-keep on the unique jobId. Prisma's `upsert` is not used
    // here on purpose: with an empty `update` clause Prisma emits a plain
    // INSERT, and two concurrent completions of the same job then collide on
    // the unique index and one of them dies with P2002. `ON CONFLICT DO
    // NOTHING` cannot fail that way, and the first writer's result is what
    // every caller ends up returning.
    const inserted = await tx.$queryRaw<Array<{ result: Prisma.JsonValue }>>`
      INSERT INTO "JobOutput" ("id", "jobId", "result", "createdAt")
      VALUES (${randomUUID()}::uuid, ${jobId}::uuid, ${resultJson}::jsonb, NOW())
      ON CONFLICT ("jobId") DO NOTHING
      RETURNING "result"
    `;

    let persistedResult: Prisma.JsonValue;
    if (inserted.length > 0) {
      persistedResult = inserted[0]!.result;
    } else {
      const existing = await tx.jobOutput.findUniqueOrThrow({
        where: { jobId },
        select: { result: true },
      });
      persistedResult = existing.result;
    }

    const claimed = await tx.job.updateMany({
      where: { id: jobId, status: JobStatus.processing },
      data: {
        status: JobStatus.succeeded,
        finishedAt: new Date(),
        lastHeartbeatAt: null,
      },
    });

    const job = await tx.job.findUniqueOrThrow({ where: { id: jobId } });

    if (claimed.count === 0) {
      console.warn(
        `[Queue:Complete] Job ${jobId} finished but is in status "${job.status}", not "processing". Its row was recovered by the sweeper while this worker was still running; leaving the status to the worker that owns it now.`
      );
    }

    return {
      job,
      persistedResult,
      markedSucceeded: claimed.count > 0,
    };
  });
}

/**
 * Sweeper: recovers jobs whose owning worker stopped heartbeating.
 *
 * One atomic statement. A `findMany` followed by per-row `update` lets two
 * workers' sweepers both read the same stuck row and both increment `attempts`,
 * burning a retry from every other sweeper in the fleet. `FOR UPDATE SKIP
 * LOCKED` inside the subquery makes selection and recovery a single atomic step.
 *
 * Liveness keys off `lastHeartbeatAt`, falling back to `startedAt` for rows
 * created before the column existed.
 */
export async function sweepStuckJobs(
  timeoutMs = config.stuckJobTimeoutMs
): Promise<number> {
  const lastError = `Worker heartbeat stopped for more than ${timeoutMs}ms. Job recovered by sweeper.`;

  // The staleness cutoff is computed by the database as well, for the same
  // reason the retry slot is: this query measures elapsed time against
  // timestamps that the database itself wrote, so the cutoff has to come from
  // that same clock.
  const recovered = await prisma.$queryRaw<Array<Job>>`
    UPDATE "Job" AS j
    SET status = CASE
                   WHEN j."attempts" + 1 >= j."maxAttempts" THEN 'dead'::"JobStatus"
                   ELSE 'failed'::"JobStatus"
                 END,
        "attempts" = j."attempts" + 1,
        "lastError" = ${lastError},
        "runAt" = clock_timestamp(),
        "startedAt" = NULL,
        "lastHeartbeatAt" = NULL,
        "finishedAt" = CASE
                          WHEN j."attempts" + 1 >= j."maxAttempts" THEN clock_timestamp()
                          ELSE NULL
                        END,
        "updatedAt" = clock_timestamp()
    WHERE j.id IN (
      SELECT s.id
      FROM "Job" AS s
      WHERE s.status = 'processing'::"JobStatus"
        AND (
              (s."lastHeartbeatAt" IS NOT NULL
                AND s."lastHeartbeatAt" <= clock_timestamp() - (${timeoutMs} || ' milliseconds')::interval)
           OR (s."lastHeartbeatAt" IS NULL
               AND s."startedAt" IS NOT NULL
               AND s."startedAt" <= clock_timestamp() - (${timeoutMs} || ' milliseconds')::interval)
            )
      ORDER BY s."lastHeartbeatAt" ASC NULLS FIRST, s."startedAt" ASC NULLS FIRST
      LIMIT ${config.sweeperBatchSize}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING j.*;
  `;

  return recovered?.length ?? 0;
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
      lastHeartbeatAt: null,
    },
  });
}
