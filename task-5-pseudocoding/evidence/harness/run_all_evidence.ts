/**
 * Evidence orchestrator.
 *
 * Runs every Task 5 script for real and writes its unmodified output to
 * evidence/*.log. Nothing here fabricates a result: each entry's log is exactly
 * what the child process printed, and the orchestrator's own exit code is
 * non-zero if any child failed.
 *
 * PREREQUISITE: the Part A harnesses import the real task-1-consumable-api
 * modules, so the repository root dependency tree must be installed
 * (`npm install` at the repository root, or `npm ci` using the root
 * package-lock.json). Part B and Part C scripts do NOT need it.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TASK5 = resolve(HERE, "../..");
const REPO = resolve(TASK5, "..");
const LOG_DIR = resolve(TASK5, "evidence");
const TSX = resolve(TASK5, "node_modules/tsx/dist/cli.mjs");

type Step = { log: string; script: string; needsRepoDeps: boolean; title: string };

const steps: Step[] = [
  { log: "partb_traces.log", script: "part-b/test_traces.ts", needsRepoDeps: false, title: "Part B hand traces vs manual execution" },
  { log: "partc_compare.log", script: "part-c/compare_implementations.ts", needsRepoDeps: false, title: "Part C 10-input comparative suite" },
  { log: "probe_divergence.log", script: "probe_divergence.ts", needsRepoDeps: false, title: "Hostile-input divergence probe" },
  { log: "partA1_create_order.log", script: "evidence/harness/partA1_create_order.ts", needsRepoDeps: true, title: "Part A1 createOrder, real HTTP + real Postgres" },
  { log: "partA2_total_amount.log", script: "evidence/harness/partA2_total_amount.ts", needsRepoDeps: true, title: "Part A2 server-side total computation" },
  { log: "partA3_error_handler.log", script: "evidence/harness/partA3_error_handler.ts", needsRepoDeps: true, title: "Part A3 centralized errorHandler" },
  { log: "partA456_open_source.log", script: "evidence/harness/partA456_open_source.ts", needsRepoDeps: true, title: "Part A4/5/6 open-source functions" },
  { log: "partA3_coupon_bug.log", script: "evidence/harness/partA3_coupon_bug.ts", needsRepoDeps: true, title: "Part A3 voucher-dilution bug" },
  { log: "citations.log", script: "evidence/harness/verify_citations.ts", needsRepoDeps: true, title: "Part A source citation verification" },
];

mkdirSync(LOG_DIR, { recursive: true });

const summary: Array<{ title: string; log: string; exit: number; skipped: boolean; reason: string }> = [];

console.log("=".repeat(79));
console.log("TASK 5 EVIDENCE CAPTURE");
console.log("=".repeat(79));
console.log(`Started:    ${new Date().toISOString()}`);
console.log(`Repository: ${REPO}`);
console.log(`Logs:       ${LOG_DIR}`);
console.log("=".repeat(79));
console.log("");

for (const s of steps) {
  process.stdout.write(`RUN  ${s.title}  ->  evidence/${s.log}\n`);

  if (s.needsRepoDeps) {
    if (!existsSync(resolve(REPO, "node_modules/@prisma/client"))) {
      const reason = "repository root node_modules is not installed (npm install at the repository root)";
      console.log(`SKIP  ${s.title}: ${reason}`);
      const banner =
        `${"=".repeat(79)}\nSKIPPED — NOT RUN\n${"=".repeat(79)}\n` +
        `Reason: ${reason}\n` +
        `This log records NO result. Do not read an absence of failures here as a pass.\n`;
      writeFileSync(resolve(LOG_DIR, s.log), banner, "utf8");
      summary.push({ title: s.title, log: s.log, exit: -1, skipped: true, reason });
      continue;
    }
  }

  const started = Date.now();
  let out = "";
  let code = 0;
  try {
    out = execFileSync(process.execPath, [TSX, resolve(TASK5, s.script)], {
      cwd: TASK5,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e: any) {
    out = (e.stdout ?? "") + (e.stderr ?? "");
    code = typeof e.status === "number" ? e.status : 1;
  }
  const header =
    `${"=".repeat(79)}\n` +
    `TASK 5 EVIDENCE LOG\n${"=".repeat(79)}\n` +
    `Step:        ${s.title}\n` +
    `Script:      ${s.script}\n` +
    `Captured:    ${new Date().toISOString()}\n` +
    `Node:        ${process.version}\n` +
    `Duration:    ${((Date.now() - started) / 1000).toFixed(1)}s\n` +
    `Exit code:   ${code}\n` +
    `${"=".repeat(79)}\n\n` +
    `--- BEGIN UNMODIFIED SCRIPT OUTPUT ---\n\n`;
  const footer = `\n\n--- END UNMODIFIED SCRIPT OUTPUT ---\n`;
  writeFileSync(resolve(LOG_DIR, s.log), header + out + footer, "utf8");

  console.log(`  exit code ${code}, ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
  summary.push({ title: s.title, log: s.log, exit: code, skipped: false, reason: "" });
}

console.log("=".repeat(79));
console.log("EVIDENCE CAPTURE SUMMARY");
console.log("=".repeat(79));
for (const r of summary) {
  const verdict = r.skipped ? "SKIPPED" : r.exit === 0 ? "PASS" : `FAIL (exit ${r.exit})`;
  console.log(`  ${verdict.padEnd(16)} ${r.log.padEnd(30)} ${r.title}`);
  if (r.reason) console.log(`  ${"".padEnd(16)} reason: ${r.reason}`);
}
console.log("=".repeat(79));

const failed = summary.filter((r) => !r.skipped && r.exit !== 0);
const skipped = summary.filter((r) => r.skipped);
console.log(
  `${summary.length - failed.length - skipped.length}/${summary.length} steps produced a passing log` +
    (skipped.length ? `, ${skipped.length} skipped for a missing prerequisite` : "") +
    (failed.length ? `, ${failed.length} FAILED` : "")
);
console.log("=".repeat(79));

if (failed.length) {
  console.error(`RESULT: ${failed.length} step(s) FAILED — exiting with code 1`);
  process.exit(1);
}
if (skipped.length) {
  console.log("RESULT: PARTIAL — some steps were skipped and produced no result. Exiting with code 3.");
  process.exit(3);
}
console.log("RESULT: PASS — exiting with code 0");
