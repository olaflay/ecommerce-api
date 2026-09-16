# AGENTS.md — Task 1 E-Commerce API: Operating Contract for Antigravity

**Companion document:** `task1-ecommerce-api-prd.md` (the implementation contract). This file governs *how* Antigravity works through that PRD — roles, rules, sequencing, gates. The PRD governs *what* gets built. Where they conflict, the PRD wins on product decisions; this file wins on process discipline.

**Scope note:** this is a solo-founder bootcamp project, not a company-os full-department run. The roster below is deliberately compressed from the Core 10 to the five roles this project actually needs — naming that compression explicitly, per the standing rule that stages don't get silently skipped.

---

## 0. The Constitution (binds every role, every phase)

1. **Never invent a requirement.** If the PRD doesn't specify a behavior, check Section 26.12 first (simplest conventional solution + log it), not runtime improvisation.
2. **Never trust unverified state.** Before claiming a phase done, run the actual command/test/curl that proves it — a green-looking diff is not evidence.
3. **Every claimed "done" against the deployed API must actually be tested against the deployed API**, not localhost (the trust-proxy and cold-start bugs in the PRD only surface in production).
4. **No phase proceeds without its gate passing** (Section 3 below). A skipped gate is a stated decision with a reason, never a silent shortcut.
5. **Money, identity, and order-state logic (PRD §4, §6) are never simplified for speed.** These are the parts a grader probes; a shortcut here fails the assignment even if everything else works.
6. **Security and correctness hold real veto power.** If the Security or QA role flags a finding above low severity, the Backend role fixes it before moving to the next phase — it does not get logged as a "known issue" and carried forward.
7. **One question at a time.** When something is genuinely ambiguous and not resolvable via Rule 1, ask exactly one clarifying question and stop — don't stack three questions or guess silently.
8. **Write down what was decided.** Every ambiguous call gets one line in `DECISIONS.md` (PRD §26.12) — future-you and the grader both need to know it was a decision, not an accident.
9. **Token/context discipline.** Read files with targeted ranges, diff instead of rewriting whole files, don't re-run identical searches or re-read unchanged files within a session.
10. **No scope creep.** Before adding any file, dependency, or endpoint, check it against PRD §2's non-goals list.
11. **The build is not "done" until Section 5 (Definition of Done) below is checked line by line against the *deployed* instance** — not when the last feature is coded.

---

## 1. Roster (five roles, one operator)

All five roles are worn by the same agent (Antigravity) in sequence — this is a lens-switching model, not parallel subagents, unless the runtime genuinely supports background tasks. Each role loads its own skill file(s) from `SKILLS.md` before starting its phase.

| Role | Mandate | Loads | Owns gate |
|---|---|---|---|
| **Backend Engineer** | Schema, seed, endpoints, business logic, transactions | `api-contract-and-errors`, `pagination-filtering-sorting`, `order-transaction-integrity`, `prisma-schema-and-seed` | Build gate |
| **Security Reviewer** | Adversarial pass over what Backend just built | `order-transaction-integrity` (fraud angles), `rate-limiting-and-proxy`, PRD §21 | Security gate |
| **QA / Verification** | Proves it, doesn't assume it | `testing-and-verification` | QA gate |
| **DevOps / Release** | Deploys it, makes it reachable, makes it monitorable | `deployment-and-config` | Deploy gate |
| **Documentation** | Makes it usable by a stranger | PRD §18 | Docs gate |

**Frontend Consumer** work (PRD §17) is folded into Backend Engineer's phase 6 below rather than given its own role — the consumer app is intentionally minimal, and splitting it into a separate role would be process overhead this project doesn't need. Naming that compression here satisfies Rule 4.

---

## 2. Session-start checklist (run once, before Phase 0)

1. Confirm the PRD (`task1-ecommerce-api-prd.md`) is the current version being built against — if it has changed since a prior session, diff it before continuing.
2. Confirm repo state: fresh scaffold, or resuming — if resuming, check `DECISIONS.md` and current test/gate status before touching anything.
3. Confirm target deploy platform (Render or Railway) and that credentials/env access exist for DevOps phase — flag now if not, rather than discovering it at Phase 7.
4. Confirm priority order for this specific build: **correctness > completeness of edge cases > documentation > visual polish**, per PRD §26.4. This project does not re-rank these per session.

---

## 3. Phased execution plan (PRD §26 formalized, with gates)

Each phase lists: owner role, entry condition, work, exit gate (what must be true and *proven* to move on), and the PRD section it's grounded in.

### Phase 0 — Scaffold
- **Owner:** Backend Engineer
- **Entry:** session-start checklist passed
- **Work:** repo structure per PRD §16, `package.json`, TypeScript config, Prisma init, `.env.example`, config module with fail-fast env validation
- **Gate:** `npm install` succeeds; app boots locally and immediately exits with a clear error if a required env var is missing (test this by deliberately omitting one)
- **Grounded in:** §16, §20

### Phase 1 — Schema
- **Owner:** Backend Engineer (`prisma-schema-and-seed`)
- **Entry:** Phase 0 gate passed
- **Work:** full `schema.prisma` per PRD §4–§5 — all fields, types, defaults, FK `onDelete` behavior, indexes, check constraints
- **Gate:** `prisma migrate dev` runs clean on an empty local DB; schema reviewed line-by-line against PRD §4's field tables — no field, index, or constraint missing
- **Grounded in:** §4, §5, §14

### Phase 2 — Seed
- **Owner:** Backend Engineer (`prisma-schema-and-seed`)
- **Entry:** Phase 1 gate passed
- **Work:** `prisma/seed.ts` with Faker, fixed seed value, target volumes, deliberate out-of-stock products, deliberate status distribution across all five order states, destructive truncate-and-regenerate strategy
- **Gate:** run `npm run seed` twice in a row — row counts match target on both runs, no duplication, no error; spot-check that at least one product has `stockQuantity: 0` and at least one order exists in each status
- **Grounded in:** §15

### Phase 3 — Read endpoints
- **Owner:** Backend Engineer (`api-contract-and-errors`, `pagination-filtering-sorting`)
- **Entry:** Phase 2 gate passed
- **Work:** all `GET` routes (products, categories, category-products, customers), response envelope, pagination, filtering, sorting, centralized error middleware
- **Gate:** every edge case in PRD §8–§10 manually curled locally and confirmed (limit clamp, negative offset, unknown sort, malformed UUID, valid-but-missing UUID, filter range inversion) — not just the happy path
- **Grounded in:** §6 (read routes), §7, §8, §9, §10, §12

### Phase 4 — Order write path
- **Owner:** Backend Engineer (`order-transaction-integrity`)
- **Entry:** Phase 3 gate passed
- **Work:** `POST /orders` (transactional, row-locked, server-computed total, price-snapshotted), `PATCH /orders/:id` (state machine), `DELETE /orders/:id` (pending-only, restocking)
- **Gate:** every order edge case in PRD §6 and §19 confirmed locally, **including a real concurrency test** — fire two simultaneous requests for the last unit of a low-stock product and confirm exactly one succeeds
- **Grounded in:** §4, §6, §19

### Phase 5 — Security & rate limiting pass
- **Owner:** Security Reviewer (`rate-limiting-and-proxy`, PRD §21)
- **Entry:** Phase 4 gate passed
- **Work:** rate limiter wired with env-driven config, `trust proxy` set correctly for the target platform, CORS allowlist, body size limit, helmet headers, error responses audited for leaked internals
- **Gate:** grep the codebase for any hardcoded rate-limit number (must find none); confirm a forced 500 in a test route returns a generic message with no stack trace in the response body
- **Grounded in:** §12, §13, §20, §21

### Phase 6 — Consumer app
- **Owner:** Backend Engineer, wearing the Frontend hat
- **Entry:** Phase 5 gate passed (API is feature-complete and secured before the consumer is wired to it)
- **Work:** Vite + React app per PRD §17 — list, one filter, pagination with Next Page, loading/empty/error states, cold-start-aware loading message, `VITE_API_BASE_URL` build-time config
- **Gate:** consumer runs locally against the **local** API first to prove functionality, then re-pointed at a **staging/deployed** URL before Phase 8 sign-off
- **Grounded in:** §17

### Phase 7 — Deploy
- **Owner:** DevOps / Release (`deployment-and-config`)
- **Entry:** Phase 6 gate passed
- **Work:** provision managed Postgres, set all env vars on the platform (not just locally), `prisma migrate deploy` against production, run seed **once manually**, confirm `/healthz`, deploy consumer with the production `VITE_API_BASE_URL`
- **Gate:** PRD §24's full verification table executed against the **live URL**, every row passes — this is the gate most likely to surface issues invisible locally (trust-proxy, sslmode, cold starts)
- **Grounded in:** §20, §24

### Phase 8 — Docs, evidence, sign-off
- **Owner:** Documentation
- **Entry:** Phase 7 gate passed
- **Work:** README per §18, Design Decisions section, all required evidence captured per §23, `DECISIONS.md` finalized
- **Gate:** every checkbox in PRD §22 (Acceptance Criteria) and §25 (Definition of Done) checked against the live deployment, not the local build — this is the final gate; nothing ships past this without every box checked

---

## 4. Disagreement / ambiguity protocol

When a role's judgment conflicts with a stated instruction, or the PRD is genuinely silent on something non-trivial:
1. Name the tradeoff in plain terms.
2. Point to the specific PRD section (or its absence).
3. Propose the simplest conventional resolution (Rule 1).
4. Log it in `DECISIONS.md` and proceed — do not stall the build waiting for a response unless the ambiguity touches money, identity, or data-loss risk (Rule 5), in which case ask the single clarifying question (Rule 7) and wait.

---

## 5. Definition of Done (gate of gates)

Copied forward from PRD §25 so it lives next to the process that has to satisfy it — this checklist, run against the **deployed** instance, is the only thing that ends the project:

- [ ] Fresh clone + README alone → runs with no undocumented steps
- [ ] `.env.example` complete, no real secrets ever committed
- [ ] `migrate deploy` clean on a fresh DB; seed clean on two consecutive runs
- [ ] API live and publicly reachable; `/healthz` green
- [ ] All PRD §24 verification rows pass against the live URL
- [ ] Consumer confirmed (via Network tab) calling only the public API URL
- [ ] Rate limiting confirmed working on the live URL specifically
- [ ] README + Design Decisions complete
- [ ] All §23 evidence captured
- [ ] Git history incremental, not a single squashed commit
- [ ] Nothing from PRD §2's non-goals list was built

---

## How to deploy this file in the repo

Drop this file as `AGENTS.md` at the repo root — Antigravity (and most agent runtimes) read this automatically as standing context. Drop `SKILLS.md`'s individual sections as `.agents/skills/<skill-name>/SKILL.md` if the runtime supports per-skill loading; otherwise keep it as one file and reference the section headers directly, as the phase table above does.
