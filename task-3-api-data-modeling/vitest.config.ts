import { defineConfig } from "vitest/config";

// The proof suite talks to a remote managed PostgreSQL over the internet, so
// every assertion pays a real network round trip. Vitest's 5s default timeout
// is far below what that costs and produced false failures on a suite that was
// asserting correct behaviour. 120s per test leaves generous headroom while
// still failing a genuinely hung query.
export default defineConfig({
  test: {
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // Fixtures are shared across the proofs, so tests must not interleave.
    sequence: { concurrent: false },
    fileParallelism: false,
  },
});
