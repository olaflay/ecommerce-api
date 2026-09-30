import express, { Request, Response, NextFunction, RequestHandler } from "express";
import cors, { CorsOptions } from "cors";
import { z, ZodError } from "zod";
import { JobStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { config } from "../config/index.js";
import { enqueueJob, retryDeadJob } from "../queue/index.js";
import { JOB_TYPE_ALLOWLIST, isKnownJobType } from "../handlers/index.js";

export const app = express();

/** Client mistake surfaced as a 400 by the centralized error handler. */
class BadRequestError extends Error {
  readonly code: string;

  constructor(message: string, code = "BAD_REQUEST") {
    super(message);
    this.name = "BadRequestError";
    this.code = code;
  }
}

// Behind Render/Railway's reverse proxy; needed for correct client IPs.
app.set("trust proxy", 1);

// CORS allowlist. `cors()` with no options answers every origin, which for a
// service that mutates queue state is an open door. An unset CORS_ALLOWED_ORIGINS
// means "no browser origin is allowed" rather than "all of them are".
const corsOptions: CorsOptions = {
  origin: config.corsAllowedOrigins.length > 0 ? [...config.corsAllowedOrigins] : false,
  credentials: true,
};
app.use(cors(corsOptions));

// Body size ceiling, matching Task 1.
app.use(express.json({ limit: config.bodyLimit }));

/**
 * Express 4 does not catch a rejected promise from a route handler. A thrown
 * error inside an `async` handler becomes an unhandled rejection, the response
 * is never written, and the request hangs until the client times out - the
 * centralized error handler below never runs. `express-async-errors` patches the
 * router globally; this wrapper does it explicitly per handler, with no hidden
 * global monkey-patch and no extra dependency.
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

const paginationSchema = z
  .object({
    limit: z
      .string()
      .regex(/^-?\d+$/, "limit must be a valid integer")
      .optional()
      .transform((v) => (v === undefined || v === "" ? undefined : Number(v))),
    offset: z
      .string()
      .regex(/^-?\d+$/, "offset must be a valid integer")
      .optional()
      .transform((v) => (v === undefined || v === "" ? undefined : Number(v))),
  })
  .superRefine((value, ctx) => {
    if (value.limit !== undefined && value.limit <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["limit"], message: "limit must be greater than zero" });
    }
    if (value.offset !== undefined && value.offset < 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["offset"],
        message: "offset must be greater than or equal to zero",
      });
    }
  });

/** Same clamping contract as Task 1: default 20, max 100, offset >= 0. */
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

function parsePagination(query: Request["query"]): { limit: number; offset: number } {
  if (Array.isArray(query.limit) || Array.isArray(query.offset)) {
    throw new BadRequestError("Multiple limit/offset parameters are not allowed");
  }

  const parsed = paginationSchema.parse(query);
  const limit = parsed.limit === undefined ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, parsed.limit);
  const offset = parsed.offset ?? 0;
  return { limit, offset };
}

const enqueueSchema = z.object({
  // Allowlist of executable job types. A client typo otherwise becomes a
  // well-formed job that fails maxAttempts times and pollutes the DLQ.
  type: z
    .string({ required_error: "type is required", invalid_type_error: "type must be a string" })
    .min(1, "type is required")
    .refine(isKnownJobType, {
      message: `type must be one of: ${JOB_TYPE_ALLOWLIST.join(", ")}`,
    }),
  payload: z.record(z.any()).default({}),
  idempotencyKey: z.string().min(1, "idempotencyKey is required"),
  maxAttempts: z.number().int().min(1).optional(),
});

// 0. Health check
app.get("/healthz", (_req: Request, res: Response) => {
  res.status(200).json({
    status: "ok",
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

// 1. Enqueue Job: Returns 202 Accepted immediately
app.post(
  "/api/jobs",
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = enqueueSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(422).json({
        error: {
          code: "VALIDATION_ERROR",
          message: "Invalid enqueue parameters",
          details: parsed.error.flatten().fieldErrors,
        },
      });
    }

    const result = await enqueueJob(parsed.data);

    return res.status(202).json({
      data: {
        id: result.job.id,
        type: result.job.type,
        status: result.job.status,
        idempotencyKey: result.job.idempotencyKey,
        isDuplicate: result.isDuplicate,
        message: result.isDuplicate
          ? "Existing job returned with matching idempotency key"
          : "Job accepted for background processing",
      },
    });
  })
);

// 2. Job Status Endpoint
app.get(
  "/api/jobs/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST",
          message: `"id" must be a valid UUID`,
        },
      });
    }

    const job = await prisma.job.findUnique({
      where: { id },
      include: { output: true },
    });

    if (!job) {
      return res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: `Job ${id} not found`,
        },
      });
    }

    return res.status(200).json({ data: job });
  })
);

// 3. Dead Letter Queue: List dead jobs
app.get(
  "/api/dead-letter",
  asyncHandler(async (req: Request, res: Response) => {
    const { limit, offset } = parsePagination(req.query);

    const [deadJobs, total] = await Promise.all([
      prisma.job.findMany({
        where: { status: JobStatus.dead },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: offset,
        take: limit,
      }),
      prisma.job.count({ where: { status: JobStatus.dead } }),
    ]);

    return res.status(200).json({
      data: deadJobs,
      meta: {
        count: deadJobs.length,
        total,
        limit,
        offset,
        hasMore: offset + deadJobs.length < total,
      },
    });
  })
);

// 4. Dead Letter Queue: Manual Retry
app.post(
  "/api/dead-letter/:id/retry",
  asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    if (!isUuid(id)) {
      return res.status(400).json({
        error: { code: "BAD_REQUEST", message: `"id" must be a valid UUID` },
      });
    }

    const job = await prisma.job.findUnique({ where: { id } });

    if (!job) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: `Job ${id} not found` },
      });
    }

    if (job.status !== JobStatus.dead) {
      return res.status(409).json({
        error: {
          code: "CONFLICT",
          message: `Cannot retry job in status "${job.status}". Only "dead" jobs can be retried.`,
        },
      });
    }

    const retriedJob = await retryDeadJob(id);
    return res.status(200).json({
      data: retriedJob,
      message: `Job ${id} reset to pending status for immediate reprocessing`,
    });
  })
);

// 5. Queue Metrics
app.get(
  "/api/metrics",
  asyncHandler(async (_req: Request, res: Response) => {
    const counts = await prisma.job.groupBy({
      by: ["status"],
      _count: { status: true },
    });

    const summary: Record<string, number> = {
      pending: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      dead: 0,
    };

    for (const item of counts) {
      summary[item.status] = item._count.status;
    }

    return res.status(200).json({ data: { ...summary, total: Object.values(summary).reduce((a, b) => a + b, 0) } });
  })
);

// 6. Interactive Dead-Letter Dashboard UI (served at "/")
app.get("/", (_req: Request, res: Response) => {
  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Background Job Queue & Dead-Letter Dashboard</title>
  <style>
    :root {
      --bg: #0f172a;
      --card: #1e293b;
      --text: #f8fafc;
      --muted: #94a3b8;
      --primary: #38bdf8;
      --success: #4ade80;
      --danger: #f87171;
      --warning: #fbbf24;
      --border: #334155;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      margin: 0;
      padding: 2rem;
    }
    .container { max-width: 1000px; margin: 0 auto; }
    h1 { color: var(--primary); margin-bottom: 0.5rem; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 1rem;
      margin: 1.5rem 0;
    }
    .metric-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      text-align: center;
    }
    .metric-val { font-size: 2rem; font-weight: 700; margin-top: 0.25rem; }
    .metric-note { font-size: 0.7rem; color: var(--muted); margin-top: 0.25rem; }
    .btn {
      background: var(--primary);
      color: #0f172a;
      border: none;
      padding: 0.6rem 1.2rem;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      margin-right: 0.5rem;
    }
    .btn-danger { background: var(--danger); color: #fff; }
    .btn-sm { padding: 0.3rem 0.7rem; font-size: 0.85rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 1rem;
      background: var(--card);
      border-radius: 8px;
      overflow: hidden;
    }
    th, td { padding: 0.75rem 1rem; text-align: left; border-bottom: 1px solid var(--border); }
    th { background: #0b1329; color: var(--muted); }
    .err-cell {
      color: var(--danger);
      font-size: 0.75rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      max-width: 320px;
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Background Job Queue Engine</h1>
    <p style="color:var(--muted)">Task 2: Reliable Background Jobs, Exponential Jittered Backoff & Dead-Letter Recovery</p>

    <div style="margin: 1.5rem 0;">
      <button class="btn" onclick="enqueueJob('INVOICE_REPORT_GENERATION')">+ Enqueue Invoice Job</button>
      <button class="btn" onclick="enqueueJob('THIRD_PARTY_WEBHOOK_DISPATCH')">+ Enqueue Webhook Job</button>
      <button class="btn" onclick="enqueueJob('SLOW_TEST_JOB')">+ Enqueue Slow Job (10s)</button>
      <button class="btn btn-danger" onclick="enqueueFailingJob()">+ Enqueue 100% Failing Job (Tests Dead-Letter)</button>
      <button class="btn" style="background:#64748b;color:#fff" onclick="refresh()">Refresh</button>
    </div>

    <div class="metrics-grid" id="metrics">Loading metrics...</div>

    <h2>Dead-Letter Queue (Exhausted Retries)</h2>
    <div id="deadLetterTable">Loading dead jobs...</div>
  </div>

  <script>
    async function loadMetrics() {
      const res = await fetch('/api/metrics');
      const json = await res.json();
      const m = json.data;
      document.getElementById('metrics').innerHTML = \`
        <div class="metric-card"><div style="color:var(--muted)">Pending</div><div class="metric-val" style="color:var(--primary)">\${m.pending}</div><div class="metric-note">queued, never attempted</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Processing</div><div class="metric-val" style="color:var(--warning)">\${m.processing}</div><div class="metric-note">claimed by a worker now</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Succeeded</div><div class="metric-val" style="color:var(--success)">\${m.succeeded}</div><div class="metric-note">terminal</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Failed (Retrying)</div><div class="metric-val" style="color:#fb923c">\${m.failed}</div><div class="metric-note">attempt threw, runAt scheduled in the future</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Dead (DLQ)</div><div class="metric-val" style="color:var(--danger)">\${m.dead}</div><div class="metric-note">retries exhausted, needs a human</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Total</div><div class="metric-val" style="color:var(--text)">\${m.total}</div><div class="metric-note">all statuses</div></div>
      \`;
    }

    async function loadDeadLetter() {
      const res = await fetch('/api/dead-letter?limit=50');
      const json = await res.json();
      const jobs = json.data;
      if (jobs.length === 0) {
        document.getElementById('deadLetterTable').innerHTML = '<p style="color:var(--muted)">Dead-letter queue is currently empty. All jobs healthy.</p>';
        return;
      }
      let html = '<p style="color:var(--muted)">Showing ' + jobs.length + ' of ' + json.meta.total + ' dead jobs (paginated: ?limit=&amp;offset=).</p>';
      html += '<table><thead><tr><th>ID</th><th>Type</th><th>Attempts</th><th>Last Error (message + stack)</th><th>Action</th></tr></thead><tbody>';
      for (const j of jobs) {
        html += \`<tr>
          <td style="font-family:monospace;font-size:0.85rem">\${j.id.slice(0, 8)}...</td>
          <td>\${j.type}</td>
          <td>\${j.attempts} / \${j.maxAttempts}</td>
          <td class="err-cell">\${(j.lastError || 'Unknown').slice(0, 600)}</td>
          <td><button class="btn btn-sm" onclick="retryJob('\${j.id}')">Retry Job</button></td>
        </tr>\`;
      }
      html += '</tbody></table>';
      document.getElementById('deadLetterTable').innerHTML = html;
    }

    async function enqueueJob(type) {
      const idempotencyKey = type.toLowerCase() + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const body = { type, payload: { timestamp: new Date().toISOString() }, idempotencyKey };
      if (type === 'SLOW_TEST_JOB') body.payload.sleepMs = 10000;
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      if (!res.ok) { alert('Enqueue rejected: ' + res.status + ' ' + JSON.stringify(await res.json())); }
      refresh();
    }

    async function enqueueFailingJob() {
      const idempotencyKey = 'fail-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'TEST_FAILING_JOB',
          payload: { alwaysFail: true },
          idempotencyKey,
          maxAttempts: 3
        })
      });
      if (!res.ok) { alert('Enqueue rejected: ' + res.status + ' ' + JSON.stringify(await res.json())); }
      refresh();
    }

    async function retryJob(id) {
      await fetch('/api/dead-letter/' + id + '/retry', { method: 'POST' });
      refresh();
    }

    function refresh() {
      loadMetrics();
      loadDeadLetter();
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>
  `;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

// Unmatched route
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: "Route not found" },
  });
});

// Centralized Error Handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  // Malformed JSON from body-parser
  if (err instanceof SyntaxError && "status" in err && (err as { status: unknown }).status === 400) {
    return res.status(400).json({
      error: { code: "BAD_REQUEST", message: "Malformed JSON in request body" },
    });
  }

  // Body size ceiling exceeded
  if (
    (typeof err === "object" &&
      err !== null &&
      "type" in err &&
      (err as { type: unknown }).type === "entity.too.large") ||
    (typeof err === "object" && err !== null && "status" in err && (err as { status: unknown }).status === 413)
  ) {
    return res.status(413).json({
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: `Request payload exceeds size limit of ${config.bodyLimit}`,
      },
    });
  }

  if (err instanceof BadRequestError) {
    return res.status(400).json({
      error: { code: err.code, message: err.message },
    });
  }

  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid query parameters",
        details: err.flatten().fieldErrors,
      },
    });
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      return res.status(409).json({
        error: { code: "CONFLICT", message: "A record with these unique values already exists" },
      });
    }
    if (err.code === "P2025") {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: "Requested resource not found" },
      });
    }
  }

  // A malformed value for a typed column (e.g. a non-UUID string against a
  // @db.Uuid column) surfaces as a Prisma validation error. It is a client
  // mistake, not a server fault.
  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json({
      error: {
        code: "BAD_REQUEST",
        message: "Invalid request parameter value or database input out of range",
      },
    });
  }

  console.error("[API Error]", err);
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal server error occurred",
    },
  });
});
