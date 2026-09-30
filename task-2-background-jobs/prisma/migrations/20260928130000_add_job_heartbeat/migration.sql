-- Worker liveness signal.
--
-- The stuck-job sweeper previously keyed off `startedAt` alone, which meant any
-- legitimately long-running job (one that outlives `STUCK_JOB_TIMEOUT_MS`) was
-- falsely declared stuck and re-executed while the original was still running.
-- Workers now refresh `lastHeartbeatAt` while a job executes and the sweeper
-- keys off that, falling back to `startedAt` for rows that predate this column.
--
-- IF NOT EXISTS / IF NOT EXISTS on the index keeps this safe on a database
-- where the column already exists.

-- AlterTable
ALTER TABLE "Job" ADD COLUMN IF NOT EXISTS "lastHeartbeatAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Job_status_lastHeartbeatAt_idx" ON "Job"("status", "lastHeartbeatAt");
