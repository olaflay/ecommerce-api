-- Task 2 baseline: job queue + idempotent job output.
--
-- This migration reproduces EXACTLY the schema that the hand-rolled
-- `src/db/migrate.ts` used to create, so that `prisma migrate deploy` adopts an
-- already-provisioned database without rewriting it. Every DDL statement is
-- therefore guarded with IF NOT EXISTS / duplicate_object.
--
-- NOTE: `lastHeartbeatAt` is deliberately NOT in this migration - it arrives in
-- 20260928130000_add_job_heartbeat. That keeps this file a faithful record of the
-- pre-existing tables and lets the ALTER run against tables created by the old
-- hand-rolled migrator as well as against a brand-new database.

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "JobStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'dead');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Job" (
    "id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastError" TEXT,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "JobOutput" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Job_idempotencyKey_key" ON "Job"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "JobOutput_jobId_key" ON "JobOutput"("jobId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Job_status_startedAt_idx" ON "Job"("status", "startedAt");

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "JobOutput" ADD CONSTRAINT "JobOutput_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
