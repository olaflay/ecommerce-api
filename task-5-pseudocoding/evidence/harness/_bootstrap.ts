/**
 * Shared bootstrap for Part A evidence harnesses.
 *
 * These harnesses execute the REAL code in ../task-1-consumable-api/src against
 * the REAL Postgres database configured in the repository root .env. Nothing
 * here is a re-implementation: every assertion below is produced by running the
 * actual shipped module.
 *
 * SAFETY: harnesses that touch the database create their own fixtures with a
 * unique "pseudocode-lab" marker and delete them again in a finally block, so
 * the seeded dataset is left unchanged.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@prisma/client";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const TASK1_SRC = resolve(HERE, "../../../task-1-consumable-api/src");
export const MARKER = "pseudocode-lab";

export function loadDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  const envPath = resolve(HERE, "../../../.env");
  const raw = readFileSync(envPath, "utf8");
  const line = raw.split(/\r?\n/).find((l) => l.trim().startsWith("DATABASE_URL="));
  if (!line) throw new Error("DATABASE_URL not found in repository root .env");
  process.env.DATABASE_URL = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  return process.env.DATABASE_URL;
}

export const prisma = new PrismaClient();

/**
 * The evidence database is a managed Postgres over the public internet, so a
 * cold or reaped connection is a normal occurrence. Wait for a real round trip
 * before running any DB assertions, and fail loudly rather than silently
 * recording a connection error as a code defect.
 */
export async function requireDatabase(harness: string) {
  let last = "";
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      if (attempt > 1) console.log(`  (database reachable on attempt ${attempt})`);
      return;
    } catch (e) {
      last = (e as Error).message.split("\n")[0] ?? "";
      console.log(`  database attempt ${attempt}/6 failed: ${last}`);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  console.error(
    `\n${harness}: ABORTED. The database was unreachable after 6 attempts, so NO database ` +
      `assertion was recorded. This is an infrastructure failure, not a code result.`
  );
  console.error(`  last error: ${last}`);
  process.exit(2);
}

export function header(title: string, sourceFile: string) {
  const line = "=".repeat(79);
  console.log(line);
  console.log(title);
  console.log(line);
  console.log(`Real code under test: ${sourceFile}`);
  console.log(`Executed at:          ${new Date().toISOString()}`);
  console.log(`Node:                 ${process.version}`);
  console.log(line);
  console.log("");
}

let failures = 0;
let checks = 0;

export function check(label: string, actual: unknown, expected: unknown) {
  checks++;
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(
    `[${ok ? "PASS" : "FAIL"}] ${label}` +
      `\n       expected: ${JSON.stringify(expected)}` +
      `\n       actual:   ${JSON.stringify(actual)}`
  );
  return ok;
}

export function note(label: string, value: unknown) {
  console.log(`  NOTE  ${label}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
}

export function finish(harness: string) {
  console.log("");
  console.log("=".repeat(79));
  console.log(`${harness}: ${checks - failures}/${checks} assertions passed.`);
  console.log("=".repeat(79));
  return failures;
}

export function finishAndExit(harness: string) {
  const f = finish(harness);
  if (f > 0) {
    console.error("RESULT: FAIL — exiting with code 1");
    process.exit(1);
  }
  console.log("RESULT: PASS — exiting with code 0");
}
