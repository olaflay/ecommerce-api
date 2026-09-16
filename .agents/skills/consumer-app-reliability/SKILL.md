---
name: consumer-app-reliability
description: Front-end consumer reliability, cold-start loading indicators, stale-request guards, and pagination safeguards.
---

# consumer-app-reliability

**Load during:** Phase 6
**Trigger:** building or reviewing the Vite/React consumer

- Loading state on first load after platform idle must say something like "waking up the API, this may take a moment" — a generic spinner reads as broken during a 10–30s Render cold start.
- Guard against stale responses overwriting newer ones on rapid pagination clicks (`AbortController` or a request-sequence guard).
- Disable "Next Page" when `meta.hasMore === false` rather than letting the user page into emptiness.
- Surface the API's actual error message (from the `{"error": {...}}` envelope) on failure, not a generic "something went wrong."
- Never hardcode `localhost` anywhere in the production build path — `VITE_API_BASE_URL` only.
