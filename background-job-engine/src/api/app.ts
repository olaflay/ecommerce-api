import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { enqueueJob, retryDeadJob } from "../queue/index.js";
import { JobStatus } from "@prisma/client";

export const app = express();

app.use(cors());
app.use(express.json());

const enqueueSchema = z.object({
  type: z.string().min(1, "Job type is required"),
  payload: z.record(z.any()).default({}),
  idempotencyKey: z.string().min(1, "idempotencyKey is required"),
  maxAttempts: z.number().int().min(1).optional(),
});

// 1. Enqueue Job: Returns 202 Accepted immediately
app.post("/api/jobs", async (req: Request, res: Response) => {
  const parsed = enqueueSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
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
});

// 2. Job Status Endpoint
app.get("/api/jobs/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
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
});

// 3. Dead Letter Queue: List dead jobs
app.get("/api/dead-letter", async (_req: Request, res: Response) => {
  const deadJobs = await prisma.job.findMany({
    where: { status: JobStatus.dead },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  return res.status(200).json({
    data: deadJobs,
    meta: { count: deadJobs.length },
  });
});

// 4. Dead Letter Queue: Manual Retry
app.post("/api/dead-letter/:id/retry", async (req: Request, res: Response) => {
  const { id } = req.params;
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
});

// 5. Queue Metrics
app.get("/api/metrics", async (_req: Request, res: Response) => {
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

  return res.status(200).json({ data: summary });
});

// 6. Interactive Dead-Letter Dashboard UI
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
    .badge {
      display: inline-block;
      padding: 0.2rem 0.5rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: bold;
      text-transform: uppercase;
    }
    .badge-dead { background: rgba(248, 113, 113, 0.2); color: var(--danger); }
  </style>
</head>
<body>
  <div class="container">
    <h1>Background Job Queue Engine</h1>
    <p style="color:var(--muted)">Task 2: Reliable Background Jobs, Exponential Jittered Backoff & Dead-Letter Recovery</p>

    <div style="margin: 1.5rem 0;">
      <button class="btn" onclick="enqueueJob('INVOICE_REPORT_GENERATION')">+ Enqueue Invoice Job</button>
      <button class="btn" onclick="enqueueJob('THIRD_PARTY_WEBHOOK_DISPATCH')">+ Enqueue Webhook Job</button>
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
        <div class="metric-card"><div style="color:var(--muted)">Pending</div><div class="metric-val" style="color:var(--primary)">\${m.pending}</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Processing</div><div class="metric-val" style="color:var(--warning)">\${m.processing}</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Succeeded</div><div class="metric-val" style="color:var(--success)">\${m.succeeded}</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Failed (Retrying)</div><div class="metric-val" style="color:#fb923c">\${m.failed}</div></div>
        <div class="metric-card"><div style="color:var(--muted)">Dead (DLQ)</div><div class="metric-val" style="color:var(--danger)">\${m.dead}</div></div>
      \`;
    }

    async function loadDeadLetter() {
      const res = await fetch('/api/dead-letter');
      const json = await res.json();
      const jobs = json.data;
      if (jobs.length === 0) {
        document.getElementById('deadLetterTable').innerHTML = '<p style="color:var(--muted)">Dead-letter queue is currently empty. All jobs healthy.</p>';
        return;
      }
      let html = '<table><thead><tr><th>ID</th><th>Type</th><th>Attempts</th><th>Last Error</th><th>Action</th></tr></thead><tbody>';
      for (const j of jobs) {
        html += \`<tr>
          <td style="font-family:monospace;font-size:0.85rem">\${j.id.slice(0, 8)}...</td>
          <td>\${j.type}</td>
          <td>\${j.attempts} / \${j.maxAttempts}</td>
          <td style="color:var(--danger);font-size:0.85rem">\${j.lastError || 'Unknown'}</td>
          <td><button class="btn btn-sm" onclick="retryJob('\${j.id}')">Retry Job</button></td>
        </tr>\`;
      }
      html += '</tbody></table>';
      document.getElementById('deadLetterTable').innerHTML = html;
    }

    async function enqueueJob(type) {
      const idempotencyKey = 'key-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6);
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, payload: { timestamp: new Date().toISOString() }, idempotencyKey })
      });
      refresh();
    }

    async function enqueueFailingJob() {
      const idempotencyKey = 'fail-' + Date.now();
      await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'TEST_FAILING_JOB',
          payload: { alwaysFail: true },
          idempotencyKey,
          maxAttempts: 3
        })
      });
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

// Centralized Error Handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[API Error]", err);
  return res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An internal server error occurred",
    },
  });
});
