import { Job } from "@prisma/client";
import { config } from "../config/index.js";
import {
  claimNextJob,
  completeJob,
  heartbeatJob,
  markJobFailed,
  sweepStuckJobs,
} from "../queue/index.js";
import { jobHandlers } from "../handlers/index.js";

export class BackgroundWorker {
  private isRunning = false;
  private activeJobsCount = 0;
  private sweepTimer: NodeJS.Timeout | null = null;
  public workerId: string;

  /** Every job id this worker has claimed, in claim order. Exposed so tests can
   *  assert that work actually happened, not just that a ceiling held. */
  private readonly claims: string[] = [];

  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${Math.random().toString(36).substring(2, 7)}`;
  }

  public getActiveJobsCount(): number {
    return this.activeJobsCount;
  }

  public getClaimedJobIds(): readonly string[] {
    return this.claims;
  }

  public async start() {
    this.isRunning = true;
    console.log(
      `[${this.workerId}] Background worker started (Concurrency Limit: ${config.workerConcurrency} per process, Max Attempts: ${config.maxAttempts}, Heartbeat: ${config.heartbeatIntervalMs}ms, Stuck Timeout: ${config.stuckJobTimeoutMs}ms)`
    );

    // Start stuck-job recovery sweep loop
    this.sweepTimer = setInterval(async () => {
      try {
        const swept = await sweepStuckJobs(config.stuckJobTimeoutMs);
        if (swept > 0) {
          console.log(`[${this.workerId}:Sweeper] Recovered ${swept} stuck jobs.`);
        }
      } catch (err) {
        console.error(`[${this.workerId}:Sweeper] Sweep error:`, err);
      }
    }, config.sweepIntervalMs);

    // Main poll and dispatch loop
    this.runLoop();
  }

  private async runLoop() {
    while (this.isRunning) {
      if (this.activeJobsCount >= config.workerConcurrency) {
        // Concurrency cap reached. Wait before polling again
        await new Promise((resolve) => setTimeout(resolve, 50));
        continue;
      }

      try {
        const job = await claimNextJob();
        if (job) {
          this.activeJobsCount++;
          this.claims.push(job.id);
          console.log(
            `[${this.workerId}] Claimed job ${job.id} (type: ${job.type}, active: ${this.activeJobsCount}/${config.workerConcurrency})`
          );

          // Execute job asynchronously so loop can immediately claim next job up to concurrency limit
          this.executeJob(job).finally(() => {
            this.activeJobsCount--;
          });
        } else {
          // No pending jobs ready, wait for poll interval
          await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
        }
      } catch (err) {
        console.error(`[${this.workerId}] Claim loop error:`, err);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async executeJob(job: Job) {
    const handler = jobHandlers[job.type];
    const startTime = Date.now();

    if (!handler) {
      const err = `No registered handler for job type "${job.type}"`;
      console.error(`[${this.workerId}] ${err}`);
      await markJobFailed(job, new Error(err));
      return;
    }

    // Liveness: while this job runs, prove the worker is alive. Without it the
    // sweeper can only look at `startedAt`, so a job that legitimately takes
    // longer than `stuckJobTimeoutMs` gets re-executed while still running.
    const beat = async () => {
      const stillOwned = await heartbeatJob(job.id);
      if (!stillOwned) {
        console.warn(
          `[${this.workerId}] Heartbeat for job ${job.id} rejected: row is no longer "processing".`
        );
      }
    };

    const heartbeatTimer = setInterval(() => {
      void beat().catch((err) =>
        console.error(`[${this.workerId}] Heartbeat failed for job ${job.id}:`, err)
      );
    }, config.heartbeatIntervalMs);

    try {
      console.log(`[${this.workerId}] Executing job ${job.id} (attempt ${job.attempts + 1})...`);
      const { result } = await handler(job.payload, {
        jobId: job.id,
        attempt: job.attempts + 1,
        heartbeat: beat,
      });

      const { job: finished } = await completeJob(job.id, result ?? null);
      const elapsed = Date.now() - startTime;
      console.log(`[${this.workerId}] Job ${job.id} SUCCEEDED in ${elapsed}ms (status: ${finished.status}).`);
    } catch (err: unknown) {
      const elapsed = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(
        `[${this.workerId}] Job ${job.id} FAILED after ${elapsed}ms: ${errorMsg}`
      );
      await markJobFailed(job, err);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  public async stop(): Promise<void> {
    console.log(`[${this.workerId}] Shutting down worker...`);
    this.isRunning = false;
    if (this.sweepTimer) clearInterval(this.sweepTimer);

    // Wait for active in-flight jobs to complete
    let waitCount = 0;
    while (this.activeJobsCount > 0 && waitCount < 50) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      waitCount++;
    }
    console.log(`[${this.workerId}] Worker stopped cleanly.`);
  }
}

// Direct CLI execution
const isDirectExecution =
  process.argv[1]?.endsWith("runner.ts") || process.argv[1]?.endsWith("runner.js");

if (isDirectExecution) {
  // WORKER_ID lets an operator (or an evidence capture) label a worker's logs
  // instead of identifying it by a random suffix.
  const worker = new BackgroundWorker(process.env.WORKER_ID);
  void worker.start();

  process.on("SIGINT", async () => {
    await worker.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await worker.stop();
    process.exit(0);
  });
}
