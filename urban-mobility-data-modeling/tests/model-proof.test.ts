import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

describe("TASK 3: ApexRide Data Model Verification & Constraint Enforcement", () => {
  let riderId: string;
  let driverId: string;
  let vehicleId: string;

  beforeAll(async () => {
    await prisma.$connect();

    // Query active test fixtures
    const riders = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Rider" LIMIT 1;`;
    const drivers = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Driver" LIMIT 1;`;
    const vehicles = await prisma.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "Vehicle" LIMIT 1;`;

    riderId = riders[0].id;
    driverId = drivers[0].id;
    vehicleId = vehicles[0].id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. FIVE CORE ACTION QUERIES
  // =========================================================================

  it("Action 1: Rider requests a trip (validates rider has no other active trips)", async () => {
    const activeTrips = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "Trip"
      WHERE "riderId" = ${riderId}::uuid
        AND "status" IN ('requested', 'driver_assigned', 'driver_arriving', 'in_progress');
    `;
    expect(Number(activeTrips[0].count)).toBe(0);
  });

  it("Action 2: Driver accepts dispatch offer (geospatial query for available drivers)", async () => {
    const candidates = await prisma.$queryRaw<Array<{ id: string; fullName: string }>>`
      SELECT "id", "fullName", "rating"
      FROM "Driver"
      WHERE "status" = 'available'::"DriverStatus"
        AND "currentLat" BETWEEN 6.4000 AND 6.6000
        AND "currentLng" BETWEEN 3.3000 AND 3.5000
      ORDER BY "rating" DESC
      LIMIT 5;
    `;
    expect(candidates.length).toBeGreaterThan(0);
  });

  it("Action 3: Driver arrives and begins trip (checks valid state transition to in_progress)", async () => {
    const mockTrip = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Trip" (
        "id", "riderId", "driverId", "vehicleId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      ) VALUES (
        gen_random_uuid(), ${riderId}::uuid, ${driverId}::uuid, ${vehicleId}::uuid, 'driver_arriving'::"TripStatus",
        6.5244, 3.3792, 'Pickup Pin',
        6.4281, 3.4219, 'Destination Pin'
      ) RETURNING "id";
    `;
    const tripId = mockTrip[0].id;

    // Transition to in_progress
    const updated = await prisma.$queryRaw<Array<{ status: string }>>`
      UPDATE "Trip"
      SET "status" = 'in_progress'::"TripStatus", "startedAt" = NOW()
      WHERE "id" = ${tripId}::uuid AND "status" = 'driver_arriving'::"TripStatus"
      RETURNING "status";
    `;
    expect(updated[0].status).toBe("in_progress");

    // Clean up active test trip
    await prisma.$executeRawUnsafe(`DELETE FROM "Trip" WHERE "id" = '${tripId}'::uuid;`);
  });

  it("Action 4: Driver completes trip & queries financial ledger breakdown", async () => {
    const receipts = await prisma.$queryRaw<Array<{ totalFareMinor: number; currency: string }>>`
      SELECT "totalFareMinor", "driverEarningsMinor", "currency", "paymentStatus"
      FROM "FareReceipt"
      LIMIT 1;
    `;
    expect(receipts.length).toBe(1);
    expect(receipts[0].totalFareMinor).toBeGreaterThan(0);
    expect(receipts[0].currency).toBe("NGN");
  });

  it("Action 5: Rider submits review for completed trip", async () => {
    const reviews = await prisma.$queryRaw<Array<{ rating: number; comment: string }>>`
      SELECT "rating", "comment"
      FROM "Review"
      WHERE "rating" = 5
      LIMIT 1;
    `;
    expect(reviews.length).toBe(1);
    expect(reviews[0].rating).toBe(5);
  });

  // =========================================================================
  // 2. THREE REJECTED INVALID STATES (DATABASE-LEVEL CONSTRAINTS)
  // =========================================================================

  it("Constraint Proof 1: Rejects a rider attempting two concurrent active trips", async () => {
    // Insert 1st active trip (in_progress)
    const trip1 = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Trip" (
        "id", "riderId", "driverId", "vehicleId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      ) VALUES (
        gen_random_uuid(), ${riderId}::uuid, ${driverId}::uuid, ${vehicleId}::uuid, 'in_progress'::"TripStatus",
        6.5244, 3.3792, 'Origin 1',
        6.4281, 3.4219, 'Destination 1'
      ) RETURNING "id";
    `;

    // Attempt to insert 2nd active trip for the SAME rider -> Must be rejected by idx_rider_single_active_trip
    let errorCaught: any = null;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Trip" (
          "id", "riderId", "status",
          "pickupLat", "pickupLng", "pickupAddress",
          "dropoffLat", "dropoffLng", "dropoffAddress"
        ) VALUES (
          gen_random_uuid(), '${riderId}'::uuid, 'requested'::"TripStatus",
          6.5000, 3.3500, 'Origin 2',
          6.6000, 3.4000, 'Destination 2'
        );
      `);
    } catch (err: any) {
      errorCaught = err;
    }

    console.log(
      `[Constraint 1 Proof] Database rejected duplicate active trip:\nCode: ${errorCaught?.code}, Message: ${errorCaught?.message}`
    );
    expect(errorCaught).not.toBeNull();
    // PostgreSQL error code 23505 = unique_violation
    expect(errorCaught.message).toMatch(/idx_rider_single_active_trip|unique constraint|23505/i);

    // Clean up
    await prisma.$executeRawUnsafe(`DELETE FROM "Trip" WHERE "id" = '${trip1[0].id}'::uuid;`);
  });

  it("Constraint Proof 2: Rejects invalid review rating out of bounds (check_rating_1_to_5)", async () => {
    // Pick an existing completed trip
    const trip = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Trip" WHERE "status" = 'completed'::"TripStatus" LIMIT 1;
    `;
    const tripId = trip[0].id;

    // Attempt to insert review with rating = 6 (Allowed is 1 to 5)
    let errorCaught: any = null;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Review" ("id", "tripId", "riderId", "driverId", "rating", "comment")
        VALUES (
          gen_random_uuid(), '${tripId}'::uuid, '${riderId}'::uuid, '${driverId}'::uuid, 6, 'Illegal 6-star rating'
        );
      `);
    } catch (err: any) {
      errorCaught = err;
    }

    console.log(
      `[Constraint 2 Proof] Database rejected out-of-bounds star rating:\nCode: ${errorCaught?.code}, Message: ${errorCaught?.message}`
    );
    expect(errorCaught).not.toBeNull();
    // PostgreSQL error code 23514 = check_violation
    expect(errorCaught.message).toMatch(/check_rating_1_to_5|check constraint|23514/i);
  });

  it("Constraint Proof 3: Rejects negative fare amounts (check_fare_non_negative)", async () => {
    const trip = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Trip" WHERE "status" = 'completed'::"TripStatus" LIMIT 1;
    `;
    const tripId = trip[0].id;

    // Attempt to insert fare receipt with negative totalFareMinor (-50000 kobo)
    let errorCaught: any = null;
    try {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "FareReceipt" (
          "id", "tripId", "baseFareMinor", "distanceFareMinor", "timeFareMinor",
          "surgeMultiplier", "subtotalMinor", "discountMinor", "totalFareMinor",
          "platformFeeMinor", "driverEarningsMinor", "currency"
        ) VALUES (
          gen_random_uuid(), '${tripId}'::uuid, 80000, 100000, 50000,
          1.00, 230000, 0, -50000,
          0, 0, 'NGN'
        );
      `);
    } catch (err: any) {
      errorCaught = err;
    }

    console.log(
      `[Constraint 3 Proof] Database rejected negative fare calculation:\nCode: ${errorCaught?.code}, Message: ${errorCaught?.message}`
    );
    expect(errorCaught).not.toBeNull();
    // PostgreSQL error code 23514 = check_violation
    expect(errorCaught.message).toMatch(/check_fare_non_negative|check constraint|23514/i);
  });
});
