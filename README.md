# Product Engineering Portfolio

A monorepo containing five production-grade engineering systems built for the **Product Engineering Bootcamp**. Each system demonstrates rigorous adherence to production distributed systems principles: strict contract design, atomic concurrency control, transactional data integrity, comprehensive error categorization, empirical test verification, and technical writing.

---

## Master Architecture & Directory Index

| Module Directory | Bootcamp Task | Domain & Core Architectural Focus |
|---|---|---|
| [`storefront-api/`](./storefront-api/) | **Task 1** | **Consumable REST API & Consumer Client** — Fully versioned REST API (`/api/v1/`), PostgreSQL `SELECT ... FOR UPDATE` inventory row locking, server-computed totals in integer minor units (kobo), offset & limit clamping, custom error envelopes, IP rate limiter, React + Vite consumer client |
| [`background-job-engine/`](./background-job-engine/) | **Task 2** | **Resilient Asynchronous Job Engine & DLQ** — PostgreSQL `FOR UPDATE SKIP LOCKED` atomic job claiming, exponential backoff with randomized jitter, strict `failed` vs. `dead` separation, stale job sweeper, HTML Dead-Letter management dashboard |
| [`urban-mobility-data-modeling/`](./urban-mobility-data-modeling/) | **Task 3** | **High-Scale API Design & Data Modeling** — Urban On-Demand Mobility platform ("ApexRide"), highly normalized schema with deliberate read-path denormalization, integer minor unit financial storage, strict trip state machine, REST vs. GraphQL overfetching audit, WebSockets vs. SSE real-time spec |
| [`code-review-audits/`](./code-review-audits/) | **Task 4** | **Senior Engineering Code Review & Production Audits** — 4-Tier Review Rubric (`[BLOCKING]`, `[SHOULD FIX]`, `[QUESTION]`, `[PRAISE]`), peer PR reviews, authored PR with peer reviews fully answered, engineering retrospective |
| [`algorithmic-pseudocode-lab/`](./algorithmic-pseudocode-lab/) | **Task 5** | **Algorithmic Pseudocoding & Mental Execution Lab** — Strict standardized pseudocode format, Part A pseudocode specifications with hand-trace state tables, planted bug diagnosis, Part B manual implementation, Part C AI implementation with difference table and 10-input comparison benchmark |

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
| **Task 1: Consumable API** | **Live API:** `https://ecommerce-api-xidz.onrender.com/api/v1/products` — **Live Consumer:** `https://ecommerce-consumer.onrender.com` — **GitHub:** [`storefront-api/`](./storefront-api/) — **Post:** [`storefront-api/POST.md`](./storefront-api/POST.md) |
| **Task 2: Background Jobs** | **GitHub:** [`background-job-engine/`](./background-job-engine/) — **Post:** [`background-job-engine/POST.md`](./background-job-engine/POST.md) |
| **Task 3: API & Data Modeling** | **GitHub:** [`urban-mobility-data-modeling/`](./urban-mobility-data-modeling/) — **Post:** [`urban-mobility-data-modeling/POST.md`](./urban-mobility-data-modeling/POST.md) |
| **Task 4: Code Review** | **GitHub:** [`code-review-audits/`](./code-review-audits/) — **Retrospective:** [`code-review-audits/RETROSPECTIVE.md`](./code-review-audits/RETROSPECTIVE.md) — **Post:** [`code-review-audits/POST.md`](./code-review-audits/POST.md) |
| **Task 5: Pseudocoding** | **GitHub:** [`algorithmic-pseudocode-lab/`](./algorithmic-pseudocode-lab/) — **Explanation Script:** [`algorithmic-pseudocode-lab/part-c/EXPLANATION_SCRIPT.md`](./algorithmic-pseudocode-lab/part-c/EXPLANATION_SCRIPT.md) — **Post:** [`algorithmic-pseudocode-lab/POST.md`](./algorithmic-pseudocode-lab/POST.md) |

---

## Public Technical Posts

Each task includes a publication-quality technical writeup:

| Task | Post Title | Key Insight |
|---|---|---|
| Task 1 | [Limit Clamping and Query Parameter Security](./storefront-api/POST.md) | What happens when someone requests 5,000 records from your API |
| Task 2 | [Failed vs. Dead: The Distinction Most Queues Get Wrong](./background-job-engine/POST.md) | Why conflating retry-eligible and exhausted jobs is a production incident waiting to happen |
| Task 3 | [You Can't Cancel a Moving Car](./urban-mobility-data-modeling/POST.md) | Why state machines belong in your database, not your application code |
| Task 4 | [The Deadlock Hazard in Bulk Inventory Locking](./code-review-audits/POST.md) | The best code review comment I received and what it caught |
| Task 5 | [The Spec is the Prompt](./algorithmic-pseudocode-lab/POST.md) | What pseudocode taught me about directing AI and verifying what it produces |
