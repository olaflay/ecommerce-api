---
name: api-contract-and-errors
description: Checklist of envelope shapes, HTTP status codes, UUID validation, and error response formatting for the E-Commerce API.
---

# api-contract-and-errors

**Load during:** Phase 3 (read endpoints), referenced every phase after
**Trigger:** any time a new route, error path, or response is written

- Every success response uses one of exactly two envelope shapes: `{"data": [...], "meta": {...}}` for collections, `{"data": {...}}` for singles. Never deviate per-endpoint.
- Every error uses `{"error": {"code": "...", "message": "..."}}`, `code` drawn only from: `BAD_REQUEST`, `NOT_FOUND`, `VALIDATION_ERROR`, `CONFLICT`, `RATE_LIMITED`, `INTERNAL_ERROR`.
- `204 No Content` responses have **no body at all** — not even an empty envelope.
- Malformed route `:id` (fails UUID format) → `400`. Well-formed `:id` with no match → `404`. These are different failure modes; don't collapse them.
- 500 responses never include stack traces, library error text, or file paths — full detail goes to server logs with a correlation ID, generic message goes to the client.
- Never return `200` with an error-shaped body. Every error path uses the correct non-2xx status.
- Wrap every async route handler so an unhandled rejection can't crash the process — it must resolve to a `500` through the centralized error middleware, never an unhandled crash.
