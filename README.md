# Product Engineering Portfolio

A monorepo containing five production-grade engineering systems built for the **Product Engineering Bootcamp**. Each system demonstrates rigorous adherence to production distributed systems principles: strict contract design, atomic concurrency control, transactional data integrity, comprehensive error categorization, and empirical proof.

---

## Systems Architecture & Directory Index

| Module Directory | Bootcamp Task | Domain & Core Architectural Focus | Status & Verification |
|---|---|---|---|
| [`storefront-api/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/README.md) | **Task 1** | **Consumable REST API & Consumer Frontend**<br>• Fully versioned REST API (`/api/v1/`)<br>• PostgreSQL `SELECT ... FOR UPDATE` row locks preventing stock race conditions<br>• Server-computed totals in integer minor units (kobo)<br>• Offset & limit clamping, custom error envelopes, IP rate limiter<br>• Minimalist React + Vite consumer client handling loading, empty, and error states | **Live on Render**<br>• [Live API](https://ecommerce-api-xidz.onrender.com/api/v1/products)<br>• [Live Consumer](https://ecommerce-consumer.onrender.com)<br>• 44/44 Vitest tests passing<br>• [Task 1 Writeup](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/POST.md) |
| [`background-job-engine/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/README.md) | **Task 2** | **Resilient Asynchronous Job Engine & DLQ**<br>• PostgreSQL `FOR UPDATE SKIP LOCKED` for zero-collision atomic job claims<br>• Exponential backoff with randomized jitter<br>• Strict separation between `failed` (transient retry) and `dead` (quarantine DLQ)<br>• Stale job sweeper detecting crashed worker heartbeats<br>• HTML Dead-Letter management dashboard with manual retry capabilities | **Empirically Proven**<br>• 5/5 Break-It attack suites passing<br>• Concurrency cap strictly held under 50-job burst<br>• Zero duplicate claims across concurrent workers<br>• [Task 2 Writeup](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/POST.md) |
| [`urban-mobility-data-modeling/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/urban-mobility-data-modeling/README.md) | **Task 3** | **High-Scale API Design & Data Modeling**<br>• Urban On-Demand Mobility platform ("ApexRide")<br>• Highly normalized schema with deliberate read-path denormalization<br>• Integer minor unit financial storage, strict trip state machine<br>• REST vs. GraphQL overfetching audit, WebSockets vs. SSE real-time spec | **Ready for Submission** |
| [`code-review-audits/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/code-review-audits/README.md) | **Task 4** | **Senior Engineering Code Review & Production Audits**<br>• 4-Tier Review Rubric (`Blocking`, `Should fix`, `Question`, `Praise`)<br>• Real PR code review artifacts, thread responses, security & concurrency audits<br>• Post-mortem engineering retrospective | **Ready for Submission** |
| [`algorithmic-pseudocode-lab/`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/README.md) | **Task 5** | **Algorithmic Pseudocoding & Mental Execution Lab**<br>• Strict standardized pseudocode specifications without syntactic shortcuts<br>• Manual line-by-line hand traces and dry-run state tables<br>• Blind manual vs. AI code generation divergence analysis<br>• Comprehensive defence presentation scripts | **Ready for Submission** |

---

## Quickstart & Local Execution

### 1. Storefront Consumable API (`storefront-api`)
```bash
# Run tests
npm run test:storefront

# Start API in development
npm run dev:storefront
```

### 2. Resilient Background Job Engine (`background-job-engine`)
```bash
# Run all 5 break-it attack suites
npm run test:jobs

# Run Background Worker daemon
npm run worker:jobs

# Run HTTP API & Dead-Letter Dashboard (port 5000)
npm run dev:jobs
```

### 3. Run All Test Suites
```bash
npm test
```

---

## Public Posts & Articles

Each task concludes with a senior engineering article teaching one specific concept with empirical data and runnable curl commands:
1. **Task 1 Article:** [`storefront-api/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/storefront-api/POST.md) — *Limit Clamping and Why Your API Should Never Trust Client Query Parameters*
2. **Task 2 Article:** [`background-job-engine/POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/background-job-engine/POST.md) — *Failed vs. Dead: The Architectural Distinction Most Queue Systems Get Wrong*
