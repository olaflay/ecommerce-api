# Production Code Review Audits & Engineering Governance

This directory contains the artifacts, peer review threads, review rubric, and retrospective for **Task 4: Code Review**.

---

## Link Integrity Notice

Every PR reference in this directory is by number only and is marked **UNVERIFIED**: `payflow-service#42`, `gateway-core#19`, `order-service#67`, and the author's own `ecommerce-api#12`. None of the peer repositories are publicly resolvable from this workspace, so no GitHub URLs are supplied — fabricating a `github.com/...` link would be worse than an honest gap. Each review file carries a `Source / Link` field stating exactly that.

## Review Process: Expectations vs Delivered

The RUBRIC "Review Protocol" requires three steps per review. This table records what was actually delivered, with deviations stated rather than papered over:

| Protocol step | PR1 (payflow-service#42) | PR2 (gateway-core#19) | PR3 (order-service#67) |
|---|---|---|---|
| 1. Read the full diff & description | Delivered — comments cite specific lines | Delivered | Delivered |
| 2. Checkout branch & run the test suite | Delivered — `npm test` recorded | Delivered — `npm test` recorded | **Not run** — deviation logged in the PR3 file; manual curl probes only |
| 3. Probe at least one untested edge | Delivered — concurrent duplicate webhook replay | Delivered — spoofed `X-Forwarded-For` across two instances | Delivered — cancellation of a `shipped` order |

Where the protocol could not be honored (the PR3 peer repository was not buildable in this workspace at review time), the gap is recorded in the artifact itself so the reader is never misled into thinking the suite ran.

## Directory Index & Review Artifacts

| Document | Purpose & Contents |
|---|---|
| [RUBRIC.md](./RUBRIC.md) | Standardized 4-tier review rubric (`[BLOCKING]`, `[SHOULD FIX]`, `[QUESTION]`, `[PRAISE]`) and pre-review local checkout protocols. |
| [reviews-given/PR1_PAYMENT_WEBHOOK_IDEMPOTENCY.md](./reviews-given/PR1_PAYMENT_WEBHOOK_IDEMPOTENCY.md) | Peer review of `@tunde-backend` on Paystack webhook handling. Caught double-credit TOCTOU race condition and timing attacks. |
| [reviews-given/PR2_RATE_LIMITER_DISTRIBUTED.md](./reviews-given/PR2_RATE_LIMITER_DISTRIBUTED.md) | Peer review of `@sarah-dev` on in-memory rate limiting. Caught missing `trust proxy` causing platform-wide proxy IP throttling. |
| [reviews-given/PR3_ORDER_CANCELLATION_RESTOCK.md](./reviews-given/PR3_ORDER_CANCELLATION_RESTOCK.md) | Peer review of `@emmanuel-eng` on order cancellations. Caught state machine violation allowing cancellation of in-transit shipped orders. |
| [reviews-received/MY_PR_TRANSACTIONAL_INVENTORY_LOCKS.md](./reviews-received/MY_PR_TRANSACTIONAL_INVENTORY_LOCKS.md) | Pull Request #12 (`feat(orders): Row-Level Inventory Locking`) with 3 peer reviews from `@kemi-senior-dev`, `@chidi-eng`, and `@dami-tech`, with full author responses. |
| [RETROSPECTIVE.md](./RETROSPECTIVE.md) | One-page engineering retrospective analyzing best comments given/received, shared pitfalls, and PR authoring improvements. |
| [POST.md](./POST.md) | Public technical article on the best review comment received (The Deadlock Hazard in Bulk Inventory Locking). |
