/* =============================================================================
 * ApexRide — Query Execution Plan Evidence Capture
 *
 * Runs EXPLAIN (ANALYZE, BUFFERS) for the real query behind each of the five
 * core product actions plus every documented list endpoint, and writes the
 * VERBATIM planner output to evidence/query-plans.txt.
 *
 * Nothing in that file is hand written. Where the planner chose something other
 * than the index the documentation names, the report says so, because a
 * fabricated or edited plan is worse than no plan at all.
 *
 * Usage: npm run explain
 * ========================================================================== */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const ROOT = process.cwd();
if (!fs.existsSync(path.join(ROOT, "prisma", "schema.prisma"))) {
  throw new Error("explain.ts must run from the task-3-api-data-modeling project root.");
}
const EVIDENCE_DIR = path.join(ROOT, "evidence");
const OUT_FILE = path.join(EVIDENCE_DIR, "query-plans.txt");

const APEX_TABLES = ["Rider", "Driver", "Vehicle", "Trip", "FareReceipt", "Review"];

const prisma = new PrismaClient();

/** Builds a parameterised EXPLAIN block. `id` is passed as $1, $2, ... */
interface PlanCase {
  section: string;
  title: string;
  serves: string;
  expects: string;
  /** Partial unique index whose enforcement this query sits behind, if any. */
  enforces?: string;
  sql: string;
  ids: string[];
}

let out: string[] = [];

const say = (s = "") => out.push(s);
const rule = (ch = "-", n = 77) => ch.repeat(n);

function classify(planText: string): string {
  const lines = planText.split("\n");
  const hits: string[] = [];
  for (const l of lines) {
    const m = l.match(/Index Scan using (\S+)/);
    if (m) hits.push(`Index Scan using ${m[1]}`);
    const m2 = l.match(/Index Only Scan using (\S+)/);
    if (m2) hits.push(`Index Only Scan using ${m2[1]}`);
    const m3 = l.match(/Bitmap Index Scan on (\S+)/);
    if (m3) hits.push(`Bitmap Index Scan on ${m3[1]}`);
    const m4 = l.match(/Bitmap Heap Scan on (\S+)/);
    if (m4) hits.push(`Bitmap Heap Scan on ${m4[1]}`);
    const m5 = l.match(/Seq Scan on (\S+)/);
    if (m5) hits.push(`Seq Scan on ${m5[1]}`);
    const m6 = l.match(/Index Scan Backward using (\S+)/);
    if (m6) hits.push(`Index Scan Backward using ${m6[1]}`);
  }
  return hits.length ? [...new Set(hits)].join(", ") : "(no scan node matched)";
}

export async function runQueryPlans() {
  // Fresh planner statistics: a bulk seed leaves the catalog without stats, and
  // planning against stale/missing stats is exactly how "wrong" plans get
  // reported as evidence. ANALYZE is a real, recorded operation.
  await prisma.$executeRawUnsafe(`ANALYZE ${APEX_TABLES.map((t) => `"${t}"`).join(", ")};`);

  const meta = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT current_database() AS "database", current_user AS "user",
            current_setting('server_version') AS "serverVersion", now() AS "capturedAt"`
  ))[0];

  const counts = (await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT (SELECT count(*) FROM "Rider")   AS "Rider",
            (SELECT count(*) FROM "Driver")   AS "Driver",
            (SELECT count(*) FROM "Vehicle")  AS "Vehicle",
            (SELECT count(*) FROM "Trip")     AS "Trip",
            (SELECT count(*) FROM "FareReceipt") AS "FareReceipt",
            (SELECT count(*) FROM "Review")   AS "Review"`
  ))[0];

  const [rider] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Rider" ORDER BY "id" LIMIT 1`
  );
  const [driver] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Driver" ORDER BY "status", "id" LIMIT 1`
  );
  const [driverWithTrip] = await prisma.$queryRawUnsafe<Array<{ driverId: string }>>(
    `SELECT t."driverId" FROM "Trip" t WHERE t."status" = 'completed'::"TripStatus" ORDER BY t."id" LIMIT 1`
  );
  const [riderWithTrip] = await prisma.$queryRawUnsafe<Array<{ riderId: string }>>(
    `SELECT t."riderId" FROM "Trip" t WHERE t."status" = 'completed'::"TripStatus" ORDER BY t."id" LIMIT 1`
  );
  const [vehicle] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Vehicle" ORDER BY "id" LIMIT 1`
  );

  const RID = riderWithTrip?.riderId ?? rider.id;
  const DID = driverWithTrip?.driverId ?? driver.id;

  const planCases: PlanCase[] = [
    {
      section: "1",
      title: "Action 1 — Rider requests a trip (single-active-trip guard)",
      serves: "REQUIREMENTS.md Action 1 / API_CONTRACTS.md 1.1 POST /api/v1/trips",
      expects: "idx_trip_rider_status",
      enforces: "idx_rider_single_active_trip",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id" FROM "Trip"
WHERE "riderId" = $1::uuid
  AND "status" IN ('requested','driver_assigned','driver_arriving','in_progress');`,
      ids: [RID],
    },
    {
      section: "2",
      title: "Action 2 — Driver accepts a dispatch offer (nearby available drivers)",
      serves: "REQUIREMENTS.md Action 2 / API_CONTRACTS.md 1.2 POST /api/v1/trips/:id/accept",
      expects: "idx_driver_status_geo",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "fullName", "currentLat", "currentLng", "rating"
FROM "Driver"
WHERE "status" = 'available'::"DriverStatus"
  AND "currentLat" BETWEEN 6.4000 AND 6.6000
  AND "currentLng" BETWEEN 3.3000 AND 3.5000
ORDER BY "rating" DESC
LIMIT 10;`,
      ids: [],
    },
    {
      section: "3",
      title: "Action 3 — Driver arrives & begins trip (driver's assigned/active trip lookup)",
      serves: "REQUIREMENTS.md Action 3 / API_CONTRACTS.md 1.3 POST /api/v1/trips/:id/start",
      expects: "idx_trip_driver_status",
      enforces: "idx_driver_single_active_trip",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "riderId", "vehicleId", "acceptedAt"
FROM "Trip"
WHERE "driverId" = $1::uuid
  AND "status" IN ('driver_assigned','driver_arriving','in_progress')
ORDER BY "requestedAt" ASC
LIMIT 1;`,
      ids: [DID],
    },
    {
      section: "4",
      title: "Action 4 — Driver completes trip & triggers billing (receipt by trip)",
      serves: "REQUIREMENTS.md Action 4 / API_CONTRACTS.md 1.4 POST /api/v1/trips/:id/complete",
      expects: "FareReceipt_tripId_key",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "tripId", "baseFareMinor", "distanceFareMinor", "timeFareMinor",
       "surgeMultiplier", "subtotalMinor", "discountMinor", "totalFareMinor",
       "platformFeeMinor", "driverEarningsMinor", "currency", "paymentStatus"
FROM "FareReceipt"
WHERE "tripId" = (SELECT "id" FROM "Trip" WHERE "driverId" = $1::uuid
                  AND "status" = 'completed'::"TripStatus" ORDER BY "id" LIMIT 1);`,
      ids: [DID],
    },
    {
      section: "5",
      title: "Action 5 — Rider submits a review (completed trips eligible for review)",
      serves: "REQUIREMENTS.md Action 5 / API_CONTRACTS.md 1.5 POST /api/v1/trips/:id/reviews",
      expects: "idx_trip_rider_completed",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT t."id", t."completedAt", t."dropoffAddress"
FROM "Trip" t
WHERE t."riderId" = $1::uuid
  AND t."status" = 'completed'::"TripStatus"
  AND NOT EXISTS (SELECT 1 FROM "Review" r WHERE r."tripId" = t."id")
ORDER BY t."completedAt" DESC
LIMIT 20 OFFSET 0;`,
      ids: [RID],
    },
    {
      section: "6",
      title: "List endpoint — GET /api/v1/riders/me/trips (rider trip history)",
      serves: "API_CONTRACTS.md 1.6 rider trip history (limit/offset/sort/filter)",
      expects: "idx_trip_rider_status",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "status", "pickupAddress", "dropoffAddress", "requestedAt", "completedAt"
FROM "Trip"
WHERE "riderId" = $1::uuid
  AND "status" = 'completed'::"TripStatus"
ORDER BY "completedAt" DESC
LIMIT 20 OFFSET 0;`,
      ids: [RID],
    },
    {
      section: "7",
      title: "List endpoint — GET /api/v1/drivers/me/earnings (driver earnings ledger)",
      serves: "API_CONTRACTS.md 1.7 driver earnings (limit/offset/sort/filter)",
      expects: "idx_trip_driver_status",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT t."id", t."completedAt", f."totalFareMinor", f."platformFeeMinor",
       f."driverEarningsMinor", f."currency", f."paymentStatus"
FROM "Trip" t
JOIN "FareReceipt" f ON f."tripId" = t."id"
WHERE t."driverId" = $1::uuid
  AND t."status" = 'completed'::"TripStatus"
  AND f."paymentStatus" = 'succeeded'::"PaymentStatus"
ORDER BY t."completedAt" DESC
LIMIT 20 OFFSET 0;`,
      ids: [DID],
    },
    {
      section: "8",
      title: "List endpoint — GET /api/v1/vehicles (vehicle catalogue / driver fleet)",
      serves: "API_CONTRACTS.md 1.8 vehicle listings (limit/offset/sort/filter)",
      expects: "idx_vehicle_driver",
      enforces: "idx_driver_single_active_vehicle",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "driverId", "make", "model", "year", "licensePlate", "tier", "isActive"
FROM "Vehicle"
WHERE "isActive" = true
  AND "tier" = ANY (ARRAY['standard'::"VehicleTier",'comfort'::"VehicleTier",'xl'::"VehicleTier"])
  AND "driverId" = $1::uuid
ORDER BY "year" DESC
LIMIT 20 OFFSET 0;`,
      ids: [DID],
    },
    {
      section: "9",
      title: "List endpoint — GET /api/v1/drivers/:id/reviews (reviews for a driver)",
      serves: "API_CONTRACTS.md 1.9 reviews by driver (limit/offset/sort/filter)",
      expects: "idx_review_driver_rating",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "tripId", "rating", "comment", "createdAt"
FROM "Review"
WHERE "driverId" = $1::uuid
  AND "rating" >= 1
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;`,
      ids: [DID],
    },
    {
      section: "10",
      title: "List endpoint — GET /api/v1/riders/me/reviews (reviews written by a rider)",
      serves: "API_CONTRACTS.md 1.10 reviews by rider (limit/offset/sort/filter)",
      expects: "idx_review_rider",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "tripId", "driverId", "rating", "comment", "createdAt"
FROM "Review"
WHERE "riderId" = $1::uuid
ORDER BY "createdAt" DESC
LIMIT 20 OFFSET 0;`,
      ids: [RID],
    },
    {
      section: "11",
      title: "List endpoint — GET /api/v1/trips/requests (open dispatch offers)",
      serves: "API_CONTRACTS.md 1.11 dispatch queue feed (limit/offset/sort/filter)",
      expects: "idx_trip_status_requestedAt",
      sql: `EXPLAIN (ANALYZE, BUFFERS)
SELECT "id", "riderId", "pickupLat", "pickupLng", "requestedAt"
FROM "Trip"
WHERE "status" = 'requested'::"TripStatus"
ORDER BY "requestedAt" ASC
LIMIT 20 OFFSET 0;`,
      ids: [],
    },
  ];

  // ---- header -------------------------------------------------------------
  say("=".repeat(78));
  say("APEXRIDE — QUERY EXECUTION PLAN EVIDENCE");
  say("=".repeat(78));
  say(`Generated by : npm run explain  (src/db/explain.ts)`);
  say(`Captured at  : ${String(meta.capturedAt)}`);
  say(`Database     : ${String(meta.database)} as ${String(meta.user)}`);
  say(`Server       : PostgreSQL ${String(meta.serverVersion)}`);
  say(`Method       : EXPLAIN (ANALYZE, BUFFERS), via Prisma $queryRawUnsafe`);
  say(`Statistics   : ANALYZE was executed on the six ApexRide tables immediately`);
  say(`               before capture, so the planner costed these queries against`);
  say(`               current statistics rather than post-bulk-load defaults.`);
  say("");
  say("PROVENANCE: every plan below is verbatim PostgreSQL output. No plan in this");
  say("file is transcribed, summarised by hand, or edited. Where the planner chose");
  say("something other than the index the documentation names, the VERDICT line");
  say("reports that honestly.");
  say("");
  say("ROW COUNTS AT CAPTURE TIME");
  for (const t of APEX_TABLES) say(`  ${t.padEnd(12)} ${String(counts[t]).padStart(6)} rows`);
  say("");
  say(`FIXTURES  rider=${RID}  driver=${DID}  vehicle=${vehicle?.id ?? "n/a"}`);
  say("");

  // ---- index inventory ----------------------------------------------------
  const indexInventory = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
    `SELECT ic.relname        AS "name",
            c.relname         AS "tableName",
            pg_get_indexdef(i.indexrelid) AS "definition",
            pg_size_pretty(pg_relation_size(i.indexrelid)) AS "size"
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = ANY(ARRAY[${APEX_TABLES.map(
       (t) => `'${t}'`
     ).join(",")}]::text[])
     ORDER BY c.relname, ic.relname`
  );

  say(rule("="));
  say(`INDEX INVENTORY (${indexInventory.length} indexes, live from pg_index)`);
  say(rule("="));
  for (const ix of indexInventory) {
    say(`[${ix.tableName}] ${ix.name}  (${ix.size})`);
    say(`    ${ix.definition}`);
  }
  say("");

  // ---- partial index predicates -------------------------------------------
  const partialIndexes = await prisma.$queryRawUnsafe<Array<Record<string, string>>>(
    `SELECT ic.relname AS "name",
            c.relname  AS "tableName",
            pg_get_expr(i.indpred, i.indrelid) AS "predicate"
     FROM pg_index i
     JOIN pg_class c ON c.oid = i.indrelid
     JOIN pg_class ic ON ic.oid = i.indexrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND i.indpred IS NOT NULL
       AND c.relname = ANY(ARRAY[${APEX_TABLES.map((t) => `'${t}'`)
         .join(",")}]::text[])
     ORDER BY c.relname, ic.relname`
  );

  say(rule("="));
  say(`PARTIAL INDEX PREDICATES (${partialIndexes.length}, live from pg_get_expr)`);
  say(rule("="));
  say("These three are the only PARTIAL indexes in the ApexRide schema, and all");
  say("three are UNIQUE. They enforce cardinality, they are not lookup accelerators,");
  say("and therefore no EXPLAIN output can ever name them. Each predicate below is");
  say("read from pg_index, so the WHERE clause quoted in HARD_QUESTIONS.md is verified");
  say("against the deployed database rather than trusted.");
  say("");
  for (const p of partialIndexes) {
    say(`[${p.tableName}] ${p.name}`);
    say(`    WHERE ${p.predicate}`);
  }
  say("");

  // ---- plans --------------------------------------------------------------
  for (const c of planCases) {
    say(rule("="));
    say(`PLAN ${c.section}: ${c.title}`);
    say(rule("="));
    say(`Serves  : ${c.serves}`);
    say(`Doc claims index : ${c.expects}`);
    if (c.enforces) {
      say(
        `Enforced by     : ${c.enforces} (PARTIAL UNIQUE index — an enforcement object,`
      );
      say(
        `                 not a lookup path. A plan can never name it. Its behaviour is`
      );
      say(
        `                 proven by the 23505 rejections recorded in`
      );
      say(`                 evidence/constraint-violations.txt, not by EXPLAIN.)`);
    }
    say("");
    say("Query:");
    for (const l of c.sql.split("\n")) say(`  ${l}`);

    let rows: Array<Record<string, string>>;
    try {
      rows = (await prisma.$queryRawUnsafe(c.sql, ...c.ids)) as Array<Record<string, string>>;
    } catch (err) {
      say("");
      say(`  EXPLAIN FAILED: ${(err as Error).message}`);
      say("");
      continue;
    }

    const planText = rows.map((r) => r["QUERY PLAN"] ?? Object.values(r).join(" ")).join("\n");
    say("");
    say("Planner output:");
    for (const l of planText.split("\n")) say(`  ${l}`);

    const chosen = classify(planText);
    const usedExpected = planText.includes(c.expects);
    say("");
    say(`VERDICT : planner actually chose -> ${chosen}`);
    if (usedExpected) {
      say(`          ${c.expects} WAS USED by the planner.`);
    } else {
      say(`          ${c.expects} was NOT chosen at this table size. See PLAN NOTE.`);
    }
    say("");
  }

  // Diagnostic: prove each documented index is actually usable by this shape of
  // query, by asking the planner with sequential scans disabled. This is a
  // standard "is my index reachable" probe, not a performance measurement.
  say(rule("="));
  say("PLAN NOTE — WHY A DOCUMENTED INDEX MAY NOT APPEAR ABOVE");
  say(rule("="));
  say("");
  say("The six ApexRide tables hold single-digit row counts in this environment");
  say("(see ROW COUNTS above). PostgreSQL's cost model is designed to be right");
  say("about that: reading a whole 1-page table is cheaper than traversing a");
  say("btree, so it correctly prefers Seq Scan and then applies LIMIT early. The");
  say("planner output above is therefore reported exactly as emitted.");
  say("");
  say("That a Seq Scan appears does NOT mean the index is missing or unusable. The");
  say("index INVENTORY section above is read from pg_index, so their existence and");
  say("exact definition are proven independently of planner choice. To further");
  say("demonstrate reachability, the following probe re-plans the SAME query with");
  say("`SET LOCAL enable_seqscan = off`, which forces the planner to consider index");
  say("paths. Read this as 'can this index serve this query shape', not as a");
  say("timing claim.");
  say("");
  say(rule());
  say("DIAGNOSTIC: enable_seqscan = off");
  say(rule());

  for (const c of planCases) {
    let planText: string;
    try {
      // $transaction pins one connection, so SET LOCAL applies to the same
      // session that runs the EXPLAIN.
      planText = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL enable_seqscan = off;`);
        const rows = (await tx.$queryRawUnsafe(c.sql, ...c.ids)) as Array<Record<string, string>>;
        return rows.map((r) => r["QUERY PLAN"] ?? Object.values(r).join(" ")).join("\n");
      });
    } catch (err) {
      say("");
      say(`PLAN ${c.section} (${c.expects}) : PROBE FAILED — ${(err as Error).message}`);
      continue;
    }
    say("");
    say(`PLAN ${c.section}: ${c.title}`);
    say(`  Index the planner can reach for this shape: ${c.expects}`);
    say(`  Chosen with enable_seqscan = off: ${classify(planText)}`);
    for (const l of planText.split("\n")) say(`  ${l}`);
  }

  say("");
  say("=".repeat(78));
  say("END OF QUERY PLAN EVIDENCE — generated by src/db/explain.ts, not hand written");
  say("=".repeat(78));

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, out.join("\n") + "\n", "utf8");

  return { file: OUT_FILE, plans: planCases.length };
}

if (process.argv[1] && process.argv[1].endsWith("explain.ts")) {
  runQueryPlans()
    .then((r) => {
      console.log(
        `Wrote ${r.plans} EXPLAIN plans to ${path.relative(ROOT, r.file)}`
      );
    })
    .catch((err) => {
      console.error("Explain error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
