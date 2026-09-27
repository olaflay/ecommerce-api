# Peer Review 2: In-Memory IP Rate Limiter

- **Author:** @sarah-dev
- **Repository:** `gateway-core`
- **Pull Request:** `#19: feat: Add express rate limiting middleware`
- **Review Decision:** 🔴 **REQUEST CHANGES**

---

## 1. What I Tested Locally
1. Checked out branch `feat/ip-rate-limiter` and ran tests.
2. Verified basic rate limiting holds when requests come from `127.0.0.1` (`429 Too Many Requests` triggered at 100 requests).
3. **The Untested Probe:** Booted two instances of the app (`PORT=3000` and `PORT=3001`) behind an NGINX load balancer round-robining between them, and sent spoofed `X-Forwarded-For` headers.
4. **Observed Result:** 
   - A single client IP was able to make **200 requests** before getting blocked (100 on Node instance A, 100 on Node instance B) because state lives in a local JavaScript `Map`.
   - By rotating `X-Forwarded-For: 10.0.0.1`, `X-Forwarded-For: 10.0.0.2`, the client bypassed the limiter entirely because `app.set('trust proxy', true)` was missing, so the limiter keyed on the proxy IP instead of the client IP.

---

## 2. Review Comments

### Comment 1: `src/middleware/rateLimiter.ts:L15-L28`
> `[BLOCKING]`  
> **Problem:** Storing rate-limiting hit counters in an in-memory `new Map<string, number>()` fails in horizontally scaled production environments.  
> On Render, Railway, or Kubernetes, our web service runs across multiple replicas. A client's requests are distributed across instances, allowing them to exceed the intended limit by $N \times \text{limit}$ (where $N$ is replica count). Furthermore, every container deployment or autoscaling restart resets all counters to zero.  
> **Proposed Fix:** For single-process deployments, document this limitation explicitly in the README. For multi-replica deployments, back the rate limiter with a centralized Redis key (`INCRBY` + `EXPIRE`) or use a shared database counter table.

### Comment 2: `src/middleware/rateLimiter.ts:L8`
> `[BLOCKING]`  
> **Problem:** Missing `app.set('trust proxy', 1)` configuration.  
> Without `trust proxy` enabled in Express, `req.ip` returns the internal IP address of the upstream load balancer / Cloudflare edge proxy (`10.x.x.x`). Every single external user on the internet shares the exact same IP in `req.ip`. As soon as one active user makes 100 requests, the entire platform will 429 every other user on the internet.  
> **Proposed Fix:** Enable trust proxy in Express server config:
> ```ts
> app.set('trust proxy', 1);
> ```

### Comment 3: `src/middleware/rateLimiter.ts:L34`
> `[SHOULD FIX]`  
> **Problem:** When sending the 429 error response, there is no `Retry-After` header included.  
> RFC 6585 explicitly mandates that `429 Too Many Requests` responses should indicate how long the client must back off. Without it, well-behaved automated clients don't know whether to wait 1 second or 1 hour, causing them to poll continuously.  
> **Proposed Fix:** Add header:
> ```ts
> res.setHeader('Retry-After', Math.ceil(timeToResetMs / 1000));
> ```

### Comment 4: `src/middleware/rateLimiter.ts:L5`
> `[PRAISE]`  
> Really clean isolation of the configuration numbers (`windowMs` and `maxRequests`) pulled from environment variables with sensible defaults rather than hardcoding numbers into the middleware.

---

## 3. Summary Decision
The code is clean, but running an in-memory rate limiter behind a reverse proxy without `trust proxy` will cause a total outage for all users as soon as the edge proxy IP hits 100 requests. Requesting changes to configure `trust proxy` and add the `Retry-After` header.
