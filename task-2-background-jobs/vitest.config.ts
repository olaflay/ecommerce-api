import { defineConfig } from "vitest/config";
import dotenv from "dotenv";

dotenv.config();

/**
 * Tests run against an isolated Postgres schema so a test run never mutates the
 * `public` schema (Task 1's tables plus the dev/demo queue data). The schema
 * name and credentials come from TEST_DATABASE_URL / TEST_DB_SCHEMA, defaulting
 * to DATABASE_URL + `task2_test`. See scripts/test-db.mjs.
 */
const rawUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
const schema = process.env.TEST_DB_SCHEMA || "task2_test";

function testDatabaseUrl(): string {
  if (!rawUrl) {
    throw new Error(
      "No database URL for tests. Set TEST_DATABASE_URL or DATABASE_URL in .env (see .env.example)."
    );
  }
  const url = new URL(rawUrl);
  url.searchParams.set("schema", schema);
  return url.toString();
}

/**
 * Timings used by the suites. Deliberately NOT inherited from `.env`: a developer's
 * production `STUCK_JOB_TIMEOUT_MS=30000` would make a 3s heartbeat assertion
 * observe exactly one heartbeat and pass for the wrong reason. Override a single
 * value while debugging with e.g. T2_TEST_STUCK_JOB_TIMEOUT_MS=6000.
 */
function testTiming(name: string, fallback: string): string {
  return process.env[`T2_TEST_${name}`] ?? fallback;
}

export default defineConfig({
  test: {
    globals: true,
    // Generous ceilings on purpose. The suites drive real workers against a
    // REMOTE Postgres where a single round trip costs ~300-500ms, so 50 jobs
    // through a 5-wide worker legitimately needs a minute. A tight timeout
    // would fail on a slow link, and a failed test that leaves its worker
    // running then corrupts the next test.
    testTimeout: 180000,
    hookTimeout: 120000,
    // The suites spawn real worker child processes and run real timers; running
    // files in parallel would have several workers competing for one queue.
    fileParallelism: false,
    env: {
      DATABASE_URL: testDatabaseUrl(),
      NODE_ENV: "test",
      WORKER_CONCURRENCY: testTiming("WORKER_CONCURRENCY", "5"),
      MAX_ATTEMPTS: testTiming("MAX_ATTEMPTS", "3"),
      // 2000ms base + 0-100ms jitter. The base is deliberately not tiny: the
      // database is remote, so a poll can take ~1s, and a short backoff window
      // would let the suite miss a `failed` state and assert on nothing.
      // A failed attempt is therefore followed by a failed one, then dead.
      BASE_BACKOFF_MS: testTiming("BASE_BACKOFF_MS", "2000"),
      MAX_JITTER_MS: testTiming("MAX_JITTER_MS", "100"),
      // Stuck timeout comfortably longer than the heartbeat interval, and short
      // enough that a killed worker's row becomes sweepable inside a test.
      STUCK_JOB_TIMEOUT_MS: testTiming("STUCK_JOB_TIMEOUT_MS", "3000"),
      HEARTBEAT_INTERVAL_MS: testTiming("HEARTBEAT_INTERVAL_MS", "500"),
      POLL_INTERVAL_MS: testTiming("POLL_INTERVAL_MS", "100"),
      CORS_ALLOWED_ORIGINS: process.env.CORS_ALLOWED_ORIGINS || "http://localhost:5173",
      // Long enough that background sweepers inside a spawned worker never
      // recover a job the test is deliberately inspecting. The suites call
      // sweepStuckJobs() themselves, at a moment they control.
      SWEEP_INTERVAL_MS: testTiming("SWEEP_INTERVAL_MS", "600000"),
    },
  },
});
