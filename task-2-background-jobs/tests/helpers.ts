import { spawn } from "node:child_process";
import type { ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

export const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const TSX_CLI = path.join(projectRoot, "node_modules", "tsx", "dist", "cli.mjs");
const RUNNER = path.join(projectRoot, "src", "worker", "runner.ts");

/**
 * The test suite runs against a dedicated Postgres schema (see vitest.config.ts
 * and scripts/test-db.mjs), so truncating is safe and makes every run
 * repeatable instead of accumulating rows in the shared dev database.
 */
export async function truncateQueue(prisma: PrismaClient): Promise<void> {
  await prisma.job.deleteMany({});
}

/**
 * Median round trip to the database.
 *
 * The suites run against a remote Postgres where a single statement can take
 * close to a second, so timing assertions need their slack derived from a
 * measurement instead of a hardcoded number that would either flake on a slow
 * link or be so wide that it proves nothing.
 */
export async function measureRoundTripMs(
  prisma: PrismaClient,
  samples = 5
): Promise<number> {
  const timings: number[] = [];
  for (let i = 0; i < samples; i += 1) {
    const started = performance.now();
    await prisma.job.count();
    timings.push(performance.now() - started);
  }
  timings.sort((a, b) => a - b);
  return timings[Math.floor(timings.length / 2)]!;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `fn` until it returns a truthy value or the deadline passes. */
export async function waitFor<T>(
  fn: () => Promise<T | null | undefined | false>,
  { timeoutMs = 20000, intervalMs = 50, label = "condition" } = {}
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T | null | undefined | false = null;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last as T;
    await sleep(intervalMs);
  }
  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for ${label}. Last value: ${JSON.stringify(last)}`
  );
}

export interface SpawnedWorker {
  process: ChildProcessByStdio<null, Readable, Readable>;
  /** Everything the worker wrote to stdout, newest last. */
  stdout: string[];
  stderr: string[];
  kill: (signal?: NodeJS.Signals) => boolean;
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}

/**
 * Spawns a real `tsx src/worker/runner.ts` child process.
 *
 * On Windows `process.kill('SIGKILL')` is implemented as TerminateProcess: the
 * process dies immediately with no signal handlers, no graceful shutdown and no
 * chance to finish in-flight work, which is the same observable outcome as a
 * POSIX SIGKILL for the purpose of leaving an orphaned `processing` row behind.
 */
export function spawnWorker(workerId: string): SpawnedWorker {
  const child = spawn(process.execPath, [TSX_CLI, RUNNER], {
    cwd: projectRoot,
    env: { ...process.env, WORKER_ID: workerId },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout: string[] = [];
  const stderr: string[] = [];

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => stdout.push(chunk));
  child.stderr.on("data", (chunk: string) => stderr.push(chunk));

  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve) => {
      child.on("exit", (code, signal) => resolve({ code, signal }));
    }
  );

  return {
    process: child,
    stdout,
    stderr,
    kill: (signal: NodeJS.Signals = "SIGKILL") => child.kill(signal),
    exited,
  };
}

/** Job ids a worker announced it claimed, parsed from its stdout. */
export function claimedIdsFrom(stdout: string[]): string[] {
  const text = stdout.join("");
  const ids: string[] = [];
  const pattern = /Claimed job ([0-9a-f-]{36})/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    ids.push(match[1]!);
  }
  return ids;
}
