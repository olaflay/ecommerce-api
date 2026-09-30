/**
 * Measures the offset between this machine's clock and the database clock.
 *
 * Why this matters: the queue stamps retry slots (`runAt`) and liveness
 * (`lastHeartbeatAt`) and decides staleness by comparing those columns against
 * Postgres `clock_timestamp()`. Those writes are deliberately done in SQL so
 * that one clock governs all of them. This probe is the evidence that the
 * decision was necessary on this machine: the app host runs several seconds
 * BEHIND the database, so any timestamp written from `Date.now()` and compared
 * against the database clock is already stale the moment it is written.
 *
 * Run: npx tsx evidence/probe-clock-skew.ts
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Beyond this, a mixed-clock comparison can misfire against a short timeout. */
const TOLERANCE_MS = 1000;

async function main() {
  const samples: number[] = [];

  for (let i = 0; i < 5; i += 1) {
    const beforeLocal = new Date();
    const rows = await prisma.$queryRawUnsafe<Array<{ now: Date }>>(
      "SELECT clock_timestamp() AS now"
    );
    const afterLocal = new Date();
    const dbNow = rows[0]!.now;

    // Compare against the midpoint of the round trip so the network delay does
    // not show up as clock skew.
    const localMidpoint = new Date(
      (beforeLocal.getTime() + afterLocal.getTime()) / 2
    );
    samples.push(dbNow.getTime() - localMidpoint.getTime());

    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }

  const sorted = [...samples].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)]!;
  const dbNow = await prisma.$queryRawUnsafe<Array<{ now: Date }>>(
    "SELECT clock_timestamp() AS now"
  );
  const localNow = new Date();

  console.log(`[clock] local  now = ${localNow.toISOString()}`);
  console.log(`[clock] db     now = ${dbNow[0]!.now.toISOString()}`);
  console.log(`[clock] samples (db - local, ms): [${samples.join(", ")}]`);
  console.log(`[clock] median offset (db - local) = ${median}ms`);
  console.log(
    `[clock] verdict: ${
      Math.abs(median) > TOLERANCE_MS
        ? `SKEWED by more than ${TOLERANCE_MS}ms - runAt/lastHeartbeatAt must be written by the database, not by Date.now()`
        : `within ${TOLERANCE_MS}ms tolerance`
    }`
  );
}

main()
  .catch((err) => {
    console.error(`[clock] FAILED: ${err?.message ?? String(err)}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
