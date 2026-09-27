# Product Engineering Portfolio

A monorepo containing five production-grade engineering systems built for the **Product Engineering Bootcamp**. Each system demonstrates rigorous adherence to production distributed systems principles: strict contract design, atomic concurrency control, transactional data integrity, comprehensive error categorization, empirical test verification, and technical writing.

---

## Master Architecture & Directory Index

| Module Directory | Bootcamp Task | Domain & Core Architectural Focus | Public Technical Writeup | Status & Verification |
|---|---|---|---|---|
| [`storefront-api/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/README.md) | **Task 1** | **Consumable REST API & Consumer Client**<br>• Fully versioned REST API (`/api/v1/`)<br>• PostgreSQL `SELECT ... FOR UPDATE` inventory row locking<br>• Server-computed totals in integer minor units (kobo)<br>• Offset & limit clamping, custom error envelopes, IP rate limiter<br>• Minimalist React + Vite consumer client handling loading, empty, and error states | [`storefront-api/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/POST.md)<br>*Limit Clamping and Query Parameter Security* | **Live on Render**<br>• [Live API URL](https://ecommerce-api-xidz.onrender.com/api/v1/products)<br>• [Live Consumer URL](https://ecommerce-consumer.onrender.com)<br>• 44/44 tests passing |
| [`background-job-engine/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/README.md) | **Task 2** | **Resilient Asynchronous Job Engine & DLQ**<br>• PostgreSQL `FOR UPDATE SKIP LOCKED` for atomic job claiming<br>• Exponential backoff with randomized jitter<br>• Strict separation between `failed` (transient retry) vs. `dead` (quarantine DLQ)<br>• Stale job sweeper detecting crashed worker heartbeats<br>• HTML Dead-Letter management dashboard with manual retry capabilities | [`background-job-engine/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/POST.md)<br>*Failed vs. Dead: The Architectural Distinction Most Queues Get Wrong* | **Empirically Proven**<br>• 5/5 Break-It attack suites passing<br>• Concurrency cap strictly held under 50-job burst<br>• Zero duplicate claims across concurrent workers |
| [`urban-mobility-data-modeling/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/README.md) | **Task 3** | **High-Scale API Design & Data Modeling**<br>• Urban On-Demand Mobility platform ("ApexRide")<br>• Highly normalized schema with deliberate read-path denormalization<br>• Integer minor unit financial storage, strict trip state machine<br>• REST vs. GraphQL overfetching audit, WebSockets vs. SSE real-time spec | [`urban-mobility-data-modeling/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/POST.md)<br>*You Can't Cancel a Moving Car: Why State Machines Belong in Your DB* | **Verified on PostgreSQL**<br>• 8/8 empirical tests passing<br>• Partial unique indexes preventing multi-active trips<br>• `EXPLAIN ANALYZE` index verification (<0.25ms query plans) |
| [`code-review-audits/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/code-review-audits/README.md) | **Task 4** | **Senior Engineering Code Review & Production Audits**<br>• 4-Tier Review Rubric (`[BLOCKING]`, `[SHOULD FIX]`, `[QUESTION]`, `[PRAISE]`)<br>• 3 peer PR reviews (TOCTOU webhook race, distributed rate limiter proxy fail, order cancellation restock)<br>• 1 authored PR with 3 peer reviews fully answered<br>• One-page engineering retrospective | [`code-review-audits/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/code-review-audits/POST.md)<br>*The Deadlock Hazard in Bulk Inventory Locking* | **Complete Review Suite**<br>• Rubric, given reviews, received reviews, retrospective & post fully documented |
| [`algorithmic-pseudocode-lab/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/README.md) | **Task 5** | **Algorithmic Pseudocoding & Mental Execution Lab**<br>• Strict standardized pseudocode format without syntactic shortcuts<br>• 9 Part A pseudocode specifications with hand-trace state tables<br>• Planted bug diagnosis (Voucher dilution order-of-operations bug)<br>• Part B manual implementation and 5 hand-trace benchmarks<br>• Part C AI implementation, difference table, 10-input comparison benchmark, and 5-minute explanation script | [`algorithmic-pseudocode-lab/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/POST.md)<br>*The Spec is the Prompt: What Pseudocode Taught Me About Directing AI* | **100% Benchmark Agreement**<br>• 10/10 test inputs in perfect agreement across manual and AI<br>• Zero divergence in edge calculations |

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
| **Task 1: Consumable API** | **Live API:** `https://ecommerce-api-xidz.onrender.com/api/v1/products`<br>**Live Consumer:** `https://ecommerce-consumer.onrender.com`<br>**GitHub Directory:** [`storefront-api/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/)<br>**Public Post:** [`storefront-api/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/POST.md) |
| **Task 2: Background Jobs** | **GitHub Directory:** [`background-job-engine/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/)<br>**Public Post:** [`background-job-engine/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/POST.md) |
| **Task 3: API & Data Modeling** | **GitHub Directory:** [`urban-mobility-data-modeling/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/)<br>**Public Post:** [`urban-mobility-data-modeling/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/POST.md) |
| **Task 4: Code Review** | **GitHub Directory:** [`code-review-audits/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/code-review-audits/)<br>**Retrospective:** [`code-review-audits/RETROSPECTIVE.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/code-review-audits/RETROSPECTIVE.md)<br>**Public Post:** [`code-review-audits/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/code-review-audits/POST.md) |
| **Task 5: Pseudocoding** | **GitHub Directory:** [`algorithmic-pseudocode-lab/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/)<br>**Explanation Script:** [`algorithmic-pseudocode-lab/part-c/EXPLANATION_SCRIPT.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-c/EXPLANATION_SCRIPT.md)<br>**Public Post:** [`algorithmic-pseudocode-lab/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/POST.md) |
