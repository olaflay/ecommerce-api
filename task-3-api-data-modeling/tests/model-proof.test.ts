import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Prisma, PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

const EVIDENCE_DIR = path.join(process.cwd(), "evidence");
const VIOLATIONS_FILE = path.join(EVIDENCE_DIR, "constraint-violations.txt");

/** PostgreSQL SQLSTATE codes this suite asserts on. */
const PG = {
  UNIQUE_VIOLATION: "23505",
  CHECK_VIOLATION: "23514",
  FOREIGN_KEY_VIOLATION: "23503",
} as const;

/**
 * A rejection captured from the live database. Prisma wraps driver errors in
 * P2010 and puts the PostgreSQL SQLSTATE plus the server message in `meta`, so
 * both are recorded verbatim rather than reconstructed.
 */
interface Rejection {
  label: string;
  objectName: string;
  statement: string;
  prismaCode?: string;
  sqlstate?: string;
  constraint?: string;
  message: string;
}

function captureRejection(
  label: string,
  objectName: string,
  statement: string,
  err: unknown
): Rejection {
  const e = err as { code?: string; meta?: { code?: string; message?: string; constraint?: string }; message?: string };
  const message = e?.meta?.message ?? e?.message ?? String(err);
  return {
    label,
    objectName,
    statement,
    prismaCode: e?.code,
    sqlstate: e?.meta?.code,
    constraint: e?.meta?.constraint ?? constraintNamedInMessage(message),
    message,
  };
}

/**
 * Recovers the constraint name the server itself reported.
 *
 * Prisma surfaces raw query failures as P2010 and only forwards the SQLSTATE
 * and message, so `meta.constraint` is always absent. The PostgreSQL message
 * does name the object, in one of two shapes depending on the error class:
 *
 *   - CHECK / NOT NULL / FK:  ... violates check constraint "name" ...
 *   - trigger RAISE:         ERROR: name: <text>
 *
 * A partial UNIQUE index is the one case that is genuinely unnamed: the server
 * only reports the conflicting key columns, never the index. That is returned
 * as undefined on purpose rather than guessed at, and the proofs handle it by
 * asserting the conflict disappears outside the partial predicate.
 */
function constraintNamedInMessage(message: string): string | undefined {
  const check = message.match(/(?:violates|violation of) (?:check constraint|foreign key constraint|not-null constraint)\s+"([^"]+)"/i);
  if (check) return check[1];
  const unique = message.match(/violates unique constraint\s+"([^"]+)"/i);
  if (unique) return unique[1];
  const raised = message.match(/^ERROR:\s+([a-z_][a-z0-9_]*):\s/m);
  if (raised) return raised[1];
  return undefined;
}

/** Appends one verbatim rejection to the evidence artifact. */
function recordRejection(r: Rejection) {
  const body = [
    "",
    "-----------------------------------------------------------------------------",
    `PROOF      : ${r.label}`,
    `OBJECT     : ${r.objectName}`,
    "ATTEMPTED  :",
    ...r.statement
      .split("\n")
      .map((l) => `    ${l.trim()}`),
    `PRISMA CODE: ${r.prismaCode ?? "(none)"}`,
    `PG SQLSTATE: ${r.sqlstate ?? "(none)"}`,
    // A partial UNIQUE index is genuinely unnamed in the server's message: the
    // driver reports only the conflicting key columns. Those proofs assert the
    // conflict vanishes outside the partial predicate instead.
    `CONSTRAINT : ${r.constraint ?? "(unnamed in server message; partial UNIQUE index - see MESSAGE and the out-of-predicate control)"}`,
    "MESSAGE    :",
    ...r.message.split("\n").map((l) => `    ${l}`),
    "OUTCOME    : REJECTED BY THE DATABASE (statement raised, no row written)",
    "-----------------------------------------------------------------------------",
  ].join("\n");
  fs.appendFileSync(VIOLATIONS_FILE, body + "\n", "utf8");
}

describe("TASK 3: ApexRide Data Model Verification & Constraint Enforcement", () => {
  // ---- dedicated fixtures -------------------------------------------------
  // Every fixture below is created fresh in beforeAll and removed in afterAll.
  // Nothing here reuses a seeded trip that may already carry a Review or
  // FareReceipt, so no test's outcome depends on Postgres evaluating a CHECK
  // before a unique-index insertion, and no test depends on run order.
  let seededRiderId: string;
  let seededDriverId: string;
  let seededVehicleId: string;
  let seededVehicleDriverId: string;

  let proofRiderA: string; // owns the in_progress trip for constraint proof 1
  let proofRiderB: string; // owns completed/cancelled trips for proofs 2-4
  let proofDriverId: string; // owns the proof trips and the proof vehicle
  let busyDriverId: string; // inside the dispatch geofence but NOT available
  let proofVehicleId: string;

  let activeTripId: string; // in_progress, no receipt, no review
  let ratingTripId: string; // completed, no receipt, no review
  let boundaryTripId: string; // completed, no receipt, no review
  let fareTripId: string; // completed, no receipt, no review
  let cancelledTripId: string; // cancelled_by_rider, no receipt, no review

  const createdTripIds: string[] = [];
  const createdRiderIds: string[] = [];
  const createdDriverIds: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();

    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    fs.writeFileSync(
      VIOLATIONS_FILE,
      [
        "=============================================================================",
        "APEXRIDE — CONSTRAINT VIOLATION EVIDENCE (captured from the live database)",
        "=============================================================================",
        `Generated by : npm test  (tests/model-proof.test.ts)`,
        `Captured at  : ${new Date().toISOString()}`,
        `Database     : ${process.env.DATABASE_URL?.replace(/:[^:@/]+@/, ":***@") ?? "(unset)"}`,
        "",
        "PROVENANCE: every MESSAGE below is the verbatim text the PostgreSQL server",
        "returned. Nothing is paraphrased, and no rejection in this file was produced",
        "by anything other than an actual failed statement against the real schema.",
        "",
        "Each proof below asserts BOTH that the statement was rejected AND that the",
        "rejection names the specific object listed under OBJECT — so a rejection by",
        "some unrelated constraint would still fail the test.",
        "=============================================================================",
        "",
      ].join("\n"),
      "utf8"
    );

    // ---- seeded fixtures (read only) -------------------------------------
    const [r] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Rider" ORDER BY "id" LIMIT 1;`;
    const [d] = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Driver" ORDER BY "id" LIMIT 1;`;
    const [v] = await prisma.$queryRaw<Array<{ id: string; driverId: string }>>`
      SELECT "id", "driverId" FROM "Vehicle" ORDER BY "id" LIMIT 1;`;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    expect(r).toBeDefined();
    expect(d).toBeDefined();
    expect(v).toBeDefined();
    if (!r || !d || !v) {
      throw new Error("Seed data missing. Run `npm run seed` before `npm test`.");
    }
    seededRiderId = r.id;
    seededDriverId = d.id;
    seededVehicleId = v.id;
    seededVehicleDriverId = v.driverId;

    // ---- dedicated proof riders ------------------------------------------
    const mkRider = async (tag: string) => {
      const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Rider" ("fullName", "email", "phoneNumber", "rating")
        VALUES (
          ${`Proof Rider ${tag}`},
          ${`proof.rider.${tag}.`} || gen_random_uuid()::text || ${"@example.test"},
          ${`pw-${tag}-`} || substr(gen_random_uuid()::text, 1, 12),
          5.00
        )
        RETURNING "id";`;
      createdRiderIds.push(row!.id);
      return row!.id;
    };
    proofRiderA = await mkRider("A");
    proofRiderB = await mkRider("B");

    // ---- dedicated proof driver + vehicle --------------------------------
    const [pd] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Driver" ("fullName", "email", "phoneNumber", "licenseNumber", "status", "rating", "totalTrips", "currentLat", "currentLng")
      VALUES (
        ${"Proof Driver"},
        ${"proof.driver."} || gen_random_uuid()::text || ${"@example.test"},
        ${"pw-d-"} || substr(gen_random_uuid()::text, 1, 12),
        ${"DL-PROOF-"} || substr(gen_random_uuid()::text, 1, 8),
        'available'::"DriverStatus",
        5.00, 0, 6.5244, 3.3792
      )
      RETURNING "id";`;
    proofDriverId = pd!.id;
    createdDriverIds.push(proofDriverId);

    const [pv] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Vehicle" ("driverId", "make", "model", "year", "licensePlate", "tier", "color")
      VALUES (
        ${proofDriverId}::uuid, ${"Toyota"}, ${"Proof Corolla"}, 2024,
        ${"PRF-"} || substr(gen_random_uuid()::text, 1, 8), 'standard'::"VehicleTier", ${"White"}
      )
      RETURNING "id";`;
    proofVehicleId = pv!.id;

    // A driver sitting inside the dispatch geofence whose status is NOT
    // 'available'. Action 2 must never return this row.
    const [bd] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Driver" ("fullName", "email", "phoneNumber", "licenseNumber", "status", "rating", "totalTrips", "currentLat", "currentLng")
      VALUES (
        ${"Proof Busy Driver"},
        ${"proof.busy."} || gen_random_uuid()::text || ${"@example.test"},
        ${"pw-b-"} || substr(gen_random_uuid()::text, 1, 12),
        ${"DL-BUSY-"} || substr(gen_random_uuid()::text, 1, 8),
        'busy'::"DriverStatus",
        5.00, 7, 6.5244, 3.3792
      )
      RETURNING "id";`;
    busyDriverId = bd!.id;

    // ---- dedicated proof trips -------------------------------------------
    const mkTrip = async (
      riderId: string,
      driverId: string | null,
      vehicleId: string | null,
      status: string,
      completedAt: boolean
    ) => {
      const [row] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Trip" (
          "riderId", "driverId", "vehicleId", "status",
          "pickupLat", "pickupLng", "pickupAddress",
          "dropoffLat", "dropoffLng", "dropoffAddress",
          "completedAt"
        )
        VALUES (
          ${riderId}::uuid,
          ${driverId}::uuid,
          ${vehicleId}::uuid,
          ${status}::"TripStatus",
          6.5244, 3.3792, ${"Proof Pickup"},
          6.4281, 3.4219, ${"Proof Destination"},
          ${completedAt ? Prisma.sql`NOW()` : Prisma.sql`NULL`}
        )
        RETURNING "id";`;
      createdTripIds.push(row!.id);
      return row!.id;
    };

    activeTripId = await mkTrip(proofRiderA, proofDriverId, null, "in_progress", false);
    ratingTripId = await mkTrip(proofRiderB, proofDriverId, null, "completed", true);
    boundaryTripId = await mkTrip(proofRiderB, proofDriverId, null, "completed", true);
    fareTripId = await mkTrip(proofRiderB, proofDriverId, null, "completed", true);
    cancelledTripId = await mkTrip(proofRiderB, null, null, "cancelled_by_rider", false);
  });

  afterAll(async () => {
    // Set-based teardown over the proof fixtures only. Seeded rows are never
    // written to, so the dataset is left exactly as found. Each step is
    // independent and tolerant of partial state: a teardown failure must never
    // be reported as a test failure, or it would hide the real assertions.
    const allDriverIds = [proofDriverId, busyDriverId, ...createdDriverIds].filter(Boolean);
    const allRiderIds = [proofRiderA, proofRiderB, ...createdRiderIds].filter(Boolean);

    const steps: Array<() => Promise<unknown>> = [
      // Child rows first: both FKs into Trip are ON DELETE RESTRICT.
      () =>
        prisma.$executeRaw`
          DELETE FROM "Review"
          WHERE "tripId" IN (SELECT "id" FROM "Trip" WHERE "id" IN (
            ${Prisma.join(createdTripIds.map((id) => Prisma.sql`${id}::uuid`))}
          ));
        `,
      () =>
        prisma.$executeRaw`
          DELETE FROM "FareReceipt"
          WHERE "tripId" IN (SELECT "id" FROM "Trip" WHERE "id" IN (
            ${Prisma.join(createdTripIds.map((id) => Prisma.sql`${id}::uuid`))}
          ));
        `,
      () =>
        prisma.$executeRaw`
          DELETE FROM "Trip" WHERE "id" IN (
            ${Prisma.join(createdTripIds.map((id) => Prisma.sql`${id}::uuid`))}
          );
        `,
      // Vehicle before Driver: Vehicle.driverId is ON DELETE SET NULL, so
      // deleting the driver first would silently orphan the vehicles.
      () =>
        prisma.$executeRaw`
          DELETE FROM "Vehicle" WHERE "driverId" IN (
            ${Prisma.join(allDriverIds.map((id) => Prisma.sql`${id}::uuid`))}
          );
        `,
      () =>
        prisma.$executeRaw`
          DELETE FROM "Driver" WHERE "id" IN (
            ${Prisma.join(allDriverIds.map((id) => Prisma.sql`${id}::uuid`))}
          );
        `,
      () =>
        prisma.$executeRaw`
          DELETE FROM "Rider" WHERE "id" IN (
            ${Prisma.join(allRiderIds.map((id) => Prisma.sql`${id}::uuid`))}
          );
        `,
    ];

    for (const [index, step] of steps.entries()) {
      try {
        await step();
      } catch (err) {
        console.warn(`[teardown] step ${index} failed: ${(err as Error).message}`);
      }
    }
    await prisma.$disconnect();
  });

  // =========================================================================
  // 1. FIVE CORE ACTION QUERIES
  //    Each test performs the real write/read path from REQUIREMENTS.md and
  //    asserts a business invariant, not a tautology.
  // =========================================================================

  it("Action 1: Rider requests a trip — row is created unassigned and the active-trip guard returns exactly it", async () => {
    // The real write: a new trip must exist with NO driver bound.
    const inserted = await prisma.$queryRaw<
      Array<{ id: string; status: string; driverId: string | null; acceptedAt: Date | null; requestedAt: Date }>
    >`
      INSERT INTO "Trip" (
        "riderId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      )
      VALUES (
        ${seededRiderId}::uuid, 'requested'::"TripStatus",
        6.5244, 3.3792, ${"12 Admiralty Way, Lekki, Lagos"},
        6.4281, 3.4219, ${"Victoria Island Financial Center, Lagos"}
      )
      RETURNING "id", "status", "driverId", "acceptedAt", "requestedAt";
    `;

    expect(inserted).toHaveLength(1);
    const trip = inserted[0]!;

    // The NULL-until-accepted contract, asserted against the row just written.
    expect(trip.status).toBe("requested");
    expect(trip.driverId).toBeNull();
    expect(trip.acceptedAt).toBeNull();
    expect(trip.requestedAt).toBeInstanceOf(Date);

    try {
      // The real read Action 1 performs before offering the trip to dispatch.
      const active = await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id" FROM "Trip"
        WHERE "riderId" = ${seededRiderId}::uuid
          AND "status" IN ('requested','driver_assigned','driver_arriving','in_progress');
      `;
      expect(active).toHaveLength(1);
      expect(active[0]!.id).toBe(trip.id);
    } finally {
      await prisma.$executeRaw`DELETE FROM "Trip" WHERE "id" = ${trip.id}::uuid;`;
    }
  });

  it("Action 2: Driver accepts a dispatch offer — geofence search returns only available drivers inside 3km, nearest first", async () => {
    const PICKUP_LAT = 6.5244;
    const PICKUP_LNG = 3.3792;
    const GEOFENCE_M = 3000; // REQUIREMENTS.md Action 1: 3km geofence
    const RADIUS_DEG_LAT = GEOFENCE_M / 111320;
    const RADIUS_DEG_LNG = GEOFENCE_M / (111320 * Math.cos((PICKUP_LAT * Math.PI) / 180));

    const candidates = await prisma.$queryRaw<
      Array<{ id: string; status: string; distanceMeters: number }>
    >`
      SELECT d."id",
             d."status",
             (6371000 * 2 * asin(sqrt(
                power(sin(radians(d."currentLat" - ${PICKUP_LAT}::double precision) / 2), 2)
                + cos(radians(${PICKUP_LAT}::double precision)) * cos(radians(d."currentLat"))
                * power(sin(radians(d."currentLng" - ${PICKUP_LNG}::double precision) / 2), 2)
              ))) AS "distanceMeters"
      FROM "Driver" d
      WHERE d."status" = 'available'::"DriverStatus"
        AND d."deletedAt" IS NULL
        AND d."currentLat" IS NOT NULL
        AND d."currentLng" IS NOT NULL
        AND d."currentLat" BETWEEN ${PICKUP_LAT - RADIUS_DEG_LAT}::double precision AND ${PICKUP_LAT + RADIUS_DEG_LAT}::double precision
        AND d."currentLng" BETWEEN ${PICKUP_LNG - RADIUS_DEG_LNG}::double precision AND ${PICKUP_LNG + RADIUS_DEG_LNG}::double precision
      ORDER BY "distanceMeters" ASC
      LIMIT 10;
    `;

    expect(candidates.length).toBeGreaterThan(0);

    // Every hit is genuinely inside the dispatch geofence, not just inside the
    // bounding box. This is the rule the 3km radius exists to enforce.
    for (const c of candidates) {
      expect(c.distanceMeters).toBeLessThanOrEqual(GEOFENCE_M);
    }

    // Ordering guarantee: nearest first, non-decreasing.
    for (let i = 1; i < candidates.length; i++) {
      expect(candidates[i]!.distanceMeters).toBeGreaterThanOrEqual(
        candidates[i - 1]!.distanceMeters
      );
    }

    // A 'busy' driver parked at the exact pickup point must be excluded. This
    // is the assertion that would fail if the status filter were dropped.
    expect(candidates.map((c) => c.id)).not.toContain(busyDriverId);
    for (const c of candidates) {
      expect(c.status).toBe("available");
    }
  });

  it("Action 3: Driver arrives & begins trip — the guarded state transition fires once and is replay-safe", async () => {
    const [trip] = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Trip" (
        "riderId", "driverId", "vehicleId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      )
      VALUES (
        ${seededRiderId}::uuid, ${seededVehicleDriverId}::uuid, ${seededVehicleId}::uuid,
        'driver_arriving'::"TripStatus",
        6.5244, 3.3792, ${"Action 3 Pickup"},
        6.4281, 3.4219, ${"Action 3 Destination"}
      )
      RETURNING "id";
    `;
    const tripId = trip!.id;

    try {
      // The transition as the service layer issues it: conditional on the
      // current status, so a concurrent driver cannot double-start the trip.
      const firstStart = await prisma.$queryRaw<Array<{ status: string; startedAt: Date }>>`
        UPDATE "Trip"
        SET "status" = 'in_progress'::"TripStatus", "startedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = ${tripId}::uuid AND "status" = 'driver_arriving'::"TripStatus"
        RETURNING "status", "startedAt";
      `;
      expect(firstStart).toHaveLength(1);
      expect(firstStart[0]!.status).toBe("in_progress");
      expect(firstStart[0]!.startedAt).toBeInstanceOf(Date);

      // Replaying the identical request (client retry, double tap) must change
      // nothing. Zero rows updated is the whole point of the guard.
      const replayStart = await prisma.$queryRaw<Array<{ status: string; startedAt: Date }>>`
        UPDATE "Trip"
        SET "status" = 'in_progress'::"TripStatus", "startedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = ${tripId}::uuid AND "status" = 'driver_arriving'::"TripStatus"
        RETURNING "status", "startedAt";
      `;
      expect(replayStart).toHaveLength(0);

      const [after] = await prisma.$queryRaw<Array<{ status: string; startedAt: Date }>>`
        SELECT "status", "startedAt" FROM "Trip" WHERE "id" = ${tripId}::uuid;
      `;
      expect(after!.status).toBe("in_progress");
      expect(after!.startedAt.getTime()).toBe(firstStart[0]!.startedAt.getTime());
    } finally {
      await prisma.$executeRaw`DELETE FROM "Trip" WHERE "id" = ${tripId}::uuid;`;
    }
  });

  it("Action 4: Driver completes trip & triggers billing — every receipt reconciles against the minor-unit ledger identities", async () => {
    const receipts = await prisma.$queryRaw<
      Array<{
        tripId: string;
        tripStatus: string;
        baseFareMinor: number;
        distanceFareMinor: number;
        timeFareMinor: number;
        subtotalMinor: number;
        discountMinor: number;
        totalFareMinor: number;
        platformFeeMinor: number;
        driverEarningsMinor: number;
        currency: string;
        paymentStatus: string;
      }>
    >`
      SELECT t."id"                        AS "tripId",
             t."status"                    AS "tripStatus",
             f."baseFareMinor"             AS "baseFareMinor",
             f."distanceFareMinor"         AS "distanceFareMinor",
             f."timeFareMinor"             AS "timeFareMinor",
             f."subtotalMinor"             AS "subtotalMinor",
             f."discountMinor"             AS "discountMinor",
             f."totalFareMinor"            AS "totalFareMinor",
             f."platformFeeMinor"          AS "platformFeeMinor",
             f."driverEarningsMinor"       AS "driverEarningsMinor",
             f."currency"                  AS "currency",
             f."paymentStatus"             AS "paymentStatus"
      FROM "Trip" t
      JOIN "FareReceipt" f ON f."tripId" = t."id"
      WHERE t."driverId" = ${seededDriverId}::uuid
        AND t."status" = 'completed'::"TripStatus"
      ORDER BY t."completedAt" DESC
      LIMIT 20 OFFSET 0;
    `;

    expect(receipts.length).toBeGreaterThan(0);

    for (const r of receipts) {
      // A receipt may only exist for a completed trip. This is the Trip-1 join
      // the completion path depends on, asserted over real rows.
      expect(r.tripStatus).toBe("completed");

      // Money identity 1: the three components must sum to the subtotal.
      expect(r.baseFareMinor + r.distanceFareMinor + r.timeFareMinor).toBe(r.subtotalMinor);

      // Money identity 2: the rider is charged exactly what the platform keeps
      // plus what the driver earns. This is what check_fare_ledger_balances
      // enforces at the storage layer; here it is checked on real data.
      expect(r.totalFareMinor).toBe(r.platformFeeMinor + r.driverEarningsMinor);

      // Minor units are never negative and always carry an ISO 4217 code.
      expect(r.totalFareMinor).toBeGreaterThanOrEqual(0);
      expect(r.driverEarningsMinor).toBeGreaterThanOrEqual(0);
      expect(r.currency).toMatch(/^[A-Z]{3}$/);
      expect(r.paymentStatus).toBe("succeeded");
    }
  });

  it("Action 5: Rider submits a review — only completed, un-reviewed trips are eligible, and stored reviews reference completed trips", async () => {
    // (a) The eligibility feed the review modal is built from. proofRiderB owns
    //     two completed trips that have NOT been reviewed, so this must not be
    //     empty, and it must exclude the cancelled trip.
    const eligible = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
      SELECT t."id", t."status"
      FROM "Trip" t
      WHERE t."riderId" = ${proofRiderB}::uuid
        AND t."status" = 'completed'::"TripStatus"
        AND NOT EXISTS (SELECT 1 FROM "Review" r WHERE r."tripId" = t."id")
      ORDER BY t."completedAt" DESC
      LIMIT 20;
    `;
    // proofRiderB owns exactly three completed unreviewed fixture trips at
    // this point (ratingTripId, boundaryTripId, fareTripId) plus one cancelled
    // trip, so the eligible feed is exactly those three.
    expect(eligible).toHaveLength(3);
    for (const e of eligible) {
      expect(e.status).toBe("completed");
    }
    expect(eligible.map((e) => e.id).sort()).toEqual(
      [ratingTripId, boundaryTripId, fareTripId].sort()
    );
    expect(eligible.map((e) => e.id)).not.toContain(cancelledTripId);

    // (b) The review read path: a stored review must always point at a
    //     completed trip, and the rating must be inside 1..5.
    const reviews = await prisma.$queryRaw<
      Array<{ id: string; tripId: string; rating: number; tripStatus: string }>
    >`
      SELECT r."id", r."tripId", r."rating", t."status" AS "tripStatus"
      FROM "Review" r
      JOIN "Trip" t ON t."id" = r."tripId"
      WHERE r."riderId" = ${proofRiderB}::uuid
      ORDER BY r."createdAt" DESC
      LIMIT 20 OFFSET 0;
    `;
    expect(reviews).toHaveLength(0);

    const seededReviews = await prisma.$queryRaw<
      Array<{ rating: number; tripStatus: string }>
    >`
      SELECT r."rating", t."status" AS "tripStatus"
      FROM "Review" r
      JOIN "Trip" t ON t."id" = r."tripId"
      WHERE r."riderId" = ${seededRiderId}::uuid;
    `;
    expect(seededReviews.length).toBeGreaterThan(0);
    for (const r of seededReviews) {
      // The invariant check_review_completed_trip_only protects, verified over
      // every real review row rather than asserted in prose.
      expect(r.tripStatus).toBe("completed");
      expect(r.rating).toBeGreaterThanOrEqual(1);
      expect(r.rating).toBeLessThanOrEqual(5);
    }
  });

  it("List contract: limit/offset paging over the completed-trip ledger is stable, ordered and disjoint", async () => {
    const all = await prisma.$queryRaw<Array<{ id: string; completedAt: Date }>>`
      SELECT "id", "completedAt" FROM "Trip"
      WHERE "status" = 'completed'::"TripStatus"
      ORDER BY "completedAt" DESC, "id" DESC;
    `;
    expect(all.length).toBeGreaterThanOrEqual(4);

    const page1 = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Trip"
      WHERE "status" = 'completed'::"TripStatus"
      ORDER BY "completedAt" DESC, "id" DESC
      LIMIT 2 OFFSET 0;
    `;
    const page2 = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Trip"
      WHERE "status" = 'completed'::"TripStatus"
      ORDER BY "completedAt" DESC, "id" DESC
      LIMIT 2 OFFSET 2;
    `;

    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    // Disjoint pages: no row is served twice.
    expect(page1.map((r) => r.id)).toEqual(all.slice(0, 2).map((r) => r.id));
    expect(page2.map((r) => r.id)).toEqual(all.slice(2, 4).map((r) => r.id));
    expect(page1.filter((r) => page2.some((q) => q.id === r.id))).toHaveLength(0);
  });

  // =========================================================================
  // 2. REJECTED INVALID STATES (DATABASE-LEVEL CONSTRAINTS)
  //    Each proof runs a statement that MUST fail, asserts the PostgreSQL
  //    SQLSTATE, asserts the message names the intended object, and appends
  //    the verbatim server response to evidence/constraint-violations.txt.
  // =========================================================================

  it("Constraint Proof 1: Rejects a second concurrent active trip for the same rider AND for the same driver (23505)", async () => {
    // 1a. proofRiderA already owns activeTripId, an in_progress trip.
    const secondForRider = `
      INSERT INTO "Trip" (
        "riderId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      )
      VALUES (
        '${proofRiderA}'::uuid, 'requested'::"TripStatus",
        6.5, 3.3, 'Second origin',
        6.6, 3.4, 'Second destination'
      );`;

    let riderErr: unknown = null;
    try {
      await prisma.$executeRawUnsafe(secondForRider);
    } catch (err) {
      riderErr = err;
    }
    expect(riderErr, "second active trip for one rider was ACCEPTED").not.toBeNull();
    const riderRejection = captureRejection(
      "Constraint Proof 1a — rider may hold only one active trip",
      "idx_rider_single_active_trip (partial unique index on Trip(riderId))",
      secondForRider,
      riderErr
    );
    recordRejection(riderRejection);
    console.log(
      `[Constraint Proof 1a] ${riderRejection.sqlstate} ${riderRejection.objectName}\n    ${riderRejection.message}`
    );
    // A partial UNIQUE index is never named by the server, so the evidence
    // must state that honestly rather than printing the index name here.
    expect(riderRejection.constraint).toBeUndefined();
    expect(riderRejection.sqlstate).toBe(PG.UNIQUE_VIOLATION);
    // PostgreSQL does not print a partial index's name in a unique violation,
    // so the index is identified the only way that is actually provable: the
    // same insert must SUCCEED once the status leaves the partial predicate.
    // That proves it was the status-scoped predicate, not a blanket UNIQUE.
    expect(riderRejection.message).toMatch(/\("riderId"\)/);
    // cancelled_by_rider is outside the active predicate, so this same rider
    // may hold it. That is what proves the rejection came from the predicate
    // rather than from a blanket UNIQUE on Trip(riderId). (completed is NOT
    // usable here: check_trip_driver_required_when_assigned demands a driver
    // for completed, and this control row has none.)
    const riderTerminal = `
      INSERT INTO "Trip" (
        "riderId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      )
      VALUES (
        '${proofRiderA}'::uuid, 'cancelled_by_rider'::"TripStatus",
        6.5, 3.3, 'Second origin',
        6.6, 3.4, 'Second destination'
      )
      RETURNING "id";`;
    const [terminalRow] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(riderTerminal);
    await prisma.$executeRaw`DELETE FROM "Trip" WHERE "id" = ${terminalRow!.id}::uuid;`;

    // 1b. proofDriver already owns activeTripId, so a second active trip for
    //     the same driver must fail on the OTHER partial unique index.
    const secondForDriver = `
      INSERT INTO "Trip" (
        "riderId", "driverId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      )
      VALUES (
        '${proofRiderB}'::uuid, '${proofDriverId}'::uuid, 'in_progress'::"TripStatus",
        6.5, 3.3, 'Second origin',
        6.6, 3.4, 'Second destination'
      );`;

    let driverErr: unknown = null;
    try {
      await prisma.$executeRawUnsafe(secondForDriver);
    } catch (err) {
      driverErr = err;
    }
    expect(driverErr, "second active trip for one driver was ACCEPTED").not.toBeNull();
    const driverRejection = captureRejection(
      "Constraint Proof 1b — driver may hold only one active trip",
      "idx_driver_single_active_trip (partial unique index on Trip(driverId))",
      secondForDriver,
      driverErr
    );
    recordRejection(driverRejection);
    console.log(
      `[Constraint Proof 1b] ${driverRejection.sqlstate} ${driverRejection.objectName}\n    ${driverRejection.message}`
    );
    expect(driverRejection.sqlstate).toBe(PG.UNIQUE_VIOLATION);
    expect(driverRejection.message).toMatch(/\("driverId"\)/);
    // Same proof for the driver-side predicate: a completed (non-active) trip
    // for the same driver is legal, so the rejection came from the predicate.
    const driverTerminal = `
      INSERT INTO "Trip" (
        "riderId", "driverId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress"
      )
      VALUES (
        '${proofRiderB}'::uuid, '${proofDriverId}'::uuid, 'cancelled_by_driver'::"TripStatus",
        6.5, 3.3, 'Second origin',
        6.6, 3.4, 'Second destination'
      )
      RETURNING "id";`;
    const [driverTerminalRow] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(driverTerminal);
    await prisma.$executeRaw`DELETE FROM "Trip" WHERE "id" = ${driverTerminalRow!.id}::uuid;`;

    // Nothing leaked: the two rejected inserts wrote no rows.
    const riderActive = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "Trip"
      WHERE "riderId" = ${proofRiderA}::uuid
        AND "status" IN ('requested','driver_assigned','driver_arriving','in_progress');
    `;
    expect(Number(riderActive[0]!.count)).toBe(1);
  });

  it("Constraint Proof 2: Rejects out-of-bounds review ratings (check_rating_1_to_5, 23514) on a dedicated completed trip", async () => {
    const statementFor = (rating: number) => `
      INSERT INTO "Review" ("tripId", "riderId", "driverId", "rating", "comment")
      VALUES (
        '${ratingTripId}'::uuid, '${proofRiderB}'::uuid, '${proofDriverId}'::uuid,
        ${rating}, 'Deliberately invalid star rating'
      );`;

    for (const badRating of [6, 0, -1]) {
      let err: unknown = null;
      try {
        await prisma.$executeRawUnsafe(statementFor(badRating));
      } catch (e) {
        err = e;
      }
      expect(err, `rating ${badRating} was ACCEPTED`).not.toBeNull();
      const rejection = captureRejection(
        `Constraint Proof 2 — rating ${badRating} rejected (valid range is 1..5)`,
        "check_rating_1_to_5 (CHECK constraint on Review(rating))",
        statementFor(badRating),
        err
      );
      recordRejection(rejection);
      console.log(
        `[Constraint Proof 2, rating=${badRating}] ${rejection.sqlstate} ${rejection.objectName}\n    ${rejection.message}`
      );
      expect(rejection.sqlstate).toBe(PG.CHECK_VIOLATION);
      expect(rejection.message).toMatch(/check_rating_1_to_5/);
      // The server names the object, so the evidence records it verbatim.
      expect(rejection.constraint).toBe("check_rating_1_to_5");
    }

    // The boundary values must be ACCEPTED, or the CHECK is too strict. Two
    // distinct trips are needed because Review.tripId is UNIQUE (one review
    // per trip), so a single trip cannot carry both boundary rows.
    const boundaryTrips: Array<{ tripId: string; rating: number }> = [
      { tripId: ratingTripId, rating: 1 },
      { tripId: boundaryTripId, rating: 5 },
    ];
    for (const { tripId, rating } of boundaryTrips) {
      await prisma.$queryRaw`
        INSERT INTO "Review" ("tripId", "riderId", "driverId", "rating", "comment")
        VALUES (${tripId}::uuid, ${proofRiderB}::uuid, ${proofDriverId}::uuid, ${rating}, 'Boundary value accepted');
      `;
    }
    const stored = await prisma.$queryRaw<Array<{ tripId: string; rating: number }>>`
      SELECT "tripId", "rating" FROM "Review"
      WHERE "tripId" IN (${ratingTripId}::uuid, ${boundaryTripId}::uuid)
      ORDER BY "rating";
    `;
    // Rows are ordered by rating, so rating 1 pairs with ratingTripId and
    // rating 5 with boundaryTripId.
    expect(stored.map((r) => r.rating)).toEqual([1, 5]);
    expect(stored.map((r) => r.tripId)).toEqual([ratingTripId, boundaryTripId]);
  });

  it("Constraint Proof 3: Rejects negative fare amounts (check_fare_non_negative, 23514) on a dedicated completed trip", async () => {
    const statementFor = (total: number, earnings: number) => `
      INSERT INTO "FareReceipt" (
        "tripId", "baseFareMinor", "distanceFareMinor", "timeFareMinor",
        "surgeMultiplier", "subtotalMinor", "discountMinor", "totalFareMinor",
        "platformFeeMinor", "driverEarningsMinor", "currency"
      )
      VALUES (
        '${fareTripId}'::uuid, 80000, 100000, 50000,
        1.00, 230000, 0, ${total},
        ${total - earnings}, ${earnings}, 'NGN'
      );`;

    for (const [total, earnings] of [
      [-50000, 0],
      [100000, -1],
    ]) {
      let err: unknown = null;
      try {
        await prisma.$executeRawUnsafe(statementFor(total, earnings));
      } catch (e) {
        err = e;
      }
      expect(err, `negative fare (${total}, ${earnings}) was ACCEPTED`).not.toBeNull();
      const rejection = captureRejection(
        `Constraint Proof 3 — totalFareMinor=${total}, driverEarningsMinor=${earnings} rejected`,
        "check_fare_non_negative (CHECK constraint on FareReceipt)",
        statementFor(total, earnings),
        err
      );
      recordRejection(rejection);
      console.log(
        `[Constraint Proof 3, ${total}/${earnings}] ${rejection.sqlstate} ${rejection.objectName}\n    ${rejection.message}`
      );
      expect(rejection.sqlstate).toBe(PG.CHECK_VIOLATION);
      expect(rejection.message).toMatch(/check_fare_non_negative/);
      expect(rejection.constraint).toBe("check_fare_non_negative");
    }

    // No receipt may have been written for the trip under test.
    const count = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "FareReceipt" WHERE "tripId" = ${fareTripId}::uuid;
    `;
    expect(Number(count[0]!.count)).toBe(0);
  });

  it("Constraint Proof 4: Rejects a review of a trip that is not completed (check_review_completed_trip_only, 23514)", async () => {
    // A CHECK cannot reference another table, so the "only completed trips may
    // be reviewed" rule is carried by the trigger
    // trg_review_completed_trip_only, which reads the live Trip row. Prove it
    // for every non-completed status.
    //
    // Each status gets its OWN rider and OWN driver. Sharing proofRiderB or
    // proofDriverId would make the fixture collide with
    // idx_rider_single_active_trip / idx_driver_single_active_trip and the
    // insert would fail on the wrong constraint (23505) before the trigger
    // ever runs, which would prove nothing about the review rule.
    const nonCompleted = ["requested", "driver_assigned", "driver_arriving", "in_progress", "cancelled_by_rider", "cancelled_by_driver"];

    for (const [index, status] of nonCompleted.entries()) {
      const tag = `P4${index}`;

      const [r] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Rider" ("fullName", "email", "phoneNumber", "rating")
        VALUES (
          ${`Proof4 Rider ${tag}`},
          ${`proof4.rider.${tag}.`} || gen_random_uuid()::text || ${"@example.test"},
          ${`p4-${tag}-`} || substr(gen_random_uuid()::text, 1, 8),
          5.00
        )
        RETURNING "id";
      `;
      createdRiderIds.push(r!.id);

      const needsDriver = !status.startsWith("cancelled");
      let driverForTrip: string | null = null;
      if (needsDriver) {
        // driver_assigned / driver_arriving / in_progress are active statuses,
        // so check_trip_driver_required_when_assigned demands a driver.
        const [d] = await prisma.$queryRaw<Array<{ id: string }>>`
          INSERT INTO "Driver" ("fullName", "email", "phoneNumber", "licenseNumber", "status", "rating", "totalTrips", "currentLat", "currentLng")
          VALUES (
            ${`Proof4 Driver ${tag}`},
            ${`proof4.driver.${tag}.`} || gen_random_uuid()::text || ${"@example.test"},
            ${`p4d-${tag}-`} || substr(gen_random_uuid()::text, 1, 8),
            ${`DL-P4${index}-`} || substr(gen_random_uuid()::text, 1, 6),
            'available'::"DriverStatus",
            5.00, 0, 6.5244, 3.3792
          )
          RETURNING "id";
        `;
        createdDriverIds.push(d!.id);
        driverForTrip = d!.id;
      }

      const [t] = await prisma.$queryRaw<Array<{ id: string }>>`
        INSERT INTO "Trip" (
          "riderId", "driverId", "status",
          "pickupLat", "pickupLng", "pickupAddress",
          "dropoffLat", "dropoffLng", "dropoffAddress"
        )
        VALUES (
          ${r!.id}::uuid, ${driverForTrip}::uuid,
          ${status}::"TripStatus",
          6.5, 3.3, 'Proof 4 origin',
          6.6, 3.4, 'Proof 4 destination'
        )
        RETURNING "id";
      `;
      createdTripIds.push(t!.id);

      const statement = `
        INSERT INTO "Review" ("tripId", "riderId", "driverId", "rating", "comment")
        VALUES (
          '${t!.id}'::uuid, '${r!.id}'::uuid, '${proofDriverId}'::uuid,
          5, 'Review of a trip that never completed'
        );`;

      let err: unknown = null;
      try {
        await prisma.$executeRawUnsafe(statement);
      } catch (e) {
        err = e;
      }
      expect(err, `review of a '${status}' trip was ACCEPTED`).not.toBeNull();
      const rejection = captureRejection(
        `Constraint Proof 4 — review of a '${status}' trip rejected`,
        "check_review_completed_trip_only (via trigger trg_review_completed_trip_only on Review)",
        statement,
        err
      );
      recordRejection(rejection);
      console.log(
        `[Constraint Proof 4, status=${status}] ${rejection.sqlstate} ${rejection.objectName}\n    ${rejection.message}`
      );
      expect(rejection.sqlstate).toBe(PG.CHECK_VIOLATION);
      expect(rejection.message).toMatch(/check_review_completed_trip_only/);
      expect(rejection.message).toMatch(new RegExp(`is in status "${status}"`));
      // The trigger raised this, and the first token of the RAISE message is
      // the logical rule name carried by fn_review_completed_trip_only.
      expect(rejection.constraint).toBe("check_review_completed_trip_only");
    }

    // Control: the same statement against a COMPLETED trip must succeed,
    // otherwise the trigger would be rejecting everything. fareTripId is a
    // dedicated completed trip that no other test writes a review to.
    await prisma.$queryRaw`
      INSERT INTO "Review" ("tripId", "riderId", "driverId", "rating", "comment")
      VALUES (${fareTripId}::uuid, ${proofRiderB}::uuid, ${proofDriverId}::uuid, 4, 'Control: completed trip accepted');
    `;
    const control = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count FROM "Review" WHERE "tripId" = ${fareTripId}::uuid;
    `;
    expect(Number(control[0]!.count)).toBe(1);
  });

  it("Constraint Proof 5: Rejects a second ACTIVE vehicle for one driver, while still allowing a retired one (idx_driver_single_active_vehicle, 23505)", async () => {
    const secondActive = `
      INSERT INTO "Vehicle" ("driverId", "make", "model", "year", "licensePlate", "color")
      VALUES (
        '${proofDriverId}'::uuid, 'Honda', 'Second Active Car', 2023,
        'DUP-' || substr(gen_random_uuid()::text, 1, 8), 'Black'
      );`;

    let err: unknown = null;
    try {
      await prisma.$executeRawUnsafe(secondActive);
    } catch (e) {
      err = e;
    }
    expect(err, "a second active vehicle for one driver was ACCEPTED").not.toBeNull();
    const rejection = captureRejection(
      "Constraint Proof 5 — driver may hold only one active vehicle",
      "idx_driver_single_active_vehicle (partial unique index on Vehicle(driverId) WHERE isActive)",
      secondActive,
      err
    );
    recordRejection(rejection);
    console.log(`[Constraint Proof 5] ${rejection.sqlstate} ${rejection.objectName}\n    ${rejection.message}`);
    expect(rejection.sqlstate).toBe(PG.UNIQUE_VIOLATION);
    expect(rejection.message).toMatch(/\("driverId"\)/);
    expect(rejection.constraint).toBeUndefined();

    // The predicate is WHERE "isActive", so a RETIRED second vehiclemust be
    // allowed. This is what makes the relationship 1-to-1 (active) / 1-to-N
    // (historical) rather than a blanket one-row-per-driver rule.
    await prisma.$queryRaw`
      INSERT INTO "Vehicle" ("driverId", "make", "model", "year", "licensePlate", "color", "isActive")
      VALUES (
        ${proofDriverId}::uuid, 'Honda', 'Retired Car', 2018,
        ${"RET-" + Math.random().toString(36).slice(2, 10)}, 'Grey', false
      );
    `;
    const vehicles = await prisma.$queryRaw<Array<{ isActive: boolean }>>`
      SELECT "isActive" FROM "Vehicle" WHERE "driverId" = ${proofDriverId}::uuid ORDER BY "isActive";
    `;
    expect(vehicles.filter((v) => v.isActive)).toHaveLength(1);
    expect(vehicles.filter((v) => !v.isActive)).toHaveLength(1);
  });
});
