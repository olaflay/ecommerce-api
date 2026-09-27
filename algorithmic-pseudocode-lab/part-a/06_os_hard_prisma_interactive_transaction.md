# Part A2: Open-Source Function (Hard) — Prisma Interactive Transaction Coordinator

- **Source Library:** `@prisma/client` (v6.x Interactive Transactions Runtime)
- **Function:** `$transaction(fn: (tx) => Promise<T>, options?: TransactionOptions): Promise<T>`
- **Methodology:** Traced through Prisma's query engine client runtime (`RequestHandler.ts`, `getPrismaClient.ts`) without AI on first pass, then compared against AI explanation.

---

## 1. Pseudocode Specification

```text
FUNCTION executeInteractiveTransaction
INPUTS:
  fn: User callback function receiving a scoped transactional Prisma client (tx) and returning a Promise
  options: Object containing maxWait (timeout to acquire connection), timeout (timeout for total transaction duration), isolationLevel
OUTPUT:
  result: The value resolved by the user callback function
SIDE EFFECTS:
  - ACQUIRES a dedicated database connection from the connection pool
  - SENDS "BEGIN" query to PostgreSQL
  - SENDS queries executed inside fn over the dedicated connection
  - SENDS "COMMIT" on success or "ROLLBACK" on error
  - RELEASES the connection back to the connection pool
FAILS WHEN:
  - maxWait timeout expires before a database connection becomes available
  - Total transaction execution time exceeds timeout option
  - fn throws any exception or rejects promise
  - Database detects deadlock or serialization failure

1. EXTRACT timeout and maxWait from options or apply default configuration (maxWait: 2000ms, timeout: 5000ms)
2. CALL Query Engine to begin interactive transaction:
     CALL engine.startTransaction(options)
     WAIT for transactionId and dedicated database connection
     IF connection acquisition exceeds maxWait
       THROW TransactionApiError: Timed out waiting for a connection from the pool
     END IF
3. INSTANTIATE a scoped proxy client (tx) bound strictly to transactionId
4. START a watchdog timer that will abort transaction if execution time exceeds timeout
5. TRY
     CALL user callback fn passing scoped client tx
     WAIT for fn to complete and yield result
     CLEAR watchdog timer
     CALL engine.commitTransaction(transactionId)
     RELEASE dedicated connection back to pool
     RETURN result
   CATCH error
     CLEAR watchdog timer
     TRY
       CALL engine.rollbackTransaction(transactionId) (may fail if connection was closed)
     CATCH rollbackError
       LOG rollback failure (e.g. connection was already terminated by DB)
     END TRY
     RELEASE dedicated connection back to pool
     RETHROW error to caller
   END TRY
```

---

## 2. Comparison with AI Explanation

### Where My Understanding Differed from AI:
- **AI Initial Claim:** The AI claimed that `$transaction` automatically retries on any error (like network glitch) up to 3 times by default.
- **Source Code Truth:** Reading the Prisma runtime reveals that **interactive transactions (`$transaction(async (tx) => ...)` do NOT auto-retry by default** when `fn` throws an error. Only batch array transactions (`$transaction([query1, query2])`) have built-in retry mechanics for deadlocks. For interactive transactions, retrying must be manually handled by the application developer because `fn` may contain non-idempotent side effects (e.g. sending an email or charging a card). My manual reading correctly captured that `fn` failure triggers an immediate `rollbackTransaction` without retry.
