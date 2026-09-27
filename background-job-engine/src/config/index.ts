import { z } from "zod";
import dotenv from "dotenv";

dotenv.config();

const configSchema = z.object({
  databaseUrl: z.string().min(1, "DATABASE_URL is required"),
  port: z.number().default(5000),
  nodeEnv: z.enum(["development", "production", "test"]).default("development"),
  workerConcurrency: z.number().int().min(1).default(5),
  maxAttempts: z.number().int().min(1).default(3),
  baseBackoffMs: z.number().int().min(100).default(1000),
  maxJitterMs: z.number().int().min(0).default(500),
  stuckJobTimeoutMs: z.number().int().min(1000).default(30000),
  pollIntervalMs: z.number().int().min(50).default(500),
  sweepIntervalMs: z.number().int().min(1000).default(10000),
});

export const config = configSchema.parse({
  databaseUrl: process.env.DATABASE_URL,
  port: Number(process.env.PORT || 5000),
  nodeEnv: process.env.NODE_ENV || "development",
  workerConcurrency: Number(process.env.WORKER_CONCURRENCY || 5),
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 3),
  baseBackoffMs: Number(process.env.BASE_BACKOFF_MS || 1000),
  maxJitterMs: Number(process.env.MAX_JITTER_MS || 500),
  stuckJobTimeoutMs: Number(process.env.STUCK_JOB_TIMEOUT_MS || 30000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MS || 500),
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS || 10000),
});

export type Config = z.infer<typeof configSchema>;
