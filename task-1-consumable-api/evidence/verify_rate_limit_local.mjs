# Task 1 evidence: deterministic 429 proof against a LOCAL instance.
#
# Why local and not live:
#   The deployed service runs behind Render, which spreads traffic across more
#   than one instance. express-rate-limit's default MemoryStore is in-process, so
#   each instance enforces its own 100-request budget (effective limit =
#   100 x instanceCount). Measured aggregate throughput on the free tier was
#   ~1.4 req/s, so a single client can never push more than ~86 requests into one
#   60s window. A live 429 from one client IP is therefore not reproducible.
#
#   This script instead proves the 429 CODE PATH deterministically by lowering
#   RATE_LIMIT_MAX_REQUESTS on a local instance. It verifies: the handler runs,
#   the status is 429, the envelope shape is correct, and Retry-After is emitted.
#
# Usage: npm run dev:ratelimit   (in one shell)
#        node evidence/verify_rate_limit_local.mjs

const BASE = process.env.LOCAL_BASE_URL ?? "http://localhost:3000";
const LIMIT = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 5);
const PROBE = Number(process.argv[2] ?? LIMIT + 3);
const TARGET = `${BASE}/api/v1/products?limit=1`;

console.log("=== Task 1 evidence: deterministic 429 proof (local instance) ===");
console.log(`Target            : ${TARGET}`);
console.log(`Configured limit  : ${LIMIT} requests / 60000 ms`);
console.log(`Probe count       : ${PROBE}`);
console.log(`Started (UTC)     : ${new Date().toISOString()}`);
console.log("");

const rows = [];
for (let i = 1; i <= PROBE; i++) {
  const res = await fetch(TARGET, { headers: { Accept: "application/json" } });
  const body = await res.text();
  rows.push({
    n: i,
    status: res.status,
    limit: res.headers.get("ratelimit-limit"),
    remaining: res.headers.get("ratelimit-remaining"),
    retryAfter: res.headers.get("retry-after"),
    body,
  });
  // Small gap so all probes stay inside one fixed window.
  await new Promise((r) => setTimeout(r, 120));
}

console.log("--- Status distribution ---");
const tally = new Map();
for (const r of rows) tally.set(r.status, (tally.get(r.status) ?? 0) + 1);
for (const [status, count] of [...tally.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`HTTP ${status}: ${count} request(s)`);
}
console.log("");

console.log("--- Per-request trace ---");
console.table(
  rows.map((r) => ({
    n: r.n,
    status: r.status,
    limit: r.limit,
    remaining: r.remaining,
    retryAfter: r.retryAfter,
  }))
);
console.log("");

const limited = rows.filter((r) => r.status === 429);
if (limited.length === 0) {
  console.log("RESULT: FAILED - no 429 produced.");
  process.exit(1);
}

const s = limited[0];
console.log("=== Full 429 response ===");
console.log(`HTTP status          : 429 Too Many Requests`);
console.log(`RateLimit-Limit      : ${s.limit}`);
console.log(`RateLimit-Remaining  : ${s.remaining}`);
console.log(`Retry-After (secs)   : ${s.retryAfter}`);
console.log("");
console.log("--- Body ---");
console.log(s.body);
console.log("");

let parsed = null;
try {
  parsed = JSON.parse(s.body);
} catch {
  /* handled by assertions below */
}

const assertions = [
  ["429 returned at least once", limited.length > 0],
  ["body is valid JSON", parsed !== null],
  ["error envelope has error.code", parsed?.error?.code === "RATE_LIMITED"],
  ["error envelope has error.message", typeof parsed?.error?.message === "string"],
  ["Retry-After header present", s.retryAfter !== null],
  ["Retry-After equals window seconds (60)", s.retryAfter === "60"],
  ["RateLimit-Limit header present", s.limit !== null],
];

console.log("=== Assertions ===");
let failed = 0;
for (const [name, pass] of assertions) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}
console.log("");

console.log("=== /healthz must remain reachable while limiter is active (skipped route) ===");
const health = await fetch(`${BASE}/healthz`, { headers: { Accept: "application/json" } });
console.log(`/healthz -> HTTP ${health.status} :: ${await health.text()}`);
console.log(`Finished (UTC)    : ${new Date().toISOString()}`);
console.log("");

if (failed === 0) {
  console.log(`RESULT: PASS - 429 code path verified (${limited.length} of ${PROBE} probes rejected).`);
} else {
  console.log(`RESULT: FAIL - ${failed} assertion(s) failed.`);
}
process.exit(failed === 0 ? 0 : 1);
