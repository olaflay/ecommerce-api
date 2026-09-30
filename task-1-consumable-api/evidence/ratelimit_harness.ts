/**
 * Evidence harness: boots the real Express app WITHOUT connecting to Postgres.
 *
 * `src/server.ts` calls `prisma.$connect()` and `process.exit(1)` on failure,
 * which makes the rate limiter untestable on a machine with no reachable
 * database. The rate limiter is mounted before every route, so proving the 429
 * path does not require a working database.
 *
 * This file is test scaffolding under evidence/. It is not part of the API.
 *
 * Usage: npx tsx evidence/ratelimit_harness.ts
 */

import { app } from "../src/app.js";
import { config } from "../src/config/index.js";

app.listen(config.PORT, () => {
  console.log(
    `[harness] app listening on port ${config.PORT} (no DB connection) | rate limit = ${config.RATE_LIMIT_MAX_REQUESTS} per ${config.RATE_LIMIT_WINDOW_MS}ms`
  );
});
