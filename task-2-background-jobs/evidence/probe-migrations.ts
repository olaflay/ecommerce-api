/**
 * Reports the applied migration history and the current state of the shared
 * public schema, so a reviewer can see that this task's migrations applied
 * without disturbing the other tasks that use the same database.
 *
 * Run: npx tsx evidence/probe-migrations.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ migration_name: string; finished_at: Date | null; logs: string | null }>
  >(
    'SELECT migration_name, finished_at, logs FROM "_prisma_migrations" ORDER BY started_at'
  );
  console.log("[migrations] applied, in order:");
  for (const row of rows) {
    console.log(`  ${row.finished_at ? "ok  " : "FAIL"} ${row.migration_name}`);
  }

  const jobCount = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    'SELECT COUNT(*) AS n FROM "Job"'
  );
  const outCount = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
    'SELECT COUNT(*) AS n FROM "JobOutput"'
  );
  console.log(
    `[rows] public.Job=${jobCount[0]?.n} public.JobOutput=${outCount[0]?.n}`
  );

  // `SHOW server_version` returns the column as `server_version`, so selecting
  // it as `version` yields undefined. Read it as its real column name.
  const version = await prisma.$queryRawUnsafe<Array<{ server_version: string }>>(
    "SELECT current_setting('server_version') AS server_version"
  );
  console.log(`[server] postgres=${version[0]?.server_version}`);

  const schema = await prisma.$queryRawUnsafe<Array<{ search_path: string }>>(
    "SHOW search_path"
  );
  console.log(`[server] search_path=${schema[0]?.search_path}`);

  // Which schemas exist: `public` is shared, `task2_test` belongs to this
  // task's test suite (see scripts/test-db.mjs).
  const schemas = await prisma.$queryRawUnsafe<Array<{ nspname: string }>>(
    "SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY nspname"
  );
  console.log(`[server] schemas=${schemas.map((s) => s.nspname).join(", ")}`);
}

main()
  .catch((err) => {
    console.error(`[migrations] FAILED: ${err?.message ?? String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
