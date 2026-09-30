# Peer Review 2: In-Memory IP Rate Limiter

- **Author:** @sarah-dev
- **Repository:** `gateway-core`
- **Pull Request:** `#19: feat: Add express rate limiting middleware`
- **Review Decision:** 🔴 **REQUEST CHANGES**
- **Source / Link:** `gateway-core` PR `#19` is referenced by number only — the peer repository is not publicly resolvable from this workspace, so no URL is supplied and this reference is **UNVERIFIED**.

---

## 1. What I Tested Locally
1. Checked out branch `feat/ip-rate-limiter` and ran tests.
2. Verified basic rate limiting holds when requests come from `127.0.0.1` (`429 Too Many Requests` triggered at 100 requests).
3. **The Untested Probe:** Booted two instances of the app (`PORT=3000` and `PORT=3001`) behind an NGINX load balancer round-robining between them, and sent spoofed `X-Forwarded-For` headers.
4. **Observed Result:** 
   - A single client IP was able to make **200 requests** before getting blocked (100 on Node instance A, 100 on Node instance B) because state lives in a local JavaScript `Map`.
   - By rotating `X-Forwarded-For: 10.0.0.1`, `X-Forwarded-For: 10.0.0.2`, the client bypassed the limiter entirely because `app.set('trust proxy', 1)` was missing, so the limiter keyed on the proxy IP instead of the client IP.

---

## 2. Review Comments

### Comment 1: `src/middleware/rateLimiter.ts:L15-L28`
> `[BLOCKING]`  
> **Problem:** Storing rate-limiting hit counters in an in-memory `new Map<string, number>()` fails in horizontally scaled production environments.  
> On Render, Railway, or Kubernetes, our web service runs across multiple replicas. A client's requests are distributed across instances, allowing them to exceed the intended limit by $N \times \text{limit}$ (where $N$ is replica count). Furthermore, every container deployment or autoscaling restart resets all counters to zero.  
> **Proposed Fix:** Replace the per-process `Map` with a shared store behind a small `RateStore` interface. For multi-replica deployments this must be a code change, not a README note — e.g. a Redis-backed implementation:
> ```ts
> export class RedisRateStore implements RateStore {
>   async hit(key: string, windowMs: number, max: number): Promise<boolean> {
>     const count = await redisClient.incr(`rl:${key}`);
>     if (count === 1) await redisClient.pExpire(`rl:${key}`, windowMs);
>     return count <= max;
>   }
> }
> ```
> The `incr`+`pExpire` pair is atomic, so every replica shares one counter and container restarts cannot silently zero the limit. Documentation may only supplement a BLOCKING fix, never substitute for it: at most one README line can note that the single-process in-memory fallback resets on deploy.

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

### Comment 4: `src/middleware/rateLimiter.ts:L20`
> `[QUESTION]`  
> The 429 path computes `Retry-After` from a per-client `timeToResetMs`. Is that a fixed window (reset timer anchored to the client's first request) or a sliding window? With a fixed window, a client can fit `maxRequests` at the tail of one window and `maxRequests` again immediately after reset — a burst of almost 2× the claimed limit. Not asserting a bug; I want to understand which semantics the middleware actually implements so the headers and any docs describe reality.

### Comment 5: `src/middleware/rateLimiter.ts:L5`
> `[PRAISE]`  
> Really clean isolation of the configuration numbers (`windowMs` and `maxRequests`) pulled from environment variables with sensible defaults rather than hardcoding numbers into the middleware.

---

## 3. Summary Decision
The code is clean, but the in-memory counter `Map` lets a client bypass the intended limit across replicas, and running the limiter behind a reverse proxy without `trust proxy` will cause a total outage for all users as soon as the edge proxy IP hits 100 requests. Requesting changes to back the limiter with shared state (`RateStore`), configure `trust proxy`, and add the `Retry-After` header.
