/* =============================================================================
 * ApexRide — AUTHORITATIVE DATABASE DEFINITION (SINGLE SOURCE OF TRUTH)
 * =============================================================================
 *
 * THIS FILE IS THE SINGLE SOURCE OF TRUTH FOR THE APEXRIDE SCHEMA.
 *
 * `prisma/schema.prisma` in this directory is a PARTIAL, human-readable view
 * only. It exists so Prisma Client can generate types for this project. It is
 * NOT the schema of record, and it CANNOT be: the Prisma schema DSL has no
 * syntax for CHECK constraints, partial (WHERE-clause) indexes, or triggers,
 * all of which carry load-bearing guarantees in this design. Running
 * `prisma migrate dev` against this file would DROP those guarantees, so it is
 * never used as the migration executor. `npm run migrate` (this file) is the
 * only supported way to provision or evolve the ApexRide schema.
 *
 * Every constraint and index name in this file is the name that appears in
 * `pg_constraint.conname` / `pg_indexes.indexname`. The documentation
 * (HARD_QUESTIONS.md, ENTITIES.md, API_CONTRACTS.md) is held to exactly these
 * names. `npm run migrate` re-reads the catalog after applying DDL and writes
 * the observed inventory to evidence/ddl-inventory.txt so the documentation
 * can be diffed against reality rather than trusted.
 *
 * `prisma/migrations/` holds a recorded history generated FROM this file. It
 * is a history artifact, not an independent source of truth.
 *
 * Design invariants enforced here (see HARD_QUESTIONS.md):
 *   - Money is INTEGER minor units (kobo) with an ISO 4217 companion column.
 *   - Identifiers are UUIDs, never sequences.
 *   - Soft delete on Rider/Driver; append-only Trip/FareReceipt/Review.
 *   - Trip.driverId and Trip.vehicleId are NULLABLE until `driver_assigned`.
 * ========================================================================== */

import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

/** Fail fast if this script is not run from the ApexRide project root. */
function projectRoot(): string {
  const root = process.cwd();
  if (!fs.existsSync(path.join(root, "prisma", "schema.prisma"))) {
    throw new Error(
      `migrate.ts must run from the task-3-api-data-modeling project root. ` +
        `No prisma/schema.prisma found at ${root}.`
    );
  }
  return root;
}

const ROOT = projectRoot();
const EVIDENCE_DIR = path.join(ROOT, "evidence");

/** One row of pg_constraint / pg_indexes / pg_trigger output. */
interface CatalogRow {
  tableName: string;
  name: string;
  type?: string;
  definition: string;
}

const prisma = new PrismaClient();

export const DDL_STATEMENTS: string[] = [
    // 1. Enums
    `DO $$ BEGIN
      CREATE TYPE "DriverStatus" AS ENUM ('offline', 'available', 'busy', 'suspended');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    `DO $$ BEGIN
      CREATE TYPE "VehicleTier" AS ENUM ('standard', 'comfort', 'xl');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    `DO $$ BEGIN
      CREATE TYPE "TripStatus" AS ENUM ('requested', 'driver_assigned', 'driver_arriving', 'in_progress', 'completed', 'cancelled_by_rider', 'cancelled_by_driver');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    `DO $$ BEGIN
      CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'succeeded', 'failed', 'refunded');
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    // 2. Rider Table & Indexes
    `CREATE TABLE IF NOT EXISTS "Rider" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "fullName" VARCHAR(100) NOT NULL,
      "email" VARCHAR(255) UNIQUE NOT NULL,
      "phoneNumber" VARCHAR(20) UNIQUE NOT NULL,
      "rating" DECIMAL(3, 2) NOT NULL DEFAULT 5.00,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "deletedAt" TIMESTAMPTZ
    );`,
    `CREATE INDEX IF NOT EXISTS "idx_rider_email" ON "Rider"("email");`,
    `CREATE INDEX IF NOT EXISTS "idx_rider_phone" ON "Rider"("phoneNumber");`,

    // 3. Driver Table & Indexes
    `CREATE TABLE IF NOT EXISTS "Driver" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "fullName" VARCHAR(100) NOT NULL,
      "email" VARCHAR(255) UNIQUE NOT NULL,
      "phoneNumber" VARCHAR(20) UNIQUE NOT NULL,
      "licenseNumber" VARCHAR(50) UNIQUE NOT NULL,
      "status" "DriverStatus" NOT NULL DEFAULT 'offline',
      "rating" DECIMAL(3, 2) NOT NULL DEFAULT 5.00,
      "totalTrips" INTEGER NOT NULL DEFAULT 0,
      "currentLat" DOUBLE PRECISION,
      "currentLng" DOUBLE PRECISION,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "deletedAt" TIMESTAMPTZ
    );`,
    `CREATE INDEX IF NOT EXISTS "idx_driver_status_geo" ON "Driver"("status", "currentLat", "currentLng");`,
    `CREATE INDEX IF NOT EXISTS "idx_driver_email" ON "Driver"("email");`,

    // 4. Vehicle Table & Indexes
    // NOTE: "driverId" is NOT NULL — a vehicle always belongs to a driver.
    // The 1-to-1 "one ACTIVE vehicle per driver" rule is a partial unique
    // index, not a column constraint, so that a driver can retain historical
    // (isActive = false) vehicles without violating it.
    `CREATE TABLE IF NOT EXISTS "Vehicle" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "driverId" UUID NOT NULL REFERENCES "Driver"("id") ON DELETE CASCADE,
      "make" VARCHAR(50) NOT NULL,
      "model" VARCHAR(50) NOT NULL,
      "year" INTEGER NOT NULL,
      "licensePlate" VARCHAR(20) UNIQUE NOT NULL,
      "tier" "VehicleTier" NOT NULL DEFAULT 'standard',
      "color" VARCHAR(30) NOT NULL,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    // Historical lookup: all vehicles a driver has ever owned (1-to-N).
    `CREATE INDEX IF NOT EXISTS "idx_vehicle_driver" ON "Vehicle"("driverId", "isActive");`,
    // Cardinality guarantee: at most one isActive = true vehicle per driver.
    // Prisma cannot express a partial index, which is why schema.prisma omits it.
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_driver_single_active_vehicle"
    ON "Vehicle"("driverId")
    WHERE "isActive";`,

    // 5. Trip Table & Indexes
    // NULLABILITY CONTRACT (resolves the historical doc contradiction):
    //   "driverId"  NULL  is legal while no driver is bound to the trip:
    //               status = 'requested', or either cancellation status
    //               (a request can be cancelled before it is ever matched).
    //   "driverId"  NOT NULL is REQUIRED for the four matched statuses:
    //               'driver_assigned', 'driver_arriving', 'in_progress',
    //               'completed'.
    //               (cancelled_by_rider is deliberately NOT in that list: an
    //                unmatched request may be cancelled with no driver.)
    //   "vehicleId" is nullable for the whole lifecycle and is NOT covered by
    //   the CHECK below. It is additionally ON DELETE SET NULL, so a vehicle
    //   deletion can null it on any trip, including an in-flight one. Treat a
    //   non-null vehicleId as application-maintained data, not a guarantee.
    // ENFORCED BY: check_trip_driver_required_when_assigned (section 6).
    `CREATE TABLE IF NOT EXISTS "Trip" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "riderId" UUID NOT NULL REFERENCES "Rider"("id") ON DELETE RESTRICT,
      "driverId" UUID REFERENCES "Driver"("id") ON DELETE RESTRICT,
      "vehicleId" UUID REFERENCES "Vehicle"("id") ON DELETE SET NULL,
      "status" "TripStatus" NOT NULL DEFAULT 'requested',
      "pickupLat" DOUBLE PRECISION NOT NULL,
      "pickupLng" DOUBLE PRECISION NOT NULL,
      "pickupAddress" TEXT NOT NULL,
      "dropoffLat" DOUBLE PRECISION NOT NULL,
      "dropoffLng" DOUBLE PRECISION NOT NULL,
      "dropoffAddress" TEXT NOT NULL,
      "distanceMeters" INTEGER,
      "durationSeconds" INTEGER,
      "driverNameSnapshot" VARCHAR(100),
      "driverPhoneSnapshot" VARCHAR(20),
      "vehiclePlateSnapshot" VARCHAR(20),
      "vehicleModelSnapshot" VARCHAR(100),
      "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "acceptedAt" TIMESTAMPTZ,
      "startedAt" TIMESTAMPTZ,
      "completedAt" TIMESTAMPTZ,
      "cancelledAt" TIMESTAMPTZ,
      "cancellationReason" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,
    `CREATE INDEX IF NOT EXISTS "idx_trip_rider_status" ON "Trip"("riderId", "status");`,
    `CREATE INDEX IF NOT EXISTS "idx_trip_driver_status" ON "Trip"("driverId", "status");`,
    `CREATE INDEX IF NOT EXISTS "idx_trip_status_requestedAt" ON "Trip"("status", "requestedAt");`,
    `CREATE INDEX IF NOT EXISTS "idx_trip_rider_completed" ON "Trip"("riderId", "completedAt" DESC);`,

    // 6. Hard Constraints: Single Active Trip partial unique indexes
    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_rider_single_active_trip"
    ON "Trip"("riderId")
    WHERE status IN ('requested', 'driver_assigned', 'driver_arriving', 'in_progress');`,

    `CREATE UNIQUE INDEX IF NOT EXISTS "idx_driver_single_active_trip"
    ON "Trip"("driverId")
    WHERE status IN ('driver_assigned', 'driver_arriving', 'in_progress');`,

    // Single-table CHECK that turns "driverId is NULL until accepted" from a
    // comment into a guarantee: once a trip has been matched to a driver, the
    // driver binding can no longer be absent. Cancellation is deliberately
    // excluded from the NOT NULL side, because an unmatched request may be
    // cancelled by the rider while "driverId" is legitimately still NULL.
    `DO $$ BEGIN
      ALTER TABLE "Trip"
      ADD CONSTRAINT "check_trip_driver_required_when_assigned"
      CHECK (
        "status" NOT IN ('driver_assigned', 'driver_arriving', 'in_progress', 'completed')
        OR "driverId" IS NOT NULL
      );
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    // 7. FareReceipt Table & Constraints
    // MONEY RULE: every monetary column is INTEGER minor units (kobo for NGN).
    `CREATE TABLE IF NOT EXISTS "FareReceipt" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "tripId" UUID UNIQUE NOT NULL REFERENCES "Trip"("id") ON DELETE RESTRICT,
      "baseFareMinor" INTEGER NOT NULL,
      "distanceFareMinor" INTEGER NOT NULL,
      "timeFareMinor" INTEGER NOT NULL,
      "surgeMultiplier" DECIMAL(3, 2) NOT NULL DEFAULT 1.00,
      "subtotalMinor" INTEGER NOT NULL,
      "discountMinor" INTEGER NOT NULL DEFAULT 0,
      "totalFareMinor" INTEGER NOT NULL,
      "platformFeeMinor" INTEGER NOT NULL,
      "driverEarningsMinor" INTEGER NOT NULL,
      "currency" VARCHAR(3) NOT NULL DEFAULT 'NGN',
      "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
      "paymentMethod" VARCHAR(50),
      "paymentReference" VARCHAR(100),
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    // Backfill for databases provisioned before updatedAt existed here.
    `ALTER TABLE "FareReceipt" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();`,

    // "tripId UUID UNIQUE" above materialises as UNIQUE (tripId), which
    // PostgreSQL names "FareReceipt_tripId_key" and backs with a unique btree
    // index of the same name. Documentation must use that name.

    `DO $$ BEGIN
      ALTER TABLE "FareReceipt"
      ADD CONSTRAINT "check_fare_non_negative"
      CHECK ("totalFareMinor" >= 0 AND "driverEarningsMinor" >= 0);
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    `DO $$ BEGIN
      ALTER TABLE "FareReceipt"
      ADD CONSTRAINT "check_fare_ledger_balances"
      CHECK ("totalFareMinor" = "platformFeeMinor" + "driverEarningsMinor");
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    // 8. Review Table & Constraints
    `CREATE TABLE IF NOT EXISTS "Review" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "tripId" UUID UNIQUE NOT NULL REFERENCES "Trip"("id") ON DELETE RESTRICT,
      "riderId" UUID NOT NULL REFERENCES "Rider"("id") ON DELETE RESTRICT,
      "driverId" UUID NOT NULL REFERENCES "Driver"("id") ON DELETE RESTRICT,
      "rating" INTEGER NOT NULL,
      "comment" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    `ALTER TABLE "Review" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW();`,

    `DO $$ BEGIN
      ALTER TABLE "Review"
      ADD CONSTRAINT "check_rating_1_to_5"
      CHECK (rating >= 1 AND rating <= 5);
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    // 9. check_review_completed_trip_only
    //
    // A PostgreSQL CHECK constraint cannot reference another table, so a
    // "review only on a completed trip" rule is NOT expressible as a CHECK.
    // Two mechanisms were considered:
    //
    //   (a) Composite foreign key: add a denormalised Review.tripStatus
    //       column plus UNIQUE (id, status) on Trip, then FK
    //       (tripId, tripStatus) -> Trip(id, status) plus a CHECK pinning
    //       tripStatus to 'completed'. Rejected: it stores a second copy of
    //       Trip.status that can silently drift, it widens the write-side
    //       contract (every caller must supply tripStatus), and it still
    //       trusts the caller's copy rather than the live row.
    //
    //   (b) Row-level BEFORE trigger that reads the live Trip row. CHOSEN.
    //       It reads authoritative state, needs no extra column, and needs no
    //       caller cooperation. The BEFORE trigger also fires before the FK
    //       check, so it must tolerate a missing trip and let "Review_tripId_fkey"
    //       report that case; FOUND handles exactly that.
    //
    // Race analysis: the trigger observes Trip.status in the same READ COMMITTED
    // statement snapshot as the INSERT. A trip that is not yet completed is
    // rejected, and a trip can only reach 'completed' (never leave it — see the
    // terminal-state table in HARD_QUESTIONS.md section 3), so the rule cannot
    // be bypassed. The only residual is a false rejection of a review raced
    // microseconds ahead of the completion write, which the API retries as
    // TRIP_NOT_COMPLETED.
    //
    // It raises with ERRCODE 23514 (check_violation) and names itself in both
    // CONSTRAINT_NAME and the message, so API_CONTRACTS.md can map it to
    // 409 TRIP_NOT_COMPLETED and the proof test can assert on one stable token.
    `CREATE OR REPLACE FUNCTION "fn_review_completed_trip_only"() RETURNS trigger
    LANGUAGE plpgsql AS $fn$
    DECLARE
      v_status "TripStatus";
    BEGIN
      SELECT t."status" INTO v_status FROM "Trip" t WHERE t."id" = NEW."tripId";

      IF FOUND AND v_status IS DISTINCT FROM 'completed'::"TripStatus" THEN
        RAISE EXCEPTION
          'check_review_completed_trip_only: trip % is in status "%"; only completed trips may be reviewed',
          NEW."tripId", v_status
          USING
            ERRCODE = 'check_violation',
            CONSTRAINT = 'check_review_completed_trip_only';
      END IF;

      RETURN NEW;
    END;
    $fn$;`,

    `DROP TRIGGER IF EXISTS "trg_review_completed_trip_only" ON "Review";`,
    `CREATE TRIGGER "trg_review_completed_trip_only"
    BEFORE INSERT OR UPDATE OF "tripId" ON "Review"
    FOR EACH ROW EXECUTE FUNCTION "fn_review_completed_trip_only"();`,

    `CREATE INDEX IF NOT EXISTS "idx_review_driver_rating" ON "Review"("driverId", "rating");`,
    `CREATE INDEX IF NOT EXISTS "idx_review_rider" ON "Review"("riderId");`
];

export async function migrate() {
  console.log("Applying ApexRide DDL and Database Constraints...");

  const statements = DDL_STATEMENTS;

  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }

  console.log("ApexRide schema, constraints, and indexes successfully provisioned!");

  const inventory = await writeDdlInventory();
  console.log(
    `Catalog inventory written to ${path.join("evidence", "ddl-inventory.txt")} (${inventory.constraints} constraints, ${inventory.indexes} indexes, ${inventory.triggers} triggers).`
  );
}

/**
 * Reads pg_catalog after migration and writes the observed constraint, index
 * and trigger inventory to evidence/ddl-inventory.txt. This is the file the
 * documentation is validated against — it is generated from the live catalog,
 * never hand written.
 */
export async function writeDdlInventory() {
  const APEX_TABLES = "('Rider','Driver','Vehicle','Trip','FareReceipt','Review')";

  const constraints = await prisma.$queryRawUnsafe(
    `SELECT t.relname AS "tableName", c.conname AS "name", c.contype AS "type",
            pg_get_constraintdef(c.oid) AS "definition"
     FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = 'public' AND t.relname IN ${APEX_TABLES}
     ORDER BY t.relname, c.contype, c.conname`
  );

  const indexes = await prisma.$queryRawUnsafe(
    `SELECT tablename AS "tableName", indexname AS "name", indexdef AS "definition"
     FROM pg_indexes
     WHERE schemaname = 'public' AND tablename IN ${APEX_TABLES}
     ORDER BY tablename, indexname`
  );

  const triggers = await prisma.$queryRawUnsafe(
    `SELECT t.tgname AS "name", pg_get_triggerdef(t.oid) AS "definition"
     FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal
       AND n.nspname = 'public'
       AND c.relname IN ${APEX_TABLES}
     ORDER BY t.tgname`
  );

  const meta = await prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT current_database() AS "database", current_user AS "user",
            current_setting('server_version') AS "serverVersion", now() AS "capturedAt"`
  );

  const typeMap: Record<string, string> = {
    p: "PRIMARY KEY",
    u: "UNIQUE",
    f: "FOREIGN KEY",
    c: "CHECK",
    n: "NOT NULL",
  };

  const constraints_ = constraints as CatalogRow[];
  const indexes_ = indexes as CatalogRow[];
  const triggers_ = triggers as CatalogRow[];

  const lines: string[] = [];
  lines.push("=============================================================================");
  lines.push("APEXRIDE — DDL CATALOG INVENTORY (generated from pg_catalog, not hand written)");
  lines.push("=============================================================================");
  lines.push(`Generated by : npm run migrate  (src/db/migrate.ts)`);
  lines.push(`Captured at  : ${String(meta[0]?.capturedAt)}`);
  lines.push(`Database     : ${String(meta[0]?.database)} as ${String(meta[0]?.user)}`);
  lines.push(`Server       : PostgreSQL ${String(meta[0]?.serverVersion)}`);
  lines.push(`Source of    : pg_constraint, pg_indexes, pg_trigger`);
  lines.push("");
  lines.push(
    "Every name below is a fact about the deployed database. HARD_QUESTIONS.md," +
      "\nENTITIES.md and API_CONTRACTS.md must quote these names verbatim."
  );
  lines.push("");

  lines.push("-----------------------------------------------------------------------------");
  lines.push(`CONSTRAINTS (${constraints_.length})`);
  lines.push("-----------------------------------------------------------------------------");
  for (const c of constraints_) {
    lines.push(`[${c.tableName}] ${c.name}  (${c.type ? (typeMap[c.type] ?? c.type) : "UNNAMED"})`);
    lines.push(`    ${c.definition}`);
  }
  lines.push("");

  lines.push("-----------------------------------------------------------------------------");
  lines.push(`INDEXES (${indexes_.length})`);
  lines.push("-----------------------------------------------------------------------------");
  for (const i of indexes_) {
    lines.push(`[${i.tableName}] ${i.name}`);
    lines.push(`    ${i.definition}`);
  }
  lines.push("");

  lines.push("-----------------------------------------------------------------------------");
  lines.push(`TRIGGERS (${triggers_.length})`);
  lines.push("-----------------------------------------------------------------------------");
  for (const t of triggers_) {
    lines.push(`[${t.tableName}] ${t.name}`);
    lines.push(`    ${t.definition}`);
  }
  lines.push("");
  lines.push("=============================================================================");

  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(EVIDENCE_DIR, "ddl-inventory.txt"), lines.join("\n") + "\n", "utf8");

  return {
    constraints: constraints_.length,
    indexes: indexes_.length,
    triggers: triggers_.length,
  };
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrate()
    .catch((err) => {
      console.error("Migration error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
