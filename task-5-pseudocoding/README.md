# Algorithmic Pseudocoding & Mental Execution Lab

Pseudocode is how engineers prove they understand code independently of tools, IDEs, or runtime engines. In the era of AI coding agents, pseudocode is the definitive mechanism for **specifying intent unambiguously** and **verifying generated output line by line**.

---

## The Standardized Pseudocode Format

Every algorithm in this laboratory conforms to a strict, non-negotiable standard designed to eliminate ambiguous assumptions:

```text
FUNCTION name
INPUTS: each parameter with explicit type and domain semantics
OUTPUT: return value with type
SIDE EFFECTS: external state mutations, network requests, DB writes, or NONE
FAILS WHEN: all preconditions and error boundaries explicitly enumerated
Numbered steps in plain English present tense (no code syntax shortcuts).
Explicit branches: IF ... OTHERWISE ... END IF
Explicit loops: FOR EACH ... END FOR
Marked external calls: CALL ... (may fail, may be slow)
Marked state changes: WRITE ... / UPDATE ...
Named early exits.
```

---

## Laboratory Contents & Artifact Index

### Part A: Reading Code into Pseudocode
- [`part-a/01_own_complex_create_order.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/01_own_complex_create_order.md) — Complex order creation, transactional locking, and price snapshotting with 3 hand-trace state tables.
- [`part-a/02_own_money_calculate_totals.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/02_own_money_calculate_totals.md) — Integer minor unit financial arithmetic, basis-point tax, and discount flooring with 3 hand-trace tables.
- [`part-a/03_own_error_centralized_handler.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/03_own_error_centralized_handler.md) — Centralized Express error handler, correlation ID injection, and internal stack trace sanitization.
- [`part-a/04_os_short_rate_limit_key.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/04_os_short_rate_limit_key.md) — `express-rate-limit` key generator (identified AI hallucination regarding SHA-256 IP hashing).
- [`part-a/05_os_medium_zod_validate_middleware.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/05_os_medium_zod_validate_middleware.md) — Zod validation interceptor (identified AI misconception regarding `safeParse` throwing exceptions).
- [`part-a/06_os_hard_prisma_interactive_transaction.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/06_os_hard_prisma_interactive_transaction.md) — Prisma interactive transaction coordinator (identified AI error claiming interactive transactions auto-retry).
- [`part-a/07_bugged_coupon_calculator_actual.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/07_bugged_coupon_calculator_actual.md) — Pseudocode of what bugged coupon calculator actually does.
- [`part-a/08_bugged_coupon_calculator_intended.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/08_bugged_coupon_calculator_intended.md) — Pseudocode of what coupon calculator should do.
- [`part-a/09_bugged_coupon_difference_and_diagnosis.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-a/09_bugged_coupon_difference_and_diagnosis.md) — Root cause analysis and mathematical proof of financial loss (Voucher dilution bug).

### Part B: Writing Pseudocode into Code
- [`part-b/FEATURE_SPEC_PSEUDOCODE.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-b/FEATURE_SPEC_PSEUDOCODE.md) — Complete pseudocode specification for Dynamic Delivery Fee Engine with 5 hand-trace verification runs.
- [`part-b/delivery_fee_manual.ts`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-b/delivery_fee_manual.ts) — Manual TypeScript implementation directly mapped from pseudocode without AI.
- [`part-b/test_traces.ts`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-b/test_traces.ts) — Automated benchmark verifying all 5 hand traces match manual execution.

### Part C: Directing AI with Pseudocode, then Verifying It
- [`part-c/delivery_fee_ai.ts`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-c/delivery_fee_ai.ts) — Implementation produced by AI strictly from the pseudocode prompt.
- [`part-c/REVERSE_ENGINEERED_PSEUDOCODE.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-c/REVERSE_ENGINEERED_PSEUDOCODE.md) — Line-by-line reverse-engineered pseudocode derived from AI output without consulting the original spec.
- [`part-c/DIFFERENCE_TABLE.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-c/DIFFERENCE_TABLE.md) — Side-by-side difference classification table (`Added`, `Omitted`, `Interpreted differently`).
- [`part-c/compare_implementations.ts`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-c/compare_implementations.ts) — 10-input comparative test suite (5 original + 5 new boundary inputs). 100% agreement observed across manual and AI implementations.
- [`part-c/EXPLANATION_SCRIPT.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/part-c/EXPLANATION_SCRIPT.md) — 5-minute non-technical verbal explanation script walking through the algorithm without showing code.
- [`POST.md`](file:///c:/Users/ADMIN/Documents/ecommerce%20api/algorithmic-pseudocode-lab/POST.md) — Senior engineering public article.

---

## Verification & Execution

Run all test suites and benchmarks:
```bash
# Test Part B Hand Traces
npm run test:traces

# Test Part C 10-Input Comparative Suite
npm run test:compare

# Run all
npm test
```
