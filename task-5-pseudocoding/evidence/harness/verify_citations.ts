/**
 * Citation verifier.
 *
 * Part A claims "Real Code Execution Result: <file> line <N>: <assertion>". Those
 * citations are what a defence session checks first, and an audit found five of
 * them pointing at the wrong line — plus one citing a test case that does not
 * exist at all.
 *
 * This script does not trust the markdown. It re-reads the cited file at the
 * cited line, prints what is actually there, and FAILS if the claimed assertion
 * is not present. Run it after editing any Part A file.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK5 = resolve(HERE, "../..");
const TASK1 = resolve(TASK5, "../task-1-consumable-api");

const line = "=".repeat(79);
console.log(line);
console.log("CITATION VERIFIER: every Part A source citation re-checked against the real file");
console.log(line);
console.log(`Verified at: ${new Date().toISOString()}`);
console.log(`Repo root:   ${TASK1}`);
console.log(line);
console.log("");

type Citation = {
  part: string;
  file: string;
  lines: number[];
  mustContain: string[];
  note?: string;
};

const citations: Citation[] = [
  {
    part: "part-a/01 trace 1 (201 Created + stock decremented)",
    file: "tests/orders.test.ts",
    lines: [47, 50, 52, 58],
    mustContain: ["201", "totalAmount", "unitPrice", "stockQuantity"],
    note: "the old citation said 'line 14', which is a beforeAll setup line with no assertion",
  },
  {
    part: "part-a/01 trace 2 (409 Conflict, insufficient stock)",
    file: "tests/orders.test.ts",
    lines: [136, 137, 138],
    mustContain: ["409", "CONFLICT", "Insufficient stock"],
    note: "the old citation said 'line 82', which is a prisma lookup inside a different test",
  },
  {
    part: "part-a/01 trace 3 (404 Customer not found)",
    file: "tests/orders.test.ts",
    lines: [114, 115],
    mustContain: ["404", "NOT_FOUND"],
    note: "the old citation said 'line 56', which is a prisma findUnique",
  },
  {
    part: "part-a/01 structural: the batched FOR UPDATE lock query",
    file: "src/services/order.service.ts",
    lines: [63],
    mustContain: ["FOR UPDATE", "ANY("],
    note: "proves the real code takes ONE batched lock, not a per-product loop",
  },
  {
    part: "part-a/01 structural: currency write",
    file: "src/services/order.service.ts",
    lines: [110],
    mustContain: ['currency: "NGN"'],
    note: "the old pseudocode omitted this write entirely",
  },
  {
    part: "part-a/01 structural: customer lookup is OUTSIDE the transaction",
    file: "src/services/order.service.ts",
    lines: [38, 58],
    mustContain: ["prisma.customer.findUnique", "prisma.$transaction"],
    note: "line 38 is the customer lookup, line 58 opens the transaction, so the lookup precedes it",
  },
  {
    part: "part-a/02 total computation region",
    file: "src/services/order.service.ts",
    lines: [75, 86, 90],
    mustContain: ["let totalAmount = 0", "totalAmount +=", "unitPrice"],
    note: "proves the money region exists at all, contradicting the old 'calculateOrderTotals' fiction",
  },
  {
    part: "part-a/03 500 fallback emits INTERNAL_ERROR, not INTERNAL_SERVER_ERROR",
    file: "src/middleware/errorHandler.ts",
    lines: [109, 110],
    mustContain: ["INTERNAL_ERROR", "Internal server error"],
    note: "the old pseudocode specified INTERNAL_SERVER_ERROR and still scored Match: YES",
  },
  {
    part: "part-a/03 500 assertion lives here, not at line 49",
    file: "tests/app.test.ts",
    lines: [55, 57, 58, 59],
    mustContain: ["INTERNAL_ERROR", "Internal server error"],
    note: "the old citation said 'line 49', which is `throw new Error(...)` inside the test route",
  },
  {
    part: "part-a/03 the real repo 422 is an EMPTY items array, not a missing customerId",
    file: "tests/orders.test.ts",
    lines: [87, 90, 91, 92],
    mustContain: ["422", "VALIDATION_ERROR", "items: []"],
    note: "the old citation 'line 68' is inside the duplicate-merge payload. NO repo test asserts a 422 for a missing customerId; that behaviour is proven instead by evidence/harness/partA3_error_handler.ts against the real middleware, and is labelled as such in part-a/03",
  },
  {
    part: "part-a/03 404 route-not-found envelope",
    file: "tests/app.test.ts",
    lines: [24, 25, 26, 27],
    mustContain: ["NOT_FOUND", "Route not found"],
    note: "supports the AppError branch of the error handler",
  },
  {
    part: "part-a/03 validate() builds 'field: message' and uses 422 for body",
    file: "src/middleware/validate.ts",
    lines: [10, 17, 21, 23],
    mustContain: ["schema.parse", "path.join", "ValidationError", "BadRequestError"],
    note: "proves .parse() is used (it throws) and that query/params get 400, not 422",
  },
  {
    part: "part-a/04 default keyGenerator returns request.ip with no socket fallback",
    file: "../node_modules/express-rate-limit/dist/index.mjs",
    lines: [627, 628, 631],
    mustContain: ["keyGenerator(request, _response)", "return request.ip;"],
    note: "the old file quoted a one-liner that does not exist in v7.5.1",
  },
  {
    part: "part-a/04 sha256 is only used for the store partition key, never the IP",
    file: "../node_modules/express-rate-limit/dist/index.mjs",
    lines: [19, 20, 21, 22],
    mustContain: ["getPartitionKey", "createHash", "sha256", "digest"],
    note: "refutes the hallucinated IP hashing more precisely than the old citation did",
  },
  {
    part: "part-a/01 duplicate-merge assertions: one line item, summed quantity",
    file: "tests/orders.test.ts",
    lines: [77, 78, 79, 84],
    mustContain: ["items.length).toBe(1)", "quantity).toBe(3)", "price * 3", "initialStock - 3"],
    note: "proves the merge writes ONE OrderItem, which the old step-12 loop would have contradicted",
  },
  {
    part: "part-a/01 status pending assertion",
    file: "tests/orders.test.ts",
    lines: [49],
    mustContain: ['status).toBe("pending")'],
    note: "the old pseudocode asserted the status but cited no line for it",
  },
  {
    part: "part-a/01 refutes old 'line 14 is the 201 assertion'",
    file: "tests/orders.test.ts",
    lines: [14, 15, 17],
    mustContain: ["findMany", "stockQuantity: { gt: 10 }", "select:"],
    note: "line 14 is beforeAll setup, which contains no status assertion at all",
  },
  {
    part: "part-a/01 the out-of-stock fixture is genuinely stockQuantity 0",
    file: "tests/orders.test.ts",
    lines: [19, 20],
    mustContain: ["findFirst", "stockQuantity: 0"],
    note: "the 409 hand trace depends on this fixture really being at zero",
  },
  {
    part: "part-a/01 no sort exists: productIds comes straight from merged order",
    file: "src/services/order.service.ts",
    lines: [55],
    mustContain: ["const productIds = mergedItems.map"],
    note: "refutes the old 'SORT unique productIds to guarantee deadlock-free locking' step; note there is no .sort( on this line",
  },
  {
    part: "part-a/01 customer-not-found error text",
    file: "src/services/order.service.ts",
    lines: [42],
    mustContain: ['NotFoundError("Customer not found")'],
  },
  {
    part: "part-a/01 product-not-found error text embeds the id",
    file: "src/services/order.service.ts",
    lines: [70],
    mustContain: ["Product not found:", "item.productId"],
  },
  {
    part: "part-a/01 stock-conflict error text embeds name and both quantities",
    file: "src/services/order.service.ts",
    lines: [82],
    mustContain: ["Insufficient stock for product", "Requested:", "Available:"],
    note: "refutes the old doc's truncated message 'Insufficient stock for product'",
  },
  {
    part: "part-a/01 atomic decrement, not read-modify-write",
    file: "src/services/order.service.ts",
    lines: [99],
    mustContain: ["stockQuantity: { decrement: item.quantity }"],
  },
  {
    part: "part-a/01 items are written by a NESTED create on order.create, not a separate loop",
    file: "src/services/order.service.ts",
    lines: [111, 112, 113],
    mustContain: ["items:", "create: orderLines"],
    note: "refutes the old step 12 'FOR EACH lineItem ... WRITE OrderItem record'",
  },
  {
    part: "part-a/02 the schema has an integer totalAmount and an explicit currency, and NO tax or subtotal column",
    file: "prisma/schema.prisma",
    lines: [],
    mustContain: ["totalAmount    Int", 'currency    String       @default("NGN")', "unitPrice Int"],
    note: "matches are whole-file, not line-based, because these are the claims that no tax/discount/subtotal column exists anywhere in the Order or OrderItem models",
  },
  {
    part: "part-a/06 the repo overrides the transaction defaults at all three call sites",
    file: "src/services/order.service.ts",
    lines: [137, 193, 237],
    mustContain: ["maxWait: 10000", "timeout: 20000"],
    note: "the real values are 10000/20000, not Prisma's 2000/5000 default",
  },
];

/**
 * Citations into THIS task's own files. Same rule applies: the Part C docs claim
 * specific line numbers in the AI and manual implementations, and those claims
 * are exactly as falsifiable as the ones above. Two of them were already wrong
 * when this list was written, which is why they are checked mechanically.
 */
const localCitations: Array<Omit<Citation, "file"> & { file: string }> = [
  {
    part: "part-c REVERSE_ENGINEERED: the AI signature is fully typed, refuting 'Any value'",
    file: "part-c/delivery_fee_ai.ts",
    lines: [13, 14, 15, 16, 17],
    mustContain: ["calculateDeliveryFeeAI", "distanceKm: number", "subtotalKobo: number", "vehicleType: string", "isPeakHour: boolean"],
    note: "there is no `any` in this file; the old 'Any value' header was false",
  },
  {
    part: "part-c REVERSE_ENGINEERED: AI guard line numbers (20/24/28)",
    file: "part-c/delivery_fee_ai.ts",
    lines: [20, 24, 28],
    mustContain: ["!isFinite(distanceKm)", "Number.isInteger(subtotalKobo)", "includes(vehicleType)"],
    note: "a previous draft of the doc cited 11/14/17, which are not the guard lines",
  },
  {
    part: "part-c REVERSE_ENGINEERED: AI compute line numbers (47/50/61/64/67)",
    file: "part-c/delivery_fee_ai.ts",
    lines: [47, 50, 61, 64, 67],
    mustContain: ["baseFeeKobo = 50000", "Math.round(distanceKm * 15000)", "rawBaseFee =", "surgeMultiplier =", "finalFeeKobo = Math.round"],
    note: "a previous draft of the doc cited 26/30/42/46/50, which are not these lines",
  },
  {
    part: "part-c REVERSE_ENGINEERED: AI clause order puts `< 0` FIRST, unlike the manual",
    file: "part-c/delivery_fee_ai.ts",
    lines: [20],
    mustContain: ["distanceKm < 0 ||", "typeof", "!isFinite"],
    note: "proves the clause-order difference claimed in the 'Ordering, restated honestly' section",
  },
  {
    part: "part-b manual: the finite guard that was the actual bug (line 51)",
    file: "part-b/delivery_fee_manual.ts",
    lines: [51],
    mustContain: ["typeof distanceKm !== \"number\"", "!Number.isFinite(distanceKm)", "distanceKm < 0"],
    note: "clause order is typeof, isFinite, then <0 — the reverse of the AI's",
  },
  {
    part: "part-b manual: the constants the ambiguity-2 example depends on",
    file: "part-b/delivery_fee_manual.ts",
    lines: [78, 84, 91, 100],
    mustContain: ["baseFeeKobo = 50000", "distanceKm * 15000", "= 1.4", "1.25"],
    note: "proves base 50000, rate 15000, car multiplier 1.4, surge 1.25 as used in the worked example",
  },
];

function readLines(rel: string): string[] {
  const abs = resolve(TASK1, rel);
  return readFileSync(abs, "utf8").split(/\r?\n/);
}

let failures = 0;

function verify(list: Citation[], read: (rel: string) => string[]) {
  for (const c of list) {
    console.log("-".repeat(79));
    console.log(`CITATION: ${c.part}`);
    console.log(`  file: ${c.file}`);
    if (c.note) console.log(`  note: ${c.note}`);
    let lines: string[];
    try {
      lines = read(c.file);
    } catch (e) {
      failures++;
      console.log(`  [FAIL] file could not be read: ${(e as Error).message}`);
      console.log("");
      continue;
    }
    const joined = c.lines.map((n) => lines[n - 1] ?? "").join("\n");
    for (const n of c.lines) {
      console.log(`  ${String(n).padStart(4)} | ${(lines[n - 1] ?? "<PAST END OF FILE>").trim()}`);
    }
    for (const needle of c.mustContain) {
      const ok = joined.includes(needle);
      if (!ok) failures++;
      console.log(`  [${ok ? "PASS" : "FAIL"}] cited lines contain ${JSON.stringify(needle)}`);
    }
    console.log("");
  }
}

verify(citations, readLines);
verify(localCitations, (rel) => readFileSync(resolve(TASK5, rel), "utf8").split(/\r?\n/));

const total = citations.length + localCitations.length;

console.log("=".repeat(79));
console.log(
  failures === 0
    ? `RESULT: PASS — all ${total} citations verified against the real files (${citations.length} in task-1-consumable-api, ${localCitations.length} in this task).`
    : `RESULT: FAIL — ${failures} citation check(s) failed.`
);
console.log("=".repeat(79));
if (failures > 0) process.exit(1);
