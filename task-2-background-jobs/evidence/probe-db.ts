import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const started = Date.now();
  const rows = await prisma.$queryRawUnsafe<Array<{ ok: number; now: Date }>>(
    "SELECT 1 AS ok, NOW() AS now"
  );
  console.log(
    `[probe] connected in ${Date.now() - started}ms server_now=${rows[0]?.now?.toISOString()}`
  );

  const tables = await prisma.$queryRawUnsafe<Array<{ tablename: string }>>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
  );
  console.log(`[probe] public tables: ${tables.map((t) => t.tablename).join(", ")}`);

  // Filtered by schema: without it, information_schema lists the Job table in
  // every schema (public, task2_test, ...) and every column appears twice.
  const jobCols = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
    "SELECT column_name FROM information_schema.columns " +
      "WHERE table_schema = 'public' AND table_name = 'Job' ORDER BY ordinal_position"
  );
  console.log(
    `[probe] public.Job columns: ${
      jobCols.length > 0
        ? jobCols.map((c) => c.column_name).join(", ")
        : "<table Job does not exist>"
    }`
  );

  const jobRows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
    `SELECT count(*)::bigint AS count FROM "Job"`
  );
  console.log(`[probe] public.Job row count: ${jobRows[0]?.count ?? 0}`);

  const indexRows = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    "SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'Job' ORDER BY indexname"
  );
  console.log(
    `[probe] public.Job indexes: ${indexRows.map((i) => i.indexname).join(", ")}`
  );
}

main()
  .catch((err) => {
    console.error(`[probe] FAILED: ${err?.message ?? String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
