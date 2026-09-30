/**
 * Boots the real API, exercises the public contract over HTTP, then shuts it
 * down. Run instead of hand-typing curl commands, so the transcript in
 * evidence/api-smoke.txt is reproducible.
 *
 * The server is started as a child process on a scratch port and every request
 * goes over a real socket, so what is recorded is what a client would see.
 *
 * It runs against the SAME isolated schema as the test suite (task2_test), not
 * the shared `public` schema. The API enqueues real rows, and leaving smoke
 * test jobs in a database shared with other tasks would be litter.
 *
 * Run: npx tsx evidence/probe-api-smoke.ts
 */
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = process.env.SMOKE_PORT ?? "4010";
const BASE = `http://127.0.0.1:${PORT}`;
const SCHEMA = process.env.TEST_DB_SCHEMA ?? "task2_test";

/** Same rule as vitest.config.ts: prefer an explicit test URL, else reuse DATABASE_URL. */
function isolatedDatabaseUrl(): string {
  const raw = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("Set TEST_DATABASE_URL or DATABASE_URL in .env (see .env.example)");
  }
  const url = new URL(raw);
  url.searchParams.set("schema", SCHEMA);
  return url.toString();
}

/**
 * The target is a Render free-tier Postgres: it suspends after a period of
 * inactivity and the first connection attempt fails with P1001 until it wakes.
 * Retry until the probe can actually run, else the evidence would just record
 * a sleep-related failure.
 */
async function connectWithRetry(prisma: PrismaClient, attempts = 15): Promise<void> {
  for (let i = 1; i <= attempts; i += 1) {
    try {
      await prisma.$queryRaw`SELECT 1 AS ok`;
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`[smoke] database not awake yet (attempt ${i}/${attempts}), retrying...`);
      await sleep(5000);
    }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface CallResult {
  status: number;
  body: unknown;
  headers: Headers;
}

async function call(
  method: string,
  urlPath: string,
  payload?: unknown,
  headers: Record<string, string> = {}
): Promise<CallResult> {
  const response = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // non-JSON response (e.g. the dashboard HTML) is kept as text
  }
  return { status: response.status, body, headers: response.headers };
}

function show(label: string, result: CallResult) {
  const rendered =
    typeof result.body === "string"
      ? `${result.body.length} bytes of text/HTML`
      : JSON.stringify(result.body);
  console.log(`  ${label}\n    -> HTTP ${result.status} ${rendered}`);
}

/** The CORS rows below use plain node:http; see corsRow() for why fetch is unusable. */

/**
 * Plain-HTTP request used for the CORS checks. Node's fetch() is unusable for
 * this: the Fetch spec lists `Origin` and `Access-Control-Request-Method` as
 * forbidden request headers, so undici strips them before they reach the wire.
 * node:http does not filter headers, so what it sends is what a real browser
 * sends.
 */
async function corsRow(
  label: string,
  method: string,
  pathname: string,
  origin: string,
  extraHeaders: Record<string, string> = {}
): Promise<void> {
  return new Promise<void>((resolve) => {
    const req = http.request(
      {
        host: "127.0.0.1",
        port: Number(PORT),
        path: pathname,
        method,
        headers: { Origin: origin, Connection: "close", ...extraHeaders },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          console.log(
            `  ${label}\n` +
              `    -> HTTP ${res.statusCode} access-control-allow-origin=${res.headers["access-control-allow-origin"] ?? "<absent>"}`
          );
          resolve();
        });
      }
    );
    req.on("error", (err) => {
      console.log(`  ${label}\n    -> ERROR ${err.message}`);
      resolve();
    });
    req.setTimeout(15000, () => {
      console.log(`  ${label}\n    -> TIMEOUT`);
      req.destroy();
      resolve();
    });
    req.end();
  });
}

async function main() {
  const databaseUrl = isolatedDatabaseUrl();
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  await connectWithRetry(prisma);
  await prisma.job.deleteMany({});

  const child = spawn(
    process.execPath,
    [path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs"),
     path.join(projectRoot, "src", "api", "server.ts")],
    {
      cwd: projectRoot,
      env: { ...process.env, PORT, NODE_ENV: "development", DATABASE_URL: databaseUrl },
      stdio: ["ignore", "pipe", "pipe"],
    }
  );
  const serverLog: string[] = [];
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => serverLog.push(chunk));
  child.stderr.on("data", (chunk: string) => serverLog.push(chunk));

  try {
    // Wait for the port to accept connections. A remote free-tier database can
    // take a few seconds to wake on the first query.
    let up = false;
    for (let i = 0; i < 60 && !up; i += 1) {
      try {
        const probe = await fetch(`${BASE}/healthz`);
        if (probe.ok) {
          up = true;
          break;
        }
      } catch {
        await sleep(1000);
      }
    }
    if (!up) {
      throw new Error(`API did not become ready on ${BASE}\n${serverLog.join("")}`);
    }

    const runTag = `smoke-${Date.now()}`;

    console.log(`Target schema: ${SCHEMA} (isolated; public.Job is not touched)`);
    console.log("API contract over real HTTP:");
    show("GET /healthz", await call("GET", "/healthz"));
    show("GET /  (dashboard)", await call("GET", "/"));
    show("GET /api/metrics", await call("GET", "/api/metrics"));

    const accepted = await call("POST", "/api/jobs", {
      type: "SLOW_TEST_JOB",
      payload: { sleepMs: 250 },
      idempotencyKey: `${runTag}-1`,
    });
    show("POST /api/jobs (valid)", accepted);

    const jobId = (accepted.body as { data?: { id?: string } })?.data?.id;
    if (!jobId) throw new Error("POST /api/jobs did not return a job id");

    const replay = await call("POST", "/api/jobs", {
      type: "SLOW_TEST_JOB",
      payload: { sleepMs: 250 },
      idempotencyKey: `${runTag}-1`,
    });
    show("POST /api/jobs (same idempotency key)", replay);
    const replayId = (replay.body as { data?: { id?: string } })?.data?.id;
    console.log(
      `    same id returned: ${jobId === replayId} (${jobId} vs ${replayId})`
    );

    show("POST /api/jobs (unknown type)", await call("POST", "/api/jobs", {
      type: "NOT_A_REAL_TYPE",
      payload: {},
      idempotencyKey: `${runTag}-2`,
    }));
    show("POST /api/jobs (malformed id path)", await call("GET", "/api/jobs/not-a-uuid"));
    show("GET /api/jobs/:id (valid)", await call("GET", `/api/jobs/${jobId}`));
    show("GET /api/dead-letter", await call("GET", "/api/dead-letter?limit=5"));
    show("GET /nope (unknown route)", await call("GET", "/nope"));
    await corsRow(
      "GET /healthz with disallowed Origin (https://evil.example)",
      "GET",
      "/healthz",
      "https://evil.example"
    );
    await corsRow(
      "GET /healthz with allowed Origin (http://localhost:5173)",
      "GET",
      "/healthz",
      "http://localhost:5173"
    );
    // Browsers preflight a JSON POST, so the CORS behaviour on OPTIONS matters.
    await corsRow(
      "OPTIONS preflight, disallowed Origin (with ACRM: POST)",
      "OPTIONS",
      "/api/jobs",
      "https://evil.example",
      { "Access-Control-Request-Method": "POST" }
    );
    await corsRow(
      "OPTIONS preflight, allowed Origin (with ACRM: POST)",
      "OPTIONS",
      "/api/jobs",
      "http://localhost:5173",
      { "Access-Control-Request-Method": "POST" }
    );
  } finally {
    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("exit", resolve));
    // Leave the isolated schema as it was found.
    await prisma.job.deleteMany({});
    await prisma.$disconnect();
  }

  console.log("\nServer log:");
  console.log(serverLog.join("").trimEnd());
}

main().catch((err) => {
  console.error(`[smoke] FAILED: ${err?.message ?? String(err)}`);
  process.exitCode = 1;
});
