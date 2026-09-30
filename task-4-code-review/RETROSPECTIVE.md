# Code Review Engineering Retrospective

A reflective analysis of peer review practices, critical architectural vulnerabilities uncovered, and systemic changes to our engineering workflow.

---

## 1. The Best Comment I Received (And Why)
The best comment I received was from **@kemi-senior-dev** on PR #12 regarding **Row Lock Acquisition Ordering & Deadlock Hazards** (`src/services/order.service.ts:L82`).

### Why It Was the Best:
Most engineers think adding `SELECT ... FOR UPDATE` solves all concurrency problems. I had correctly locked the products to prevent negative stock counts, but I was locking them in the random order the user submitted in their JSON payload. 

Kemi pointed out that two concurrent transactions buying the same two products in reversed order (`[A, B]` vs `[B, A]`) create a circular wait condition that triggers PostgreSQL deadlock aborts (`40P01`). The insight was subtle: **the presence of locks introduces deadlocks unless lock acquisition order is globally monotonic**. By sorting the UUIDs lexicographically (`Array.from(new Set(ids)).sort()`) before querying, cycles in the wait-for graph become mathematically impossible. It transformed a hidden production landmine into deterministic concurrency.

---

## 2. The Best Comment I Gave
The best comment I gave was on **@tunde-backend's PR #42** regarding **TOCTOU Race Conditions in Webhook Idempotency** (`src/webhooks/paystack.ts:L38`).

### Why It Mattered:
Tunde had written an idempotency check, but it was structured as:
```ts
const existing = await findUnique(...);
if (!existing) {
  await creditWallet(...);
  await saveProcessedWebhook(...);
}
```
In high-throughput webhook delivery, payment gateways send concurrent duplicate webhooks when network acknowledgments lag by even 50 milliseconds. Both webhooks executed the read simultaneously, both evaluated `existing == null`, and both credited the customer's wallet. 

By demonstrating the exploit locally with two concurrent curl requests and providing the solution (an atomic PostgreSQL transaction with a unique database constraint on `eventId` evaluated *before* the credit), I prevented real financial loss before the code reached production.

---

## 3. What I Caught in Someone Else's Code That I Have Done in My Own
In **@sarah-dev's PR #19**, I caught the absence of `app.set('trust proxy', 1)` when deploying rate limiting behind an edge proxy.

I recognized this immediately because **I made this exact mistake in my own early deployment on Render**. When you test locally, your client IP is `127.0.0.1`. When you deploy to Render or Railway behind their Cloudflare/Envoy reverse proxies without configuring `trust proxy`, Express sees the reverse proxy's internal IP (`10.x.x.x`) as the client IP for *every single incoming request*. In production, the very first user who performs 100 actions exhausts the rate limit bucket for the entire company, causing a global outage for all users. 

Catching this in Sarah's PR reinforced that local testing is completely blind to reverse-proxy network topologies.

---

## 4. What I Will Change About How I Write Pull Requests
Having reviewed three pull requests from peers and experienced the friction of reviewing large, ambiguous diffs, I will make three permanent changes to how I author PRs:

1. **Include a "How to Break This" Section in the PR Description:** Instead of just explaining how the happy path works, I will explicitly list the edge cases I considered (e.g. concurrent race conditions, boundary numbers, negative values) and provide runnable curl commands or tests that verify them.
2. **Cap PR Size at 300 Lines of Diff:** Reviewing PRs with >600 lines leads to reviewer fatigue, where reviewers skim line logic and miss critical concurrency bugs. If a feature is large, I will split it into a schema PR, an internal service logic PR, and an API route PR.
3. **Record a 30-Second Terminal or UI Screencast:** In PR #12, including terminal outputs proved that the database rejected illegal states. Moving forward, every UI or API PR of mine will include a reproducible terminal GIF or recording so reviewers can visually verify the running state in 30 seconds.

---

## 5. Scope Honesty: What This Retrospective Does and Does Not Claim

This retrospective highlights the single strongest comment given and received plus two systemic lessons. It does not claim uniform rigor across every artifact. Three gaps are stated here rather than hidden — they match the corrections applied in this directory's review files:

1. **PR3 (order-service#67) never ran its test suite.** The PR3 review records manual curl probes only; `npm test` was not executed, and that deviation is logged in the review file rather than retroactively claimed as a passing run.
2. **PR2 (gateway-core#19) originally shipped without a `[QUESTION]` tag.** All four rubric tags are now present across the three reviews given, and the PR2 artifact carries the added `[QUESTION]` — but the gap happened, and this retrospective does not pretend it did not.
3. **PR #12 fix commit hashes do not resolve.** The author responses originally cited `7a1f902` and `9c84e11`; `git cat-file -t` returns "Not a valid object name" for both, so those hashes are not verifiable in this repository. The pagination clamp fix is verifiable in the working tree (`src/utils/pagination.ts`, `tests/catalog.test.ts`); the sorted-lock fix is NOT present in the currently tracked code. Section 1 above therefore reflects the *lesson* the comment taught, not evidence that the change was merged.
