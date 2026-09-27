import { Job } from "@prisma/client";
import { config } from "../config/index.js";
import {
  claimNextJob,
  markJobSucceeded,
  markJobFailed,
  sweepStuckJobs,
} from "../queue/index.js";
import { jobHandlers } from "../handlers/index.js";

export class BackgroundWorker {
  private isRunning = false;
  private activeJobsCount = 0;
  private pollTimer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  public workerId: string;

  constructor(workerId?: string) {
    this.workerId = workerId || `worker-${Math.random().toString(36).substring(2, 7)}`;
  }

  public getActiveJobsCount(): number {
    return this.activeJobsCount;
  }

  public async start() {
    this.isRunning = true;
    console.log(
      `[${this.workerId}] Background worker started (Concurrency Limit: ${config.workerConcurrency}, Max Attempts: ${config.maxAttempts})`
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
      await markJobFailed(job, err);
      return;
    }

    try {
      console.log(`[${this.workerId}] Executing job ${job.id} (attempt ${job.attempts + 1})...`);
      const { result } = await handler(job.payload, {
        jobId: job.id,
        attempt: job.attempts + 1,
      });

      await markJobSucceeded(job.id);
      const elapsed = Date.now() - startTime;
      console.log(`[${this.workerId}] Job ${job.id} SUCCEEDED in ${elapsed}ms.`);
    } catch (err: any) {
      const elapsed = Date.now() - startTime;
      const errorMsg = err?.message || String(err);
      console.error(
        `[${this.workerId}] Job ${job.id} FAILED after ${elapsed}ms: ${errorMsg}`
      );
      await markJobFailed(job, errorMsg);
    }
  }

  public async stop(): Promise<void> {
    console.log(`[${this.workerId}] Shutting down worker...`);
    this.isRunning = false;
    if (this.pollTimer) clearInterval(this.pollTimer);
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
  const worker = new BackgroundWorker();
  worker.start();

  process.on("SIGINT", async () => {
    await worker.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await worker.stop();
    process.exit(0);
  });
}
