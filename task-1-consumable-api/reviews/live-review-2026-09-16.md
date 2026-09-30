# Live Deployment Review — 2026-09-16

**API:** https://ecommerce-api-xidz.onrender.com
**Consumer:** https://ecommerce-consumer.onrender.com
**Window:** all checks run against deployed instances (not localhost). Consumer Network-tab verified via headless browser.

---

## 1. Health & Infrastructure

| Check | Result | Evidence |
|---|---|---|
| `/healthz` | PASS | 200, ~1.2s warm boot |
| Security headers | PASS | Helmet + HSTS + CSP + nosniff + CORP + COOP + `X-Request-ID` present on all responses |
| Trust proxy / correlation ID | PASS | `X-Request-ID` echoed verbatim from inbound header (`test-corr-id-12345` returned in response) |
| Unknown route | PASS | 404 clean envelope `{code:"NOT_FOUND",message:"Route not found"}`, no stack, no internals |
| Healthz rate-limit exemption | PASS | healthz carries no `ratelimit-*` headers; product routes do |

## 2. Read Endpoints (PRD §6, §8–§10)

| Test | Expected | Actual | Result |
|---|---|---|---|
| Products list | 200 envelope | 200, `data.length=20`, `meta.limit=20`, `meta.total=400` | PASS |
| Limit clamp | limit=5000 → 100 | `meta.limit=100` | PASS |
| Negative offset | 400 | 400 `BAD_REQUEST` | PASS |
| Zero limit | 400 | 400 `limit must be greater than zero` | PASS |
| Negative limit | 400 | 400 `limit must be greater than zero` | PASS |
| Unknown sort | 400 | 400 listing allowed fields | PASS |
| Malformed UUID | 400 | 400 `must be a valid UUID` | PASS |
| Valid-but-missing UUID | 404 | 404 | PASS |
| Filter range inversion | 400 | 400 `minPrice cannot exceed maxPrice` | PASS |
| Filter inStock=true | only in-stock | first item `stockQuantity=59` | PASS |
| Filter inStock=false | only out-of-stock | first item `stockQuantity=0` | PASS |
| Filter empty result (in-range) | 200 empty | `data.Count=0`, `meta.total=0` | PASS |
| Category products | scoped | 3 items, all `categoryId` = requested | PASS |

## 3. Order Write Path (PRD §4, §6, §19)

| Test | Result | Evidence |
|---|---|---|
| `POST /orders` full order | PASS | 201, `totalAmount` server-computed in **kobo** (11719557), `unitPrice` snapshot, qty=1 |
| Insufficient stock | PASS | 409 naming product: `Requested: 160, Available: 59` |
| Invalid status enum | PASS | 422 with details listing the 5 valid states |
| Missing `customerId` | PASS | 422 `customerId: Required` |
| Empty items array | PASS | 422 `items array must contain at least one item` |
| Illegal transition | PASS | 409 (validated under row lock) |
| Delete non-pending | PASS | 409 |
| DELETE pending → restock | PASS | accepted; subsequent `GET /orders/:id` → 404 `Order not found` |
| Money semantics | PASS | all stored/computed as integer kobo; consumer divides by 100 for NGN display only |

## 4. Security & Rate Limiting (PRD §12, §13, §21)

| Check | Result | Evidence |
|---|---|---|
| CORS allowlist | PASS | consumer origin → `Access-Control-Allow-Origin` set; `evil.com` rejected (no ACAO) |
| Body size limit configured | PARTIAL | >100kb body **rejected** but returns **500**, not 413 (see Finding 1) |
| Malformed JSON | PASS | 400 `Malformed JSON in request body` |
| Rate limit sequential | PASS | `ratelimit-limit:100`, `ratelimit-policy:100;w=60`, `ratelimit-remaining` decrements correctly |
| Rate limit parallel | **FAIL** | 110 concurrent requests → **110/110 HTTP 200**, zero 429 (see Finding 3) |
| Error leakage | PASS | all error envelopes generic; no stack traces any status |

## 5. Consumer App (PRD §17)

| Check | Result | Evidence |
|---|---|---|
| Network tab → public API only | PASS | only `https://ecommerce-api-xidz.onrender.com/api/v1/*`, zero localhost |
| Category filter | PASS | 40 categories, `<select>` populates from API |
| Pagination | PASS | Next → `offset=20` 200, shows "Page 2 of 20 (400 items)", Previous enables |
| Sort control | PASS | 4 options rendered |
| In-Stock toggle | PASS | rendered |
| Out-of-stock badge | PASS | "Out of stock" + cancel icon on stock=0 cards |
| Price display | PASS | ₦ NGN two decimals (kobo/100) |
| Loading/empty/error + cold-start copy | PASS | in code + banner "API: …onrender.com"; cold boot not awaited this session (server kept warm for tests) |

---

## Findings

### Finding 1 — MED: Oversized body returns 500 instead of 413
**Where:** `src/middleware/errorHandler.ts` + body limit config.
**Repro:** `POST /api/v1/orders` with ~150KB body → `500` `{code:"INTERNAL_ERROR"}`.
**Root cause:** `express.json({limit:...})` throws `PayloadTooLargeError` (status 413). `errorHandler` maps only body-parser `SyntaxError`(400), `AppError`, `ZodError`, and Prisma *KnownRequest* errors. `PayloadTooLargeError` falls through to generic 500. Standard behavior is `413 Payload Too Large`.
**Fix:** detect `err.type === "entity.too.large"` (or `status === 413`) and return 413 `PAYLOAD_TOO_LARGE`.

### Finding 2 — MED: Price filter beyond 2^31-1 returns 500 instead of 400
**Where:** `src/validation/product.schema.ts:47-63` + `errorHandler.ts` Prisma branch.
**Repro:** `GET /products?minPrice=2147483648` → `500`. Boundary exact: `2147483647` → 200, `2147483648` → 500.
**Root cause:** price is Prisma `Int` (32-bit signed). `parseProductFilters` accepts any `\d+` with no ceiling. A value >2^31-1 reaches Prisma and throws `PrismaClientValidationError`, which the handler does not map (only `PrismaClientKnownRequestError` P2002/P2025). Client-range error surfaces as 500.
**Fix:** cap `minPrice`/`maxPrice` to `≤ 2_147_483_647` (400 `BAD_REQUEST`), and map `PrismaClientValidationError` → 400/500 defensively.

### Finding 3 — MED: Rate limiter bypassed under concurrent burst
**Where:** rate limiter (in-memory `MemoryStore`, single render instance).
**Repro:** 110 parallel requests in one window → 110/110 `200`. Sequential counting works (headers decrement), but concurrent arrival races `incr` (known express-rate-limit MemoryStore non-atomicity).
**Impact:** PRD §24 test 12 passes with a slow sequential loop but fails under burst; a grader hammering in parallel defeats the limit. On Render free (single instance, in-memory store) the only reliable fix is to keep the memory store but accept the documented race, or move to a shared store (Redis) — overkill for this assignment. Mitigation: document as known limitation, or serialize via atomic per-key lock. Recommended: log in DECISIONS.md as accepted constraint for single-instance in-memory store per PRD §26.12.

---

## Verdict

Deployed API is a solid, spec-faithful REST platform: full envelope discipline, kobo-correct money, locked state-machine writes, clean errors, correct CORS/security headers, consumer fully wired to public API only. **Two client-error paths return 500 instead of 4xx (Findings 1–2), and one documented rate-limiter race (Finding 3).** Nothing leaks, order integrity holds, all §24 happy-path rows pass.

Fix Findings 1–2 before sign-off (both are small `errorHandler` additions). Finding 3 → decision record.