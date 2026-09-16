---
name: deployment-and-config
description: Environment validation, PostgreSQL connection pooling and SSL, CORS allowlists, body limits, and deploy commands.
---

# deployment-and-config

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
