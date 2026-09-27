import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

export async function migrate() {
  console.log("Applying ApexRide DDL and Database Constraints...");

  const statements = [
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
    `CREATE INDEX IF NOT EXISTS "idx_vehicle_driver" ON "Vehicle"("driverId", "isActive");`,

    // 5. Trip Table & Indexes
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

    // 7. FareReceipt Table & Constraints
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
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    `DO $$ BEGIN
      ALTER TABLE "FareReceipt"
      ADD CONSTRAINT "check_fare_non_negative"
      CHECK ("totalFareMinor" >= 0 AND "driverEarningsMinor" >= 0);
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    // 8. Review Table & Constraints
    `CREATE TABLE IF NOT EXISTS "Review" (
      "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      "tripId" UUID UNIQUE NOT NULL REFERENCES "Trip"("id") ON DELETE RESTRICT,
      "riderId" UUID NOT NULL REFERENCES "Rider"("id") ON DELETE RESTRICT,
      "driverId" UUID NOT NULL REFERENCES "Driver"("id") ON DELETE RESTRICT,
      "rating" INTEGER NOT NULL,
      "comment" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );`,

    `DO $$ BEGIN
      ALTER TABLE "Review"
      ADD CONSTRAINT "check_rating_1_to_5"
      CHECK (rating >= 1 AND rating <= 5);
    EXCEPTION WHEN duplicate_object THEN null; END $$;`,

    `CREATE INDEX IF NOT EXISTS "idx_review_driver_rating" ON "Review"("driverId", "rating");`
  ];

  for (const stmt of statements) {
    await prisma.$executeRawUnsafe(stmt);
  }

  console.log("ApexRide schema, constraints, and indexes successfully provisioned!");
}

if (process.argv[1] && process.argv[1].endsWith("migrate.ts")) {
  migrate()
    .catch((err) => {
      console.error("Migration error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
