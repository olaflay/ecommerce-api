# The Deadlock Hazard in Bulk Inventory Locking: The Best Code Review Comment I Received

When building an e-commerce checkout path or an order-matching engine, every backend engineer eventually learns that simple `SELECT` followed by `UPDATE` allows race conditions where two simultaneous shoppers buy the last unit in stock.

The textbook fix is PostgreSQL row-level locking:
```sql
SELECT * FROM "Product" WHERE id = $1 FOR UPDATE;
```

I implemented this, tested it with two concurrent requests competing for 1 unit of stock, and watched one succeed with `201 Created` while the other failed with `409 Conflict`. My tests passed. I opened Pull Request #12 feeling proud of my concurrency protection.

Then came the review comment that humbled me.

---

## 1. The Comment That Caught What Vitest Missed

On line 82 of `src/services/order.service.ts`, Senior Backend Engineer **@kemi-senior-dev** posted this `[BLOCKING]` review comment:

> **`[BLOCKING]` High Deadlock Risk under Concurrent Multi-Item Orders:**  
> You are acquiring row-level locks on products using `SELECT ... FOR UPDATE` in the arbitrary order they arrived in the user's JSON payload:
> ```ts
> for (const item of items) {
>   const product = await tx.$queryRaw`SELECT * FROM "Product" WHERE id = ${item.productId}::uuid FOR UPDATE`;
> }
> ```
> If Transaction A purchases `[Product 1, Product 2]` and Transaction B simultaneously purchases `[Product 2, Product 1]`:
> 1. Transaction A acquires lock on Product 1 and waits for Product 2.
> 2. Transaction B acquires lock on Product 2 and waits for Product 1.
> Both transactions block each other permanently until PostgreSQL aborts one with a `40P01 (deadlock_detected)` exception.  
> **Proposed Fix:** Sort all unique product UUIDs canonically in alphanumeric order before acquiring any row locks:
> ```ts
> const sortedIds = [...new Set(items.map(i => i.productId))].sort();
> ```

---

## 2. Why This Taught Me More Than a Database Textbook

My unit tests had tested concurrency with **single-item carts**. Under single-item load, deadlocks are physically impossible because each transaction only ever requests one lock.

The moment a user has a multi-item cart (e.g. buying a laptop AND a mouse), the order in which locks are acquired becomes critical. 

In computer science, Coffman's conditions state that a deadlock can only occur if there is a **circular wait condition**:
- Transaction A holds Lock 1, wants Lock 2.
- Transaction B holds Lock 2, wants Lock 1.

How do you break circular wait? **By establishing a strict global total order for resource allocation.**

If every process in the universe must acquire Lock 1 before Lock 2, then Transaction B can never hold Lock 2 while waiting for Lock 1. It must wait for Lock 1 first!

---

## 3. The Production Fix

Here is the exact code change applied in response to the review:

```diff
- // Vulnerable: locks rows in arbitrary payload order
- for (const item of items) {
-   const product = await tx.product.findUnique({
-     where: { id: item.productId }
-   });
- }

+ // Safe: Deduplicate and sort IDs lexicographically before locking
+ const sortedUniqueProductIds = Array.from(
+   new Set(items.map((i) => i.productId))
+ ).sort();
+
+ const lockedProducts = await tx.$queryRaw<Product[]>`
+   SELECT * FROM "Product"
+   WHERE id = ANY(${sortedUniqueProductIds}::uuid[])
+   ORDER BY id ASC
+   FOR UPDATE
+ `;
```

By adding `.sort()`, the lock acquisition sequence is guaranteed to be strictly monotonic across every worker and thread in the cluster.

---

## 4. The Engineering Takeaway

1. **Locks Introduce Deadlocks:** Introducing row-level locks to solve race conditions introduces the new risk of deadlocks. You cannot have one without considering the other.
2. **Reviewing Code is an Engineering Skill:** Great code reviewers do not check formatting or variable naming—linters do that. Great code reviewers look for the subtle edge cases that single-threaded unit tests fail to expose: network timeouts, distributed race conditions, and lock acquisition ordering.
3. **The Thread is the Artifact:** Taking feedback well and engaging deeply in the PR thread is what distinguishes senior engineers. Read the full review exchange in [`reviews-received/MY_PR_TRANSACTIONAL_INVENTORY_LOCKS.md`](./reviews-received/MY_PR_TRANSACTIONAL_INVENTORY_LOCKS.md).

*PR #12 is referenced by number only and is **UNVERIFIED** — no public PR URL is resolvable from this workspace, and none is fabricated here. See the `Source / Link` field in the review-thread file.*

*Built for the Product Engineering Bootcamp (Task 4: Code Review).*
