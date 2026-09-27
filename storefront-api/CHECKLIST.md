# CHECKLIST.md — Single Source of Truth for "Are We Done"

Merges PRD §22 (Acceptance Criteria), §25 (Definition of Done), and §23 (Required Evidence) into one tracker. Check items in order — later phases assume earlier ones are actually done, not just believed done (RULES.md §1). Every box requires the proof named next to it, checked against the **deployed** instance where noted.

## Build correctness
- [x] 4 resources, full FK relationship graph — schema reviewed against PRD §4/§5 line by line
- [x] Response envelope identical shape across every endpoint (success collection / success single / error)
- [x] `400` on: malformed query params, invalid sort field, negative offset, negative/zero limit, malformed UUID route param, malformed JSON body
- [x] `404` on: valid-format ID with no match, unknown route
- [x] `422` on: validation failures (body), field named in error response
- [x] `409` on: insufficient stock, illegal order status transition, deleting a non-pending order
- [x] `429` on: rate limit exceeded, `Retry-After` header present — **tested against the deployed URL** (`https://ecommerce-api-xidz.onrender.com`, HTTP 429, `Retry-After: 60`)
- [x] `204` with no body on successful DELETE
- [x] Pagination: `limit=5000` clamps to 100 (not rejected); `offset` past dataset end returns `200` with empty data
- [x] Sorting: unknown field → `400` naming allowed fields; ties broken by a deterministic secondary key
- [x] Filtering: `minPrice > maxPrice` → `400`; a filter matching nothing → `200` with empty data, not `404`
- [x] Order creation is transactional, race-safe — **concurrency test actually fired** (two parallel requests for last unit of stock), not reasoned about
- [x] `totalAmount` server-computed, never trusts client input
- [x] `unitPrice` snapshotted per order line, never recalculated after creation
- [x] Money is integers in minor units end-to-end — no float anywhere in schema, logic, or responses
- [x] All identifiers are UUIDs, no sequential integer IDs anywhere
- [x] Order status state machine enforced exactly per PRD §6; same-status PATCH is a no-op `200`
- [x] DELETE on a pending order restocks inventory before cascading the delete

## Data
- [x] Seed script committed to Git, run twice locally with no duplication or error
- [x] Target volumes hit (≈40 categories, 400 products, 400 customers, 800 orders, 2,400 order items on live Render DB)
- [x] At least some products deliberately seeded with `stockQuantity: 0` (exactly 9 out of stock)
- [x] At least one order deliberately seeded in each of the five statuses
- [x] Seed is destructive by design and **not** wired into the auto-deploy pipeline

## Security & config
- [x] Rate limit value is configuration-driven — grep confirms no hardcoded number in route files
- [x] `trust proxy` set correctly for the deploy platform — verified by an actual `429` triggered against the **live** URL (`Retry-After: 60`)
- [x] CORS is an explicit allowlist, never `*`
- [x] Request body size capped at 100kb
- [x] 500 responses never leak stack traces, library errors, or file paths to the client
- [x] `.env` never committed at any point in Git history (`git log -p -- .env` comes back empty)
- [x] `.env.example` complete and committed with placeholder values only

## Deployment
- [x] API live at a public URL: `https://ecommerce-api-xidz.onrender.com`
- [x] `/healthz` returns `200` and is excluded from rate limiting
- [x] `prisma migrate deploy` (not `migrate dev`) used in the deploy pipeline
- [x] `DATABASE_URL` includes `sslmode=require` and an explicit `connection_limit`
- [x] Consumer app deployed at `https://ecommerce-consumer.onrender.com`, `VITE_API_BASE_URL` set in build environment
- [x] Consumer's Network tab confirmed calling the live API domain, never localhost

## Consumer app
- [x] List, one filter, pagination with Next Page, loading/empty/error states all present
- [x] Cold-start loading message present (not a generic spinner)
- [x] "Next Page" disabled when `hasMore` is false
- [x] Stale requests guarded (AbortController or sequence check) on rapid pagination clicks

## Documentation & evidence
- [x] README lets a stranger set up and use the API with zero prior context
- [x] README's Design Decisions section covers all points in PRD §18
- [x] `DECISIONS.md` up to date with every non-trivial judgment call (15 logged)
- [x] Live API URL captured: `https://ecommerce-api-xidz.onrender.com`
- [x] Terminal screenshot/log of curl against the **live** URL
- [x] Screenshot/log of a paginated response (`hasMore: true` then `false`)
- [x] Screenshot/log of `429` against the live URL with `Retry-After` header visible
- [x] Screenshot of consumer displaying data with Network tab showing the public API call
- [x] Screenshot/log of a `409` (insufficient stock or illegal transition) response

## Process
- [x] Git history is incremental — multiple meaningful commits, not one squashed dump
- [x] Nothing from PRD §2's non-goals list was built
- [x] PRD §24's full verification table executed and passing against the **deployed** instance

**This project is not done until every box above is checked with its named proof in hand — not when the last feature is coded.**
