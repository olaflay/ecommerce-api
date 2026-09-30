# Production Code Review Rubric & Engineering Standards

Code review is an engineering gate, not an editorial formality. The purpose of code review is to guarantee production reliability, prevent data corruption, maintain security invariants, and foster shared domain ownership.

---

## 1. The Four-Tier Review Classification Rubric

Every single comment posted on a pull request must be explicitly tagged with one of the four standardized tags. Vague opinions, subjective style debates, and untagged remarks are prohibited.

### 🔴 `[BLOCKING]`
- **Definition:** Code that will crash in production, corrupt data, leak secrets, violate regulatory compliance, introduce severe security vulnerabilities (e.g. SQL injection, IDOR, unauthenticated access), or introduce data race conditions under concurrent load.
- **Merge Policy:** **PR CANNOT BE MERGED.** Requires explicit code fix and re-review before approval.
- **Example:**
  > `[BLOCKING] Line 48 in src/services/order.service.ts`:
  > The stock decrement and order creation are executed as separate statements outside of a database transaction. If the worker crashes or database disconnects between line 48 and line 54, inventory will be permanently decremented with no corresponding order row. Wrap lines 48-62 in `prisma.$transaction(async (tx) => { ... })`.

### 🟡 `[SHOULD FIX]`
- **Definition:** Code that functions today but introduces technical debt, performance degradation, missing edge case handling, unindexed queries, or maintainability hazards.
- **Merge Policy:** Author is expected to address this before merge or document a tracked GitHub Issue explaining the deferral rationale.
- **Example:**
  > `[SHOULD FIX] Line 112 in src/controllers/catalog.controller.ts`:
  > Calling `await prisma.category.findUnique()` inside a `products.map()` loop introduces an $N+1$ query pattern. At 100 products, this fires 101 database roundtrips. Fetch all categories upfront with `WHERE id IN (...)` or include them via Prisma's `include: { category: true }`.

### 🔵 `[QUESTION]`
- **Definition:** Inquiries where the reviewer seeks clarification on design rationale, non-obvious domain logic, or intentional trade-offs without assuming error.
- **Merge Policy:** Non-blocking, but author must provide a written explanation in the thread before resolving.
- **Example:**
  > `[QUESTION] Line 87 in src/jobs/invoice.ts`:
  > I notice you set `maxAttempts = 5` here, whereas the platform standard in `config.ts` is 3. Is there a specific external provider timeout behavior that requires two extra retry cycles for invoice generation?

### 🟢 `[PRAISE]`
- **Definition:** Commendation of elegant engineering, thoughtful edge-case handling, comprehensive test coverage, or clear documentation.
- **Merge Policy:** **Mandatory minimum of one per review.** A review culture that only points out flaws creates defensive engineers who conceal difficult code.
- **Example:**
  > `[PRAISE] Line 34 in src/middleware/validate.ts`:
  > Excellent foresight using `zod.strict()` here. Rejecting unrecognized payload keys prevents mass-assignment vulnerabilities where a malicious client passes `role: "admin"` during profile updates.

---

## 2. Review Protocol Before Writing Comments

Before submitting any review comments, the reviewer must complete three steps:
1. **Read the Full Diff & Description:** Understand the architectural intent before critiquing line syntax.
2. **Checkout and Run the Branch Locally:** Pull the git branch, boot the server, run the test suite.
3. **Probe Untested Edges:** Send at least one adversarial input that the author did not include in their tests (e.g., negative offset, duplicate idempotency key, concurrent requests).
