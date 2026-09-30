#!/usr/bin/env node
/**
 * Points Prisma at an isolated Postgres schema so the test suite never writes to
 * the `public` schema, where the dev/demo data and Task 1's tables live.
 *
 *   node scripts/test-db.mjs deploy   -> apply migrations to the test schema
 *   node scripts/test-db.mjs reset    -> drop the test schema, then apply
 *
 * The schema name comes from TEST_DB_SCHEMA (default `task2_test`). The host,
 * credentials and SSL settings come from TEST_DATABASE_URL when set, otherwise
 * from DATABASE_URL, so no credentials live in this file or in the repo.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

const mode = process.argv[2] ?? "deploy";
const schema = process.env.TEST_DB_SCHEMA || "task2_test";
const baseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

if (!baseUrl) {
  console.error(
    "[test-db] No database URL. Set TEST_DATABASE_URL, or DATABASE_URL in .env."
  );
  process.exit(1);
}

const url = new URL(baseUrl);
url.searchParams.set("schema", schema);
const testUrl = url.toString();

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prismaBin = path.join(projectRoot, "node_modules", "prisma", "build", "index.js");

const run = (args) =>
  spawnSync(process.execPath, [prismaBin, ...args], {
    cwd: projectRoot,
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testUrl },
  });

console.log(`[test-db] mode=${mode} schema=${schema}`);

if (mode === "reset") {
  // `migrate reset` would also replay seed scripts and needs an interactive
  // answer; drop the schema directly so the test run starts from nothing.
  const drop = spawnSync(
    process.execPath,
    [
      prismaBin,
      "db",
      "execute",
      "--stdin",
      "--schema",
      "prisma/schema.prisma",
    ],
    {
      cwd: projectRoot,
      input: `DROP SCHEMA IF EXISTS "${schema}" CASCADE;`,
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: testUrl },
    }
  );
  if (drop.status !== 0) {
    process.stderr.write(drop.stderr ?? "");
    console.error("[test-db] Failed to drop the test schema.");
    process.exit(drop.status ?? 1);
  }
  console.log(`[test-db] dropped schema "${schema}"`);
}

const result = run(["migrate", "deploy"]);
if (result.status !== 0) {
  console.error(`[test-db] prisma migrate deploy failed against schema "${schema}".`);
  process.exit(result.status ?? 1);
}

console.log(`[test-db] migrations applied to schema "${schema}".`);
