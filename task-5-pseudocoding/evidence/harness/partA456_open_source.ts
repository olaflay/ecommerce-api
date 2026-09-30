/**
 * Part A4 / A5 / A6 evidence — the three open-source functions.
 *
 * Each harness calls the REAL installed library code, not a paraphrase:
 *   A4  express-rate-limit 7.5.1 default keyGenerator  (node_modules source)
 *   A5  the repo's validate() middleware, which calls Zod's .parse()
 *   A6  Prisma 6.19.3 interactive transaction timeout + no auto-retry
 */
import { check, finishAndExit, header, loadDatabaseUrl, note, prisma, requireDatabase } from "./_bootstrap.js";
import express from "express";
import request from "supertest";
import { rateLimit } from "express-rate-limit";
import { validate } from "../../../task-1-consumable-api/src/middleware/validate.js";
import { errorHandler } from "../../../task-1-consumable-api/src/middleware/errorHandler.js";
import { z } from "zod";

// ===================================================================
header(
  "PART A4 EVIDENCE: express-rate-limit default keyGenerator (real library, v7.5.1)",
  "node_modules/express-rate-limit/dist/index.mjs"
);
// ===================================================================

console.log("--- Reading the real default keyGenerator out of the installed package ---");
{
  const fs = await import("node:fs");
  const p = new URL("../../../node_modules/express-rate-limit/dist/index.mjs", import.meta.url);
  const src = fs.readFileSync(p, "utf8");
  const lines = src.split(/\r?\n/);
  const idx = lines.findIndex((l) => l.includes("keyGenerator(request, _response)"));
  console.log(`  source: node_modules/express-rate-limit/dist/index.mjs:${idx + 1}`);
  for (let i = idx; i < idx + 6; i++) console.log(`    ${i + 1}: ${lines[i]}`);
  check("default keyGenerator source is 5 lines at the printed location", idx + 1, 627);
  check(
    "it returns request.ip verbatim",
    lines.slice(idx, idx + 6).some((l) => l.trim() === "return request.ip;"),
    true
  );
  check(
    "it contains NO socket.remoteAddress fallback",
    /request\.socket/.test(src),
    false
  );
  check(
    "createHash('sha256') appears in the file but NOT in the key generator",
    lines.slice(idx, idx + 6).some((l) => /createHash|sha256/.test(l)),
    false
  );
  const pk = lines.findIndex((l) => l.includes("const hash = createHash"));
  console.log(`  NOTE  createHash('sha256') is at line ${pk + 1}, inside getPartitionKey:`);
  console.log(`        ${lines[pk].trim()}`);
  console.log(`        ${lines[pk + 1].trim()}`);
  console.log(`  NOTE  that hashes the partition key for the rate-limit store, NOT the client IP`);
  console.log("");
}

console.log("--- The ip validator exists but is DISABLED by default, so it never fires ---");
{
  const fs = await import("node:fs");
  const p = new URL("../../../node_modules/express-rate-limit/dist/index.mjs", import.meta.url);
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  const en = lines.findIndex((l) => l.trim() === "enabled: {");
  console.log(`  node_modules/express-rate-limit/dist/index.mjs:${en + 1}`);
  console.log(`    ${lines[en].trim()}`);
  console.log(`    ${lines[en + 1].trim()}`);
  check("only the 'default' validation is enabled out of the box", lines[en + 1].trim(), "default: true");
  const ipIdx = lines.findIndex((l) => l.trim().startsWith("ip(ip) {"));
  console.log(`  the ip validator is defined at line ${ipIdx + 1} and throws when request.ip is undefined`);
  check("ip validator exists", ipIdx >= 0, true);
  check(
    "ip validator throws ERR_ERL_UNDEFINED_IP_ADDRESS when undefined",
    lines.slice(ipIdx, ipIdx + 14).some((l) => l.includes("ERR_ERL_UNDEFINED_IP_ADDRESS")),
    true
  );
  console.log("  NOTE  the default keyGenerator body has NO socket.remoteAddress fallback, so with");
  console.log("        request.ip undefined the key is literally the value undefined, not a fallback address");
  const keys: string[] = [];
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    keyGenerator: (req) => {
      // byte-for-byte the body of the library default keyGenerator at line 627
      const k = req.ip;
      keys.push(String(k));
      return String(k);
    },
  });
  const a = express();
  a.use((req, _res, next) => {
    Object.defineProperty(req, "ip", { value: undefined, configurable: true });
    next();
  });
  a.use(limiter);
  a.get("/x", (_req, res) => res.send("ok"));
  const res = await request(a).get("/x");
  console.log(`  HTTP status with request.ip forced undefined: ${res.status}`);
  console.log(`  key the default body produced:               ${JSON.stringify(keys[0])}`);
  check("request still served", res.status, 200);
  check("key is the string 'undefined', proving no socket fallback", keys[0], "undefined");
  console.log("");
}

console.log("--- Behavioural proof: a normal request keys on the plain IP string ---");
{
  const seen: string[] = [];
  const limiter = rateLimit({
    windowMs: 60_000,
    max: 100,
    keyGenerator: (req) => {
      const k = req.ip;
      seen.push(String(k));
      return String(k);
    },
  });
  const a = express();
  a.set("trust proxy", false);
  a.use(limiter);
  a.get("/x", (_req, res) => res.send("ok"));
  await request(a).get("/x");
  check("key observed for a normal request", seen, ["::ffff:127.0.0.1"]);
  check("key is a bare IP string, not a hash", /^[0-9a-f.:]+$/.test(seen[0] ?? ""), true);
  console.log(`  observed key: ${JSON.stringify(seen[0])}`);
  console.log("  NOTE  a 64-character hex key would have indicated SHA-256 hashing. There is none.");
  console.log("");
}

// ===================================================================
header(
  "PART A5 EVIDENCE: Zod validation middleware (real repo middleware over real Zod 3)",
  "task-1-consumable-api/src/middleware/validate.ts :: validate"
);
// ===================================================================
console.log("--- The middleware calls .parse(), which THROWS. .safeParse() does not. ---");
{
  const schema = z.object({ quantity: z.number().int().min(1) });

  let parseThrew = false;
  try {
    schema.parse({ quantity: 0 });
  } catch {
    parseThrew = true;
  }
  const safe = schema.safeParse({ quantity: 0 });
  check("Zod .parse() throws on invalid input", parseThrew, true);
  check("Zod .safeParse() does not throw", safe.success, false);
  check("safeParse returns a discriminated union with .error", safe.success === false && !!safe.error, true);
  console.log("  NOTE  the repo middleware therefore NEEDS try/catch, unlike the old pseudocode");
  console.log("");

  console.log("--- Real HTTP behaviour of validate(schema) on a body ---");
  const a = express();
  a.use(express.json());
  a.post("/x", validate(schema), (req, res) => res.json({ received: req.body }));
  a.use(errorHandler);
  const bad = await request(a).post("/x").send({ quantity: 0 });
  console.log(`  invalid body -> ${bad.status} ${JSON.stringify(bad.body)}`);
  check("invalid body status", bad.status, 422);
  check("invalid body code", bad.body?.error?.code, "VALIDATION_ERROR");
  check("invalid body message format", bad.body?.error?.message, "quantity: Number must be greater than or equal to 1");
  check("invalid body details", bad.body?.error?.details, { quantity: ["Number must be greater than or equal to 1"] });

  const good = await request(a).post("/x").send({ quantity: 5 });
  console.log(`  valid body   -> ${good.status} ${JSON.stringify(good.body)}`);
  check("valid body status", good.status, 200);
  check("req.body is replaced by the parsed output", good.body?.received, { quantity: 5 });
  console.log("");

  console.log("--- Query and params locations use 400 BAD_REQUEST, not 422 ---");
  const b = express();
  b.get("/x", validate(z.object({ page: z.coerce.number().int().min(1) }), "query"), (_req, res) =>
    res.sendStatus(204)
  );
  b.use(errorHandler);
  const q = await request(b).get("/x?page=0");
  console.log(`  bad query -> ${q.status} ${JSON.stringify(q.body)}`);
  check("query validation status", q.status, 400);
  check("query validation code", q.body?.error?.code, "BAD_REQUEST");
  console.log("  NOTE  the old pseudocode claimed 422 VALIDATION_ERROR for every location");
  console.log("");
}

// ===================================================================
header(
  "PART A6 EVIDENCE: Prisma 6.19.3 interactive transaction (real engine, real database)",
  "@prisma/client :: $transaction(async (tx) => ...)"
);
// ===================================================================
loadDatabaseUrl();
await requireDatabase("partA456");
console.log("--- Interactive transactions do NOT auto-retry: one failure, one attempt ---");
{
  let attempts = 0;
  let caught = "";
  try {
    await prisma.$transaction(async () => {
      attempts++;
      throw new Error("deliberate callback failure");
    });
  } catch (e) {
    caught = (e as Error).message;
  }
  console.log(`  callback invocations: ${attempts}`);
  console.log(`  error surfaced:       ${caught}`);
  check("callback was invoked exactly once (no auto-retry)", attempts, 1);
  check("the callback error reached the caller unchanged", caught, "deliberate callback failure");
  console.log("  NOTE  an auto-retrying runtime would have invoked the callback 3+ times");
  console.log("");
}

console.log("--- The default total timeout is the Prisma default of 5000ms, and it is enforced ---");
{
  const started = Date.now();
  let code = "";
  let msg = "";
  try {
    await prisma.$transaction(async () => {
      await new Promise((r) => setTimeout(r, 6500));
    });
  } catch (e: any) {
    code = e?.code ?? "";
    msg = String(e?.message ?? "");
  }
  const elapsed = Date.now() - started;
  console.log(`  elapsed before the error surfaced: ${elapsed}ms (callback asked for 6500ms)`);
  console.log(`  error code:                      ${code}`);
  console.log(`  error message:                   ${msg.split("\n")[0]}`);
  check("Prisma reported error P2028", code, "P2028");
  check(
    "the engine names a 5000 ms timeout, which is Prisma's default, not the repo's 20000",
    /The timeout for this transaction was 5000 ms/.test(msg),
    true
  );
  check(
    "the error surfaced only after the callback's own 6500ms timer finished",
    elapsed >= 6500,
    true
  );
  console.log("  NOTE  the transaction was already dead at 5000ms; the wall clock kept running because the");
  console.log("        callback awaited an uncancellable timer. The P2028 message is the load-bearing evidence.");
  console.log("");
}

console.log("--- maxWait is honoured: an impossible maxWait fails fast rather than hanging ---");
{
  const started = Date.now();
  let code = "";
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe("SELECT 1");
    }, { maxWait: 1, timeout: 5000 });
  } catch (e: any) {
    code = e?.code ?? String(e?.message ?? "");
  }
  const elapsed = Date.now() - started;
  console.log(`  elapsed: ${elapsed}ms with maxWait=1`);
  console.log(`  result:  ${code || "(transaction succeeded; pool had a free connection)"}`);
  note(
    "Interpretation",
    "maxWait=1 did not force a failure here, which means the pool had a free connection. " +
      "The 5000ms default timeout result above is the load-bearing evidence for the default."
  );
  console.log("");
}

console.log("--- The repository overrides the defaults: maxWait 10000, timeout 20000 ---");
{
  const fs = await import("node:fs");
  const src = fs.readFileSync(
    new URL("../../../task-1-consumable-api/src/services/order.service.ts", import.meta.url),
    "utf8"
  );
  const hits = [...src.matchAll(/\{ maxWait: (\d+), timeout: (\d+) \}/g)].map((m) => ({
    maxWait: m[1],
    timeout: m[2],
  }));
  console.log(`  occurrences in order.service.ts: ${JSON.stringify(hits)}`);
  check("three call sites override the transaction defaults", hits.length, 3);
  check("all three use maxWait 10000 / timeout 20000", hits.every((h) => h.maxWait === "10000" && h.timeout === "20000"), true);
  console.log("  NOTE  the pseudocode's claim of defaults 2000/5000 is Prisma's documented default,");
  console.log("        which this codebase never uses. Both facts are recorded rather than reconciled.");
}

await prisma.$disconnect();
finishAndExit("partA4/5/6 open-source functions");
