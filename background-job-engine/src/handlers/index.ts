import { prisma } from "../db/prisma.js";

export interface JobContext {
  jobId: string;
  attempt: number;
}

export type JobHandler = (
  payload: any,
  context: JobContext
) => Promise<{ result: any }>;

/**
 * Handlers registry: each work type is registered here.
 */
export const jobHandlers: Record<string, JobHandler> = {
  /**
   * Generates a monthly financial report and stores the output idempotently.
   */
  INVOICE_REPORT_GENERATION: async (payload, context) => {
    // Check if output already produced (Idempotency guarantee per Step 5)
    const existingOutput = await prisma.jobOutput.findUnique({
      where: { jobId: context.jobId },
    });
    if (existingOutput) {
      console.log(
        `[Handler:INVOICE] Output already exists for job ${context.jobId}. Returning cached result.`
      );
      return { result: existingOutput.result };
    }

    // Simulate computationally intensive data aggregation
    await new Promise((resolve) => setTimeout(resolve, 300));

    const invoiceData = {
      invoiceId: `INV-${Date.now()}-${context.jobId.slice(0, 8)}`,
      customer: payload.customer || "Acme Corp",
      amountMinorUnits: payload.amount || 2500000,
      currency: "NGN",
      generatedAt: new Date().toISOString(),
      items: payload.items || [
        { name: "Server Hosting", units: 1, cost: 2500000 },
      ],
    };

    // Store output keyed strictly by jobId
    await prisma.jobOutput.create({
      data: {
        jobId: context.jobId,
        result: invoiceData,
      },
    });

    return { result: invoiceData };
  },

  /**
   * Dispatches data to an external third-party webhook endpoint.
   */
  THIRD_PARTY_WEBHOOK_DISPATCH: async (payload, context) => {
    // Check idempotency
    const existingOutput = await prisma.jobOutput.findUnique({
      where: { jobId: context.jobId },
    });
    if (existingOutput) {
      return { result: existingOutput.result };
    }

    // Simulate network delay to third party
    await new Promise((resolve) => setTimeout(resolve, 200));

    const dispatchResult = {
      delivered: true,
      endpoint: payload.endpoint || "https://api.partner.example/webhooks",
      responseCode: 200,
      dispatchedAt: new Date().toISOString(),
    };

    await prisma.jobOutput.create({
      data: {
        jobId: context.jobId,
        result: dispatchResult,
      },
    });

    return { result: dispatchResult };
  },

  /**
   * Handler specifically configured to simulate transient or permanent failures for testing.
   */
  TEST_FAILING_JOB: async (payload, context) => {
    // If alwaysFail is requested, unconditionally throw
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
};
