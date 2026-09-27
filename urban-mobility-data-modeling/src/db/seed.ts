import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const prisma = new PrismaClient();

export async function seed() {
  console.log("Seeding ApexRide data...");

  // Clear existing records in reverse dependency order
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "Review", "FareReceipt", "Trip", "Vehicle", "Driver", "Rider" CASCADE;`);

  // 1. Seed Riders
  const riderRows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Rider" ("id", "fullName", "email", "phoneNumber", "rating") VALUES
      (gen_random_uuid(), 'Amaka Eze', 'amaka.eze@example.com', '+2348011112222', 4.95),
      (gen_random_uuid(), 'Tunde Bakare', 'tunde.bakare@example.com', '+2348033334444', 4.88),
      (gen_random_uuid(), 'Chidi Okonkwo', 'chidi.okonkwo@example.com', '+2348055556666', 5.00),
      (gen_random_uuid(), 'Fatima Danjuma', 'fatima.danjuma@example.com', '+2348077778888', 4.92),
      (gen_random_uuid(), 'Olumide Jacobs', 'olumide.jacobs@example.com', '+2348099990000', 4.75)
    RETURNING id;
  `;

  // 2. Seed Drivers
  const driverRows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Driver" ("id", "fullName", "email", "phoneNumber", "licenseNumber", "status", "rating", "totalTrips", "currentLat", "currentLng") VALUES
      (gen_random_uuid(), 'Babatunde Adeleke', 'babatunde.driver@example.com', '+2348123450001', 'DL-LAG-89211', 'available', 4.92, 120, 6.5244, 3.3792),
      (gen_random_uuid(), 'Emeka Nwosu', 'emeka.driver@example.com', '+2348123450002', 'DL-LAG-89212', 'available', 4.85, 95, 6.4281, 3.4219),
      (gen_random_uuid(), 'Ibrahim Musa', 'ibrahim.driver@example.com', '+2348123450003', 'DL-LAG-89213', 'available', 4.90, 140, 6.5000, 3.3500),
      (gen_random_uuid(), 'Segun Alabi', 'segun.driver@example.com', '+2348123450004', 'DL-LAG-89214', 'offline', 4.78, 62, 6.4500, 3.4000),
      (gen_random_uuid(), 'Kelechi Iheanacho', 'kelechi.driver@example.com', '+2348123450005', 'DL-LAG-89215', 'available', 4.96, 210, 6.6000, 3.3500)
    RETURNING id;
  `;

  // 3. Seed Vehicles
  const vehicleRows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "Vehicle" ("id", "driverId", "make", "model", "year", "licensePlate", "tier", "color") VALUES
      (gen_random_uuid(), ${driverRows[0].id}::uuid, 'Toyota', 'Corolla', 2021, 'KJA-492-AA', 'standard', 'Silver'),
      (gen_random_uuid(), ${driverRows[1].id}::uuid, 'Honda', 'Civic', 2022, 'LND-819-BB', 'comfort', 'Black'),
      (gen_random_uuid(), ${driverRows[2].id}::uuid, 'Toyota', 'Sienna', 2020, 'EPE-302-XL', 'xl', 'Grey'),
      (gen_random_uuid(), ${driverRows[3].id}::uuid, 'Hyundai', 'Elantra', 2021, 'IKJ-511-CC', 'standard', 'White'),
      (gen_random_uuid(), ${driverRows[4].id}::uuid, 'Toyota', 'Camry', 2023, 'APP-990-DD', 'comfort', 'Midnight Blue')
    RETURNING id;
  `;

  // 4. Seed Completed Historical Trips with FareReceipts and Reviews
  for (let i = 0; i < 5; i++) {
    const riderId = riderRows[i].id;
    const driverId = driverRows[i].id;
    const vehicleId = vehicleRows[i].id;

    const tripResult = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO "Trip" (
        "id", "riderId", "driverId", "vehicleId", "status",
        "pickupLat", "pickupLng", "pickupAddress",
        "dropoffLat", "dropoffLng", "dropoffAddress",
        "distanceMeters", "durationSeconds",
        "driverNameSnapshot", "driverPhoneSnapshot", "vehiclePlateSnapshot", "vehicleModelSnapshot",
        "requestedAt", "acceptedAt", "startedAt", "completedAt"
      ) VALUES (
        gen_random_uuid(), ${riderId}::uuid, ${driverId}::uuid, ${vehicleId}::uuid, 'completed'::"TripStatus",
        6.5244, 3.3792, '12 Admiralty Way, Lekki, Lagos',
        6.4281, 3.4219, 'Victoria Island Financial Center, Lagos',
        14200, 1940,
        'Babatunde Adeleke', '+2348123450001', 'KJA-492-AA', 'Toyota Corolla',
        NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days' + INTERVAL '2 minutes',
        NOW() - INTERVAL '2 days' + INTERVAL '10 minutes', NOW() - INTERVAL '2 days' + INTERVAL '42 minutes'
      )
      RETURNING id;
    `;

    const tripId = tripResult[0].id;

    // Insert FareReceipt
    await prisma.$executeRawUnsafe(`
      INSERT INTO "FareReceipt" (
        "id", "tripId", "baseFareMinor", "distanceFareMinor", "timeFareMinor",
        "surgeMultiplier", "subtotalMinor", "discountMinor", "totalFareMinor",
        "platformFeeMinor", "driverEarningsMinor", "currency", "paymentStatus", "paymentMethod"
      ) VALUES (
        gen_random_uuid(), '${tripId}'::uuid, 80000, 213000, 97000,
        1.20, 390000, 0, 468000,
        93600, 374400, 'NGN', 'succeeded'::"PaymentStatus", 'card'
      );
    `);

    // Insert Review
    await prisma.$executeRawUnsafe(`
      INSERT INTO "Review" (
        "id", "tripId", "riderId", "driverId", "rating", "comment"
      ) VALUES (
        gen_random_uuid(), '${tripId}'::uuid, '${riderId}'::uuid, '${driverId}'::uuid, 5, 'Exceptional navigation and courteous driver.'
      );
    `);
  }

  console.log("Successfully seeded ApexRide test dataset with riders, drivers, vehicles, completed trips, receipts, and reviews!");
}

if (process.argv[1] && process.argv[1].endsWith("seed.ts")) {
  seed()
    .catch((err) => {
      console.error("Seed error:", err);
      process.exit(1);
    })
    .finally(() => prisma.$disconnect());
}
