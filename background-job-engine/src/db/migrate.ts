import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

async function migrate() {
  console.log("Creating Job and JobOutput tables if not exist...");

  await prisma.$executeRawUnsafe(`
    DO $$ BEGIN
      CREATE TYPE "JobStatus" AS ENUM ('pending', 'processing', 'succeeded', 'failed', 'dead');
    EXCEPTION
      WHEN duplicate_object THEN null;
    END $$;
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "Job" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "type" VARCHAR(100) NOT NULL,
      "payload" JSONB NOT NULL,
      "status" "JobStatus" NOT NULL DEFAULT 'pending',
      "attempts" INTEGER NOT NULL DEFAULT 0,
      "maxAttempts" INTEGER NOT NULL DEFAULT 3,
      "lastError" TEXT,
      "runAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "startedAt" TIMESTAMPTZ,
      "finishedAt" TIMESTAMPTZ,
      "idempotencyKey" VARCHAR(255) UNIQUE NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_job_status_runAt" ON "Job"("status", "runAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_job_status_startedAt" ON "Job"("status", "startedAt");
  `);

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "JobOutput" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "jobId" UUID UNIQUE NOT NULL REFERENCES "Job"("id") ON DELETE CASCADE,
      "result" JSONB NOT NULL,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  console.log("Job and JobOutput tables successfully provisioned!");
}

migrate()
  .catch((err) => {
    console.error("Migration error:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
