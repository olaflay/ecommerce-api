import { prisma } from "../db/prisma.js";

export interface JobContext {
  jobId: string;
  attempt: number;
  /** Refreshes the job's liveness timestamp. Long handlers should call this. */
  heartbeat: () => Promise<void>;
}

export type JobHandler = (
  payload: any,
  context: JobContext
) => Promise<{ result: any }>;

/**
 * Returns a previously persisted output for this job, or null.
 *
 * A handler can crash after performing its side effect but before the
 * transaction that records the output commits, so a durable output row is not
 * the only line of defence against a duplicate side effect. This read is an
 * optimisation that avoids the duplicate work in the common case; the
 * uniqueness of `JobOutput.jobId` (enforced by an atomic upsert in
 * `completeJob`) is what actually guarantees a single output row.
 */
async function findExistingOutput(jobId: string): Promise<{ result: any } | null> {
  return prisma.jobOutput.findUnique({ where: { jobId }, select: { result: true } });
}

/**
 * Handlers registry: each work type is registered here.
 *
 * Handlers are pure with respect to persistence: they compute a result and
 * return it. The output row and the `succeeded` status are written together by
 * `completeJob` inside a single transaction, so a handler can never leave an
 * output behind without the job being marked done, or vice versa.
 */
export const jobHandlers: Record<string, JobHandler> = {
  /**
   * Generates a monthly financial report.
   */
  INVOICE_REPORT_GENERATION: async (payload, context) => {
    const existingOutput = await findExistingOutput(context.jobId);
    if (existingOutput) {
      console.log(
        `[Handler:INVOICE] Output already exists for job ${context.jobId}. Returning cached result.`
      );
      return { result: existingOutput.result };
    }

    // Simulate computationally intensive data aggregation
    await new Promise((resolve) => setTimeout(resolve, 300));

    return {
      result: {
        invoiceId: `INV-${Date.now()}-${context.jobId.slice(0, 8)}`,
        customer: payload.customer || "Acme Corp",
        amountMinorUnits: payload.amount || 2500000,
        currency: "NGN",
        generatedAt: new Date().toISOString(),
        items: payload.items || [{ name: "Server Hosting", units: 1, cost: 2500000 }],
      },
    };
  },

  /**
   * Dispatches data to an external third-party webhook endpoint.
   */
  THIRD_PARTY_WEBHOOK_DISPATCH: async (payload, context) => {
    const existingOutput = await findExistingOutput(context.jobId);
    if (existingOutput) {
      console.log(`[Handler:WEBHOOK] Output already exists for job ${context.jobId}.`);
      return { result: existingOutput.result };
    }

    // Simulate network delay to third party
    await new Promise((resolve) => setTimeout(resolve, 200));

    return {
      result: {
        delivered: true,
        endpoint: payload.endpoint || "https://api.partner.example/webhooks",
        responseCode: 200,
        dispatchedAt: new Date().toISOString(),
      },
    };
  },

  /**
   * Handler configured to simulate transient or permanent failures for testing.
   */
  TEST_FAILING_JOB: async (payload, context) => {
    if (payload.alwaysFail) {
      throw new Error(`Intentional simulated failure for testing (attempt ${context.attempt})`);
    }

    if (payload.failAttempts && context.attempt <= payload.failAttempts) {
      throw new Error(`Transient failure on attempt ${context.attempt} of ${payload.failAttempts}`);
    }

    return {
      result: {
        success: true,
        recoveredOnAttempt: context.attempt,
      },
    };
  },

  /**
   * A deliberately slow job. Used to demonstrate two things that cannot be
   * demonstrated with an instant handler:
   *   1. the worker refreshes `lastHeartbeatAt` while a job runs, so a job that
   *      outlives `STUCK_JOB_TIMEOUT_MS` is not falsely declared stuck;
   *   2. a real worker process can be killed mid-job, leaving an orphaned
   *      `processing` row for the sweeper to recover.
   * `sleepMs` is clamped to 60s so a job cannot pin a worker slot forever.
   */
  SLOW_TEST_JOB: async (payload, context) => {
    const requested = Number(payload.sleepMs ?? 1000);
    const sleepMs = Number.isFinite(requested)
      ? Math.min(60000, Math.max(0, requested))
      : 1000;

    await new Promise((resolve) => setTimeout(resolve, sleepMs));

    return {
      result: {
        sleptMs: sleepMs,
        completedByAttempt: context.attempt,
      },
    };
  },
};

/**
 * The set of job types this engine can actually execute, derived from the handler
 * registry so the two can never drift apart.
 *
 * The enqueue endpoint validates against this allowlist. Without it, a client
 * typo (`INVOICE_REPOR_GENERATION`) creates a well-formed job that no handler
 * can run: it fails `maxAttempts` times and lands in the dead-letter queue,
 * turning a caller-side typo into queue-level noise.
 */
export const JOB_TYPE_ALLOWLIST: readonly string[] = Object.freeze(Object.keys(jobHandlers));

export function isKnownJobType(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(jobHandlers, type);
}
