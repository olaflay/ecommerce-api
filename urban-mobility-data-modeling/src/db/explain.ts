import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

export async function runQueryPlans() {
  console.log("===============================================================================");
  console.log("APEXRIDE QUERY EXECUTION PLAN VERIFICATION (EXPLAIN ANALYZE BUFFERS)");
  console.log("===============================================================================\n");

  // Query Plan 1: Heavy Geospatial Available Driver Dispatch Match
  console.log("--- Query Plan 1: Geospatial Available Driver Dispatch Matching ---");
  const plan1 = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT "id", "fullName", "currentLat", "currentLng", "rating"
    FROM "Driver"
    WHERE "status" = 'available'::"DriverStatus"
      AND "currentLat" BETWEEN 6.4000 AND 6.6000
      AND "currentLng" BETWEEN 3.3000 AND 3.5000
    ORDER BY "rating" DESC
    LIMIT 10;
  `);

  plan1.forEach((row) => console.log(row["QUERY PLAN"]));
  console.log("\n-------------------------------------------------------------------------------\n");

  // Query Plan 2: Heavy Trip History with Receipts and Reviews (Composite Index)
  console.log("--- Query Plan 2: Rider Historical Trips Ledger & Receipt Retrieval ---");
  const rider = await prisma.$queryRawUnsafe<Array<{ id: string }>>(`SELECT "id" FROM "Rider" LIMIT 1;`);
  const riderId = rider[0]?.id || "00000000-0000-0000-0000-000000000000";

  const plan2 = await prisma.$queryRawUnsafe<Array<{ "QUERY PLAN": string }>>(`
    EXPLAIN (ANALYZE, BUFFERS)
    SELECT
      t."id" AS "tripId",
      t."status",
      t."pickupAddress",
      t."dropoffAddress",
      t."completedAt",
      f."totalFareMinor",
      f."currency",
      f."paymentStatus",
      r."rating" AS "riderRating"
    FROM "Trip" t
    LEFT JOIN "FareReceipt" f ON f."tripId" = t."id"
    LEFT JOIN "Review" r ON r."tripId" = t."id"
    WHERE t."riderId" = '${riderId}'::uuid
      AND t."status" = 'completed'::"TripStatus"
    ORDER BY t."completedAt" DESC
    LIMIT 10;
  `);

  plan2.forEach((row) => console.log(row["QUERY PLAN"]));
  console.log("\n===============================================================================");
}

if (process.argv[1] && process.argv[1].endsWith("explain.ts")) {
  runQueryPlans()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
}
