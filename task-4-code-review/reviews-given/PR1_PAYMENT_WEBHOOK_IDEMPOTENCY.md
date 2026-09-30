# Peer Review 1: Payment Webhook Handler & Account Crediting

- **Author:** @tunde-backend
- **Repository:** `payflow-service`
- **Pull Request:** `#42: feat: Handle payment provider webhooks for wallet credit`
- **Review Decision:** 🔴 **REQUEST CHANGES**
- **Source / Link:** `payflow-service` PR `#42` is referenced by number only — the peer repository is not publicly resolvable from this workspace, so no URL is supplied and this reference is **UNVERIFIED**.

---

## 1. What I Tested Locally
1. Checked out branch `feat/paystack-webhook` and booted local environment with PostgreSQL.
2. Verified unit test suite passed (`npm test` -> 8 tests passed).
3. **The Untested Probe:** Simulated duplicate webhook replay attack. Fired two identical webhook payloads with the same `event_id` simultaneously using `Promise.all()` over cURL:
   ```bash
   # Two concurrent webhooks with identical event_id "evt_live_891238912"
   # Shell used: bash/Zsh (macOS/Linux). `&` backgrounds each curl so both fire
   # concurrently; `wait` collects them before the script exits.
   curl -X POST http://localhost:3000/webhooks/paystack -d @payload.json &
   curl -X POST http://localhost:3000/webhooks/paystack -d @payload.json &
   wait
   ```
   *PowerShell caveat: in PowerShell `&` is the call operator, not backgrounding, so the snippet above would serialize the two curls instead of racing them. On Windows use `Start-Job` (or a Node `Promise.all` fetch pair) to reproduce the same forced overlap.*
4. **Observed Result:** Both requests returned `200 OK`, and the user's wallet was credited **twice** (20,000 NGN instead of 10,000 NGN).

---

## 2. Review Comments

### Comment 1: `src/webhooks/paystack.ts:L38-L52`
> `[BLOCKING]`  
> **Problem:** There is a severe Time-of-Check to Time-of-Use (TOCTOU) race condition in your idempotency check.  
> You query `const existing = await prisma.processedWebhook.findUnique({ where: { eventId } })` on line 40, and then only write the record on line 58 after crediting the wallet. Under concurrent delivery (which Paystack and Stripe explicitly document as normal during network retries), both webhook invocations pass the check on line 40 simultaneously before either writes to the database.  
> **Proposed Fix:** Insert the `eventId` inside a database transaction with a unique database constraint *before* crediting the wallet, or use atomic row insertion:
> ```ts
> await prisma.$transaction(async (tx) => {
>   // Will throw P2002 unique constraint violation on duplicate concurrent replay
>   await tx.processedWebhook.create({ data: { eventId: event.id, processedAt: new Date() } });
>   await tx.wallet.update({
>     where: { userId: event.data.metadata.userId },
>     data: { balanceMinor: { increment: event.data.amount } }
>   });
> });
> ```

### Comment 2: `src/webhooks/paystack.ts:L24`
> `[SHOULD FIX]`  
> **Problem:** The HMAC signature verification is using `crypto.createHmac().digest('hex') === signatureHeader`.  
> Regular string comparison (`===`) is vulnerable to timing attacks because it evaluates characters sequentially and terminates on the first mismatch, allowing an attacker to deduce the signature byte by byte.  
> **Proposed Fix:** Use constant-time equality check:
> ```ts
> const isValid = crypto.timingSafeEqual(
>   Buffer.from(computedHash, 'utf8'),
>   Buffer.from(signatureHeader, 'utf8')
> );
> ```

### Comment 3: `src/webhooks/paystack.ts:L65`
> `[QUESTION]`  
> If credit processing throws an unexpected error (e.g. database connection pool exhaustion), this route currently catches it and returns `500 Internal Server Error`. Will the payment gateway retry, and do we have a dead-letter mechanism so the user does not get permanently stuck without their funds?

### Comment 4: `src/utils/crypto.ts:L12`
> `[PRAISE]`  
> Really clean extraction of the webhook payload parser with TypeScript type guards. It makes the payload discrimination between `charge.success` and `transfer.failed` completely type-safe throughout the handler.

---

## 3. Summary Decision
The webhook signature verification and type handling are well structured, but the double-crediting race condition on lines 38–52 is a critical financial blocker. Moving the idempotency reservation into an atomic database transaction will make this rock-solid. Requesting changes until the concurrency fix is applied.
