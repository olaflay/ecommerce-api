---
name: testing-and-verification
description: Verification gates, empirical proof requirements, concurrency race testing, and deployed verification table.
---

# testing-and-verification

**Load during:** every phase's gate check, formally in Phase 7
**Trigger:** claiming any phase "done"

- Never claim a gate passed without running the actual command/curl/test that proves it. A plausible-looking diff is not evidence.
- Test both the happy path and the specific edge case for every feature — one without the other is an incomplete test, not a passing one.
- Run the full PRD §24 verification table against the **deployed** URL before final sign-off, even if everything already passed locally — several of these bugs (trust-proxy, sslmode, cold start) only exist in the deployed environment.
- For the concurrency test (simultaneous last-unit orders), actually fire two parallel requests — don't reason about it in the abstract and assume the transaction logic is correct.
- Confirm the consumer's network calls target the live API domain by inspecting the browser's Network tab, not by reading the source code and assuming the build picked up the right env var.
