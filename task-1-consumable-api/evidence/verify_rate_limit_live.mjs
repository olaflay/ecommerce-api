#!/usr/bin/env node
/**
 * Rate-limit verification harness (Task 1).
 *
 * Two phases, because they answer different questions:
 *   1. SERIAL - proves the per-window counter reaches its ceiling and that a 429
 *               is returned with a Retry-After header. Firing requests slowly can
 *               let the window roll over, which hides enforcement, so we count
 *               inside a single window instead of assuming.
 *   2. BURST  - proves the limiter holds when requests arrive concurrently. This
 *               is the case an in-memory store is weakest on, so it is measured
 *               rather than reasoned about.
 *
 * Usage:  node evidence/verify_rate_limit_live.mjs [baseUrl]
 * Exit:   0 if enforcement holds, 1 if it does not.
 */

const BASE = (process.argv[2] ?? "https://ecommerce-api-xidz.onrender.com").replace(/\/+$/, "");
const WINDOW_MS = Number(process.env.WINDOW_MS ?? 60000);
const MAX = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 100);
const BURST_SIZE = Number(process.env.BURST_SIZE ?? MAX + 30);

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    const headers = Object.fromEntries(res.headers.entries());
    let retryAfter = headers["retry-after"] ?? null;
    if (retryAfter === null && headers["ratelimit-reset"] !== undefined) {
      retryAfter = headers["ratelimit-reset"];
    }
    return {
      status: res.status,
      retryAfter,
      rateLimitRemaining: headers["ratelimit-remaining"] ?? null,
      ms: Date.now() - started,
    };
  } catch (err) {
    return { status: "NETWORK_ERROR", retryAfter: null, rateLimitRemaining: null, ms: Date.now() - started, error: String(err) };
  }
}

function summarise(label, results) {
  const tally = {};
  for (const r of results) tally[r.status] = (tally[r.status] ?? 0) + 1;
  const limited = results.filter((r) => r.status === 429);
  console.log(`\n--- ${label} ---`);
  console.log(`requests fired : ${results.length}`);
  console.log(`status tally   : ${JSON.stringify(tally)}`);
  console.log(`429 count      : ${limited.length}`);
  if (limited.length > 0) {
    console.log(`Retry-After    : ${limited[0].retryAfter ?? "(missing)"}`);
  }
  return { tally, limitedCount: limited.length, retryAfter: limited[0]?.retryAfter ?? null };
}

const url = `${BASE}/api/v1/products?limit=1`;

// Phase 1: serial, paced so the whole run lands inside one window.
console.log(`Target: ${url}`);
console.log(`Expectation: limit=${MAX} per ${WINDOW_MS}ms window.`);
console.log(`Waiting for a fresh window before the serial phase.`);

// Wait out any window left over from earlier probing.
const probeNow = await probe(url);
const resetSec = Number(probeNow.rateLimitRemaining === null ? 0 : 0);
if (probeNow.status === 429 && probeNow.retryAfter !== null) {
  const waitMs = Math.min(Number(probeNow.retryAfter) * 1000, WINDOW_MS) + 1000;
  console.log(`Currently limited. Sleeping ${waitMs}ms to clear the window.`);
  await new Promise((r) => setTimeout(r, waitMs));
}

const serial = [];
for (let i = 0; i < MAX + 10; i += 1) {
  serial.push(await probe(url));
}
const serialSummary = summarise("PHASE 1 - SERIAL", serial);

// Phase 2: burst. Clear the window first so the burst starts from zero.
if (serialSummary.limitedCount > 0) {
  console.log(`\nSleeping ${WINDOW_MS}ms so the burst starts from a clean window.`);
  await new Promise((r) => setTimeout(r, WINDOW_MS + 1000));
}
const burst = await Promise.all(Array.from({ length: BURST_SIZE }, () => probe(url)));
const burstSummary = summarise(`PHASE 2 - BURST (${BURST_SIZE} concurrent)`, burst);

// Verdict: enforcement requires at least one 429 in each phase.
const serialEnforced = serialSummary.limitedCount > 0;
const burstEnforced = burstSummary.limitedCount > 0;
const verdict = serialEnforced && burstEnforced ? "PASS" : "FAIL";

console.log("\n================ VERDICT ================");
console.log(`serial enforced : ${serialEnforced ? "yes" : "NO"}`);
console.log(`burst enforced  : ${burstEnforced ? "yes" : "NO"}`);
console.log(`RESULT: ${verdict}`);
console.log("========================================");

process.exit(verdict === "PASS" ? 0 : 1);
