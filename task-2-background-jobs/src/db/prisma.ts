import { PrismaClient } from "@prisma/client";
import { config } from "../config/index.js";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

// The connection string comes from the validated config module, not from a raw
// `process.env.DATABASE_URL` read. Reading process.env directly here meant the
// zod validation in src/config/index.ts was decorative: a missing or empty
// DATABASE_URL failed the config parse but the client was constructed anyway.
export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasources: { db: { url: config.databaseUrl } },
    log: config.nodeEnv === "development" ? ["error", "warn"] : ["error"],
  });

if (config.nodeEnv !== "production") {
  globalForPrisma.prisma = prisma;
}
