# Standing Operational Rules for Task 1 E-Commerce API

These rules bind all development phases:
1. Never invent a requirement; stick strictly to PRD.
2. Never trust unverified state; test every gate with actual commands/curl.
3. Every money field is an integer in minor units (kobo). No floats.
4. All identifiers are UUIDs.
5. All errors and successes follow standard response envelopes.
6. Rate limiting is purely configuration-driven.
7. Secrets never touch git (.env is gitignored).
8. Order creation is transactional and race-safe.
