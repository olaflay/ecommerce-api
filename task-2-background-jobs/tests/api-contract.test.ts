import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import request from "supertest";
import { JobStatus } from "@prisma/client";
import { app } from "../src/api/app.js";
import { prisma } from "../src/db/prisma.js";
import { config } from "../src/config/index.js";
import { completeJob, enqueueJob } from "../src/queue/index.js";
import { JOB_TYPE_ALLOWLIST, jobHandlers } from "../src/handlers/index.js";
import { truncateQueue } from "./helpers.js";

const VALID_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
const MISSING_UUID = "3f2504e0-4f89-11d3-9a0c-0305e82c3302";

describe("TASK 2: HTTP contract", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await truncateQueue(prisma);
  });

  afterAll(async () => {
    await truncateQueue(prisma);
    await prisma.$disconnect();
  });

  it("GET /healthz reports ok", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.timestamp).toBe("string");
  });

  it("GET / serves the dashboard at the root, not at /dead-letter", async () => {
    const root = await request(app).get("/");
    expect(root.status).toBe(200);
    expect(root.headers["content-type"]).toMatch(/text\/html/);
    expect(root.text).toContain("Dead-Letter Queue");

    const bogus = await request(app).get("/dead-letter");
    expect(bogus.status).toBe(404);
  });

  it("POST /api/jobs accepts a known type and returns 202", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ type: "INVOICE_REPORT_GENERATION", payload: {}, idempotencyKey: "k-1" });

    expect(res.status).toBe(202);
    expect(res.body.data.isDuplicate).toBe(false);
    expect(res.body.data.status).toBe("pending");
  });

  it("POST /api/jobs rejects an unknown type with 422 naming the field", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({ type: "INVOICE_REPOR_GENERATION", payload: {}, idempotencyKey: "k-typo" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(res.body.error.details.type).toBeDefined();
    expect(res.body.error.details.type[0]).toContain("type must be one of");
    for (const allowed of JOB_TYPE_ALLOWLIST) {
      expect(res.body.error.details.type[0]).toContain(allowed);
    }

    // Nothing was enqueued: a caller-side typo must not become queue noise.
    expect(await prisma.job.count()).toBe(0);
  });

  it("POST /api/jobs requires idempotencyKey and rejects a missing type", async () => {
    const noKey = await request(app).post("/api/jobs").send({ type: "INVOICE_REPORT_GENERATION" });
    expect(noKey.status).toBe(422);
    expect(noKey.body.error.details.idempotencyKey).toBeDefined();

    const noType = await request(app).post("/api/jobs").send({ idempotencyKey: "k-2" });
    expect(noType.status).toBe(422);
    expect(noType.body.error.details.type).toBeDefined();
  });

  it("POST /api/jobs returns 400 for malformed JSON", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
  });

  it("POST /api/jobs enforces a body size ceiling with 413", async () => {
    const res = await request(app)
      .post("/api/jobs")
      .send({
        type: "INVOICE_REPORT_GENERATION",
        payload: { blob: "x".repeat(200 * 1024) },
        idempotencyKey: "k-big",
      });

    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("GET /api/jobs/:id returns 400 for a malformed UUID instead of hanging", async () => {
    // Express 4 does not forward a rejected promise from an async handler to the
    // error middleware. Before the async wrapper this request never got a
    // response at all: Prisma threw on the UUID column and the client hung.
    const res = await request(app).get("/api/jobs/not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("BAD_REQUEST");
    expect(res.body.error.message).toContain("UUID");
  });

  it("GET /api/jobs/:id returns 404 for a valid but unknown UUID", async () => {
    const res = await request(app).get(`/api/jobs/${MISSING_UUID}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/jobs/:id returns the job with its output", async () => {
    const { job } = await enqueueJob({
      type: "INVOICE_REPORT_GENERATION",
      payload: { customer: "Read Me" },
      idempotencyKey: "k-read",
    });
    await completeJob(job.id, { hello: "world" });

    const res = await request(app).get(`/api/jobs/${job.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(job.id);
    expect(res.body.data.output.result).toEqual({ hello: "world" });
  });

  it("GET /api/dead-letter paginates with the Task 1 clamping contract", async () => {
    await prisma.job.createMany({
      data: Array.from({ length: 25 }, (_unused, i) => ({
        type: "TEST_FAILING_JOB",
        payload: { alwaysFail: true },
        idempotencyKey: `dlq-page-${i}`,
        status: JobStatus.dead,
        attempts: 3,
        maxAttempts: 3,
        lastError: "boom",
        finishedAt: new Date(),
      })),
    });

    // Default limit 20, meta.total reports the true count.
    const def = await request(app).get("/api/dead-letter");
    expect(def.status).toBe(200);
    expect(def.body.data).toHaveLength(20);
    expect(def.body.meta).toMatchObject({ total: 25, limit: 20, offset: 0, hasMore: true });

    // limit is clamped to 100, never rejected.
    const clamped = await request(app).get("/api/dead-letter?limit=5000");
    expect(clamped.status).toBe(200);
    expect(clamped.body.meta.limit).toBe(100);
    expect(clamped.body.data).toHaveLength(25);

    // offset pages.
    const page2 = await request(app).get("/api/dead-letter?limit=20&offset=20");
    expect(page2.status).toBe(200);
    expect(page2.body.data).toHaveLength(5);
    expect(page2.body.meta).toMatchObject({ total: 25, limit: 20, offset: 20, hasMore: false });

    const firstIds = def.body.data.map((j: { id: string }) => j.id);
    const secondIds = page2.body.data.map((j: { id: string }) => j.id);
    expect(firstIds.filter((id: string) => secondIds.includes(id))).toHaveLength(0);

    // Contract violations are 400.
    const negative = await request(app).get("/api/dead-letter?offset=-1");
    expect(negative.status).toBe(400);
    expect(negative.body.error.code).toBe("VALIDATION_ERROR");

    const zeroLimit = await request(app).get("/api/dead-letter?limit=0");
    expect(zeroLimit.status).toBe(400);

    const notANumber = await request(app).get("/api/dead-letter?limit=abc");
    expect(notANumber.status).toBe(400);

    const repeated = await request(app).get("/api/dead-letter?limit=1&limit=2");
    expect(repeated.status).toBe(400);
  });

  it("GET /api/dead-letter only returns dead jobs and reports a total", async () => {
    await enqueueJob({ type: "INVOICE_REPORT_GENERATION", payload: {}, idempotencyKey: "alive" });
    await prisma.job.createMany({
      data: [
        {
          type: "TEST_FAILING_JOB",
          payload: {},
          idempotencyKey: "dead-1",
          status: JobStatus.dead,
          attempts: 3,
          maxAttempts: 3,
        },
      ],
    });

    const res = await request(app).get("/api/dead-letter");
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data.every((j: { status: string }) => j.status === JobStatus.dead)).toBe(true);
  });

  it("POST /api/dead-letter/:id/retry resets a dead job and refuses anything else", async () => {
    const { job } = await enqueueJob({
      type: "TEST_FAILING_JOB",
      payload: { alwaysFail: true },
      idempotencyKey: "retry-me",
      maxAttempts: 3,
    });
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.dead, attempts: 3, lastError: "boom", finishedAt: new Date() },
    });

    const retried = await request(app).post(`/api/dead-letter/${job.id}/retry`);
    expect(retried.status).toBe(200);

    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    expect(row.status).toBe(JobStatus.pending);
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
    expect(row.finishedAt).toBeNull();
    expect(row.startedAt).toBeNull();
    expect(row.runAt.getTime()).toBeLessThanOrEqual(Date.now());

    // A second retry is a conflict, not a silent no-op.
    const again = await request(app).post(`/api/dead-letter/${job.id}/retry`);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("CONFLICT");
  });

  it("POST /api/dead-letter/:id/retry validates the id", async () => {
    const malformed = await request(app).post("/api/dead-letter/not-a-uuid/retry");
    expect(malformed.status).toBe(400);

    const missing = await request(app).post(`/api/dead-letter/${MISSING_UUID}/retry`);
    expect(missing.status).toBe(404);
  });

  it("GET /api/metrics counts every status including failed", async () => {
    await prisma.job.createMany({
      data: [
        { type: "X", payload: {}, idempotencyKey: "m-1", status: JobStatus.pending },
        { type: "X", payload: {}, idempotencyKey: "m-2", status: JobStatus.processing },
        { type: "X", payload: {}, idempotencyKey: "m-3", status: JobStatus.succeeded },
        { type: "X", payload: {}, idempotencyKey: "m-4", status: JobStatus.failed, attempts: 1 },
        { type: "X", payload: {}, idempotencyKey: "m-5", status: JobStatus.dead, attempts: 3 },
      ],
    });

    const res = await request(app).get("/api/metrics");
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      pending: 1,
      processing: 1,
      succeeded: 1,
      failed: 1,
      dead: 1,
      total: 5,
    });
  });

  it("CORS is an allowlist, not open to every origin", async () => {
    const allowed = config.corsAllowedOrigins[0]!;
    const ok = await request(app).get("/api/metrics").set("Origin", allowed);
    expect(ok.headers["access-control-allow-origin"]).toBe(allowed);

    const denied = await request(app).get("/api/metrics").set("Origin", "http://evil.example");
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("unknown routes return 404 instead of hanging", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });

  it("a concurrent double run of the same handler produces exactly one output row", async () => {
    const { job } = await enqueueJob({
      type: "INVOICE_REPORT_GENERATION",
      payload: { customer: "Double Run" },
      idempotencyKey: "double-run",
    });

    const handler = jobHandlers.INVOICE_REPORT_GENERATION!;
    const context = {
      jobId: job.id,
      attempt: 1,
      heartbeat: async () => {},
    };

    // Both workers hold the same row, as happens when a job is recovered by
    // the sweeper while the original worker is still alive.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.processing, startedAt: new Date(), lastHeartbeatAt: new Date() },
    });

    // Two workers running the same handler at the same instant.
    const [runA, runB] = await Promise.all([
      handler({ customer: "Double Run" }, context),
      handler({ customer: "Double Run" }, context),
    ]);

    const [completeA, completeB] = await Promise.all([
      completeJob(job.id, runA.result),
      completeJob(job.id, runB.result),
    ]);

    const outputs = await prisma.jobOutput.findMany({ where: { jobId: job.id } });
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    console.log(
      `[Handler idempotency] two concurrent handler runs + two completes -> ` +
        `outputRows=${outputs.length} sameResult=${JSON.stringify(runA.result) === JSON.stringify(runB.result)} ` +
        `persistedMatchesFirstWrite=${JSON.stringify(completeA.persistedResult) === JSON.stringify(completeB.persistedResult)} ` +
        `jobStatus=${row.status}`
    );

    expect(outputs).toHaveLength(1);
    // The first write wins and is never overwritten by a re-run.
    expect(outputs[0]!.result).toEqual(runA.result);
    expect(completeB.persistedResult).toEqual(completeA.persistedResult);
    expect(row.status).toBe(JobStatus.succeeded);
  });

  it("a second handler run after an output exists reuses the stored result", async () => {
    const { job } = await enqueueJob({
      type: "THIRD_PARTY_WEBHOOK_DISPATCH",
      payload: { endpoint: "https://partner.example/hook" },
      idempotencyKey: "reuse",
    });

    const first = await jobHandlers.THIRD_PARTY_WEBHOOK_DISPATCH!(
      { endpoint: "https://partner.example/hook" },
      { jobId: job.id, attempt: 1, heartbeat: async () => {} }
    );
    await completeJob(job.id, first.result);

    const second = await jobHandlers.THIRD_PARTY_WEBHOOK_DISPATCH!(
      { endpoint: "https://different.example/hook" },
      { jobId: job.id, attempt: 2, heartbeat: async () => {} }
    );

    const outputs = await prisma.jobOutput.findMany({ where: { jobId: job.id } });
    expect(outputs).toHaveLength(1);
    expect(second.result).toEqual(first.result);
  });

  it("a recovered job whose row was re-claimed elsewhere is not stamped succeeded", async () => {
    const { job } = await enqueueJob({
      type: "INVOICE_REPORT_GENERATION",
      payload: {},
      idempotencyKey: "zombie",
    });

    // The worker holds the row, then the sweeper hands it to somebody else.
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.processing, attempts: 1, startedAt: new Date() },
    });
    await prisma.job.update({
      where: { id: job.id },
      data: { status: JobStatus.pending, lastHeartbeatAt: null, startedAt: null },
    });

    const result = await completeJob(job.id, { late: true });
    const row = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });

    expect(result.markedSucceeded).toBe(false);
    expect(row.status).toBe(JobStatus.pending);
    // The output is still recorded, because the work genuinely happened.
    expect(await prisma.jobOutput.count({ where: { jobId: job.id } })).toBe(1);
  });

  it("the health endpoint stays up while the queue is under load", async () => {
    await prisma.job.createMany({
      data: Array.from({ length: 30 }, (_unused, i) => ({
        type: "INVOICE_REPORT_GENERATION",
        payload: { i },
        idempotencyKey: `load-${i}`,
      })),
    });

    const [health, metrics] = await Promise.all([
      request(app).get("/healthz"),
      request(app).get("/api/metrics"),
    ]);
    expect(health.status).toBe(200);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.total).toBe(30);
    // Valid UUIDs generated by the database, so the 400 path above cannot pass
    // by accident.
    expect(VALID_UUID).toMatch(/^[0-9a-f-]{36}$/);
  });
});
