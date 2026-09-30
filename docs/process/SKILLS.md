# SKILLS.md — Task 1 E-Commerce API Skill Package

Each section below is one skill. Save each as `.agents/skills/<name>/SKILL.md` if your runtime loads skills individually; otherwise reference sections directly from `AGENTS.md`'s phase table. Every skill is a **checklist of must-not-miss behaviors**, not general knowledge — it exists because these are exactly the things a fast implementation tends to skip.

---

## Skill: api-contract-and-errors
**Load during:** Phase 3 (read endpoints), referenced every phase after
**Trigger:** any time a new route, error path, or response is written

- Every success response uses one of exactly two envelope shapes: `{"data": [...], "meta": {...}}` for collections, `{"data": {...}}` for singles. Never deviate per-endpoint.
- Every error uses `{"error": {"code": "...", "message": "..."}}`, `code` drawn only from: `BAD_REQUEST`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`.
- `204 No Content` responses have **no body at all** — not even an empty envelope.
- Malformed route `:id` (fails UUID format) → `400`. Well-formed `:id` with no match → `404`. These are different failure modes; don't collapse them.
- 500 responses never include stack traces, library error text, or file paths — full detail goes to server logs with a correlation ID, generic message goes to the client.
- Never return `200` with an error-shaped body. Every error path uses the correct non-2xx status.
- Wrap every async route handler so an unhandled rejection can't crash the process — it must resolve to a `500` through the centralized error middleware, never an unhandled crash.

---

## Skill: pagination-filtering-sorting
**Load during:** Phase 3
**Trigger:** writing or reviewing any `GET` list endpoint

- `limit`: default 20, max 100. `limit > 100` → **clamp**, don't reject. `limit <= 0` or non-numeric → `400`.
- `offset`: default 0. Negative or non-numeric → `400`. Beyond dataset size → `200` with empty `data`, never an error.
- `sort`: whitelist only, per-resource. Unknown field → `400` naming the allowed set. Never silently fall back to default.
- `order`: `asc`/`desc` only (case-insensitive), default `asc`. Anything else → `400`.
- Multiple values for a single-value query param (e.g. `?sort=a&sort=b`) → `400`, don't silently take the first/last.
- Add a deterministic secondary sort key (`id`) under every primary sort so pagination is stable when primary-sort values tie.
- Filter range inversion (`minPrice > maxPrice`) → `400`, don't silently return empty results.
- A filter that matches zero rows is a valid `200` with empty `data` — never a `404`.

---

## Skill: order-transaction-integrity
**Load during:** Phase 4, reviewed again in Phase 5 by Security
**Trigger:** any code touching `Order`, `OrderItem`, `Product.stockQuantity`, or money

- `totalAmount` is **always server-computed** from line items at the product's *current* price at order-creation time. Never accept or trust a client-supplied total.
- `OrderItem.unitPrice` is a **snapshot** taken at order creation and never recalculated later, even if the product's price changes afterward.
- Stock check-and-decrement happens inside one DB transaction with a row-level lock (`SELECT ... FOR UPDATE` or Prisma interactive transaction with an in-transaction re-read). Two simultaneous requests for the last unit must never both succeed — the loser gets `409`, not a negative stock value.
- Empty `items` array on order creation → `422`, not a silently-accepted zero-value order.
- Duplicate `productId` within one order's `items` → merge quantities into one line item (per the PRD's documented decision) — don't silently create two rows for the same product.
- Insufficient stock → `409 Conflict`, not `422` — this is a business-state conflict, not a malformed request. Name the product and available quantity in the message.
- Status transitions follow the state machine exactly: `pending→{paid,cancelled}`, `paid→{shipped,cancelled}`, `shipped→delivered`, `delivered`/`cancelled` terminal. Any other transition → `409`.
- PATCH-ing an order to its current status is a no-op success (`200`), not an error.
- `DELETE` only succeeds while `status === "pending"`; any other status → `409`. A successful delete **restocks** the associated OrderItem quantities before cascading the delete — don't leave inventory permanently decremented for a deleted order.
- Money fields are integers in minor units (kobo) everywhere — schema, business logic, and API responses. Never introduce a float/decimal anywhere in this path.

---

## Skill: rate-limiting-and-proxy
**Load during:** Phase 5, verified again in Phase 7 against the live URL
**Trigger:** configuring the rate limiter or deploying to Render/Railway

- Limit value and window come from env vars (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`), read once at startup via the config module. Grep for hardcoded numbers in route files before calling this done — there should be none.
- `app.set('trust proxy', 1)` (or platform equivalent) must be set, or every request behind Render/Railway's load balancer resolves to the same IP and the entire deployment shares one rate-limit bucket. **This bug is invisible locally — it only shows up against the deployed URL.**
- `429` responses include a `Retry-After` header and use the standard error envelope — not a bare-text response.
- The rate limiter runs before any DB work in the request pipeline, so a flood of requests gets rejected before consuming connections.
- `/healthz` is excluded from the limit (or given a much higher separate one) so the platform's own uptime pings can't exhaust real users' quota.

---

## Skill: prisma-schema-and-seed
**Load during:** Phase 1 and Phase 2
**Trigger:** editing `schema.prisma` or `seed.ts`

- Every FK's `onDelete` behavior is deliberate, not default: `Restrict` everywhere except `OrderItem → Order`, which is `Cascade` (line items have no independent meaning without their order).
- Indexes exist only where an actual query needs them (`Product.categoryId`, `Product.price`, `Order.customerId`, `Order.status`, `Order.createdAt`, both `OrderItem` FKs, unique `Customer.email`). Don't index every column — that's a filler metric, not a real gate criterion.
- Check constraints at the DB level: `stockQuantity >= 0`, `price > 0`, `quantity >= 1`, `unitPrice > 0` — defense in depth even if app-level validation should already catch these.
- `Customer.email` is lowercased on write and uniquely indexed on the lowercased value — case-insensitive uniqueness, not Postgres's default case-sensitive behavior.
- Seed script: `faker.seed(42)` fixed at the top for reproducibility; truncate-and-regenerate strategy (not upsert) since Faker data has no natural stable keys; deliberately force at least some `stockQuantity: 0` products and at least one order per status, rather than leaving that to random chance.
- Seed is destructive by design — document that loudly, and never wire it into an automatic deploy pipeline (Phase 7 runs it manually, once).

---

## Skill: deployment-and-config
**Load during:** Phase 0 (config module) and Phase 7 (actual deploy)
**Trigger:** touching env vars, `DATABASE_URL`, CORS, or the deploy pipeline

- Config module validates all required env vars at process startup and crashes immediately with a clear message if one is missing — never fails silently deep inside a request handler later.
- `DATABASE_URL` for managed Postgres needs `?sslmode=require` (or platform equivalent) — a very common first-deploy connection failure if omitted.
- Set an explicit `connection_limit` on `DATABASE_URL` sized to the platform's plan — Prisma's default pool can exhaust a small managed instance's connection cap under even light concurrent load.
- `CORS_ALLOWED_ORIGINS` is an explicit comma-separated allowlist, never a bare `*` — especially not combined with credentials.
- Request body size capped (`express.json({ limit: '100kb' })`) against trivial DoS via oversized POST bodies.
- `prisma migrate deploy` runs in the deploy pipeline; `prisma migrate dev` never touches production.
- Seed runs manually, once, post-migration — never on every push (it's destructive; see `prisma-schema-and-seed`).
- Vite's `VITE_API_BASE_URL` is a **build-time** value — it must be set correctly in the frontend host's build environment, not just a local `.env`, or the deployed bundle silently points at localhost/nothing.

---

## Skill: testing-and-verification
**Load during:** every phase's gate check, formally in Phase 7
**Trigger:** claiming any phase "done"

- Never claim a gate passed without running the actual command/curl/test that proves it. A plausible-looking diff is not evidence.
- Test both the happy path and the specific edge case for every feature — one without the other is an incomplete test, not a passing one.
- Run the full PRD §24 verification table against the **deployed** URL before final sign-off, even if everything already passed locally — several of these bugs (trust-proxy, sslmode, cold start) only exist in the deployed environment.
- For the concurrency test (simultaneous last-unit orders), actually fire two parallel requests — don't reason about it in the abstract and assume the transaction logic is correct.
- Confirm the consumer's network calls target the live API domain by inspecting the browser's Network tab, not by reading the source code and assuming the build picked up the right env var.

---

## Skill: consumer-app-reliability
**Load during:** Phase 6
**Trigger:** building or reviewing the Vite/React consumer

- Loading state on first load after platform idle must say something like "waking up the API, this may take a moment" — a generic spinner reads as broken during a 10–30s Render cold start.
- Guard against stale responses overwriting newer ones on rapid pagination clicks (`AbortController` or a request-sequence guard).
- Disable "Next Page" when `meta.hasMore === false` rather than letting the user page into emptiness.
- Surface the API's actual error message (from the `{"error": {...}}` envelope) on failure, not a generic "something went wrong."
- Never hardcode `localhost` anywhere in the production build path — `VITE_API_BASE_URL` only.
