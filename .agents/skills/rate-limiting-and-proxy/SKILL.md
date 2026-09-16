---
name: rate-limiting-and-proxy
description: Rate limiting configuration, trust proxy setup, retry-after headers, and healthz exemptions.
---

# rate-limiting-and-proxy

**Load during:** Phase 5, verified again in Phase 7 against the live URL
**Trigger:** configuring the rate limiter or deploying to Render/Railway

- Limit value and window come from env vars (`RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS`), read once at startup via the config module. Grep for hardcoded numbers in route files before calling this done — there should be none.
- `app.set('trust proxy', 1)` (or platform equivalent) must be set, or every request behind Render/Railway's load balancer resolves to the same IP and the entire deployment shares one rate-limit bucket. **This bug is invisible locally — it only shows up against the deployed URL.**
- `429` responses include a `Retry-After` header and use the standard error envelope — not a bare-text response.
- The rate limiter runs before any DB work in the request pipeline, so a flood of requests gets rejected before consuming connections.
- `/healthz` is excluded from the limit (or given a much higher separate one) so the platform's own uptime pings can't exhaust real users' quota.
