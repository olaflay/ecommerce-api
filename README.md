# Product Engineering Portfolio

A monorepo containing five production-grade engineering systems built for the **Product Engineering Bootcamp**. Each system demonstrates rigorous adherence to production distributed systems principles: strict contract design, atomic concurrency control, transactional data integrity, comprehensive error categorization, empirical test verification, and technical writing.

---

## Master Architecture & Directory Index

| Module Directory | Bootcamp Task | Domain & Core Architectural Focus |
|---|---|---|
| [`task-1-consumable-api/`](./task-1-consumable-api/) | **Task 1** | **Consumable REST API & Consumer Client** — Fully versioned REST API (`/api/v1/`), PostgreSQL `SELECT ... FOR UPDATE` inventory row locking, server-computed totals in integer minor units (kobo), offset & limit clamping, custom error envelopes, IP rate limiter, React + Vite consumer client |
| [`task-2-background-jobs/`](./task-2-background-jobs/) | **Task 2** | **Resilient Asynchronous Job Engine & DLQ** — PostgreSQL `FOR UPDATE SKIP LOCKED` atomic job claiming, exponential backoff with randomized jitter, strict `failed` vs. `dead` separation, stale job sweeper, HTML Dead-Letter management dashboard |
| [`task-3-api-data-modeling/`](./task-3-api-data-modeling/) | **Task 3** | **High-Scale API Design & Data Modeling** — Urban On-Demand Mobility platform ("ApexRide"), highly normalized schema with deliberate read-path denormalization, integer minor unit financial storage, strict trip state machine, REST vs. GraphQL overfetching audit, WebSockets vs. SSE real-time spec |
| [`task-4-code-review/`](./task-4-code-review/) | **Task 4** | **Senior Engineering Code Review & Production Audits** — 4-Tier Review Rubric (`[BLOCKING]`, `[SHOULD FIX]`, `[QUESTION]`, `[PRAISE]`), peer PR reviews, authored PR with peer reviews fully answered, engineering retrospective |
| [`task-5-pseudocoding/`](./task-5-pseudocoding/) | **Task 5** | **Algorithmic Pseudocoding & Mental Execution Lab** — Strict standardized pseudocode format, Part A pseudocode specifications with hand-trace state tables, planted bug diagnosis, Part B manual implementation, Part C AI implementation with difference table and 10-input comparison benchmark |

---

## Live Deployments

| Service | URL | Status |
|---|---|---|
| **Storefront API** | https://ecommerce-api-xidz.onrender.com/api/v1/products | ✅ Live |
| **Health Check** | https://ecommerce-api-xidz.onrender.com/healthz | ✅ Green |
| **Consumer App** | https://ecommerce-consumer.onrender.com | 🔄 Render Static Site |

---

## Quickstart & Verification Commands

### 1. Run Complete Monorepo Test Suite
```bash
npm test
```

### 2. Run Individual System Test Suites
```bash
# Storefront Consumable API (Task 1)
npm run test:storefront

# Background Job Engine Break-It Suites (Task 2)
npm run test:jobs

# ApexRide Mobility Data Model & Constraint Enforcement (Task 3)
npm run test:mobility

# Algorithmic Pseudocoding Benchmarks (Task 5)
npm run test:pseudocode
```

### 3. Local Development Services
```bash
# Start Storefront API (port 4000)
npm run dev:storefront

# Start Background Jobs API & Dashboard (port 5000)
npm run dev:jobs

# Start Background Worker Daemon
npm run worker:jobs
```

---

## Submission Manifest

| Deliverable Item | Submission Link / Artifact Location |
|---|---|
| **Task 1: Consumable API** | **Live API:** `https://ecommerce-api-xidz.onrender.com/api/v1/products` — **Live Consumer:** `https://ecommerce-consumer.onrender.com` — **GitHub:** [`task-1-consumable-api/`](./task-1-consumable-api/) — **Post:** [`task-1-consumable-api/POST.md`](./task-1-consumable-api/POST.md) |
| **Task 2: Background Jobs** | **GitHub:** [`task-2-background-jobs/`](./task-2-background-jobs/) — **Post:** [`task-2-background-jobs/POST.md`](./task-2-background-jobs/POST.md) |
| **Task 3: API & Data Modeling** | **GitHub:** [`task-3-api-data-modeling/`](./task-3-api-data-modeling/) — **Post:** [`task-3-api-data-modeling/POST.md`](./task-3-api-data-modeling/POST.md) |
| **Task 4: Code Review** | **GitHub:** [`task-4-code-review/`](./task-4-code-review/) — **Retrospective:** [`task-4-code-review/RETROSPECTIVE.md`](./task-4-code-review/RETROSPECTIVE.md) — **Post:** [`task-4-code-review/POST.md`](./task-4-code-review/POST.md) |
| **Task 5: Pseudocoding** | **GitHub:** [`task-5-pseudocoding/`](./task-5-pseudocoding/) — **Explanation Script:** [`task-5-pseudocoding/part-c/EXPLANATION_SCRIPT.md`](./task-5-pseudocoding/part-c/EXPLANATION_SCRIPT.md) — **Post:** [`task-5-pseudocoding/POST.md`](./task-5-pseudocoding/POST.md) |

---

## Public Technical Posts

Each task includes a publication-quality technical writeup:

| Task | Post Title | Key Insight |
|---|---|---|
| Task 1 | [Limit Clamping and Query Parameter Security](./task-1-consumable-api/POST.md) | What happens when someone requests 5,000 records from your API |
| Task 2 | [Failed vs. Dead: The Distinction Most Queues Get Wrong](./task-2-background-jobs/POST.md) | Why conflating retry-eligible and exhausted jobs is a production incident waiting to happen |
| Task 3 | [You Can't Cancel a Moving Car](./task-3-api-data-modeling/POST.md) | Why state machines belong in your database, not your application code |
| Task 4 | [The Deadlock Hazard in Bulk Inventory Locking](./task-4-code-review/POST.md) | The best code review comment I received and what it caught |
| Task 5 | [The Spec is the Prompt](./task-5-pseudocoding/POST.md) | What pseudocode taught me about directing AI and verifying what it produces |

