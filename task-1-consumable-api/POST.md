# Engineering Deep Dive: What Happens When Someone Asks for 5,000 Records?

> **Bootcamp Task 1 Public Post — Design Decision Analysis**  
> *Author: Olaflay*  
> *Repository: [https://github.com/olaflay/ecommerce-api](https://github.com/olaflay/ecommerce-api)*  
> *Live API: [https://ecommerce-api-xidz.onrender.com/api/v1/products](https://ecommerce-api-xidz.onrender.com/api/v1/products)*  
> *Live Consumer Web App: [https://ecommerce-consumer.onrender.com](https://ecommerce-consumer.onrender.com)*  

---

## 1. The Dilemma: How Should an API Handle `?limit=5000`?

When designing a public REST API, how you handle oversized pagination parameters separates toy projects from resilient production systems.

Suppose a client or third-party scraper hits your catalog with:
```http
GET /api/v1/products?limit=5000&offset=0
```

Most API tutorials handle this in one of two flawed ways:

1. **The Naive Pass-Through (Vulnerability)**  
   The backend translates `limit=5000` directly into SQL: `SELECT * FROM "Product" LIMIT 5000`.  
   *Failure Mode:* A single batch request loads tens of thousands of rows into memory, exhausts the Node.js event loop heap, drains database connection pool workers, and opens the door to trivial denial-of-service (DoS) resource exhaustion.

2. **The Aggressive Rejection (Poor Ergonomics)**  
   The backend checks `if (limit > 100) return 400 Bad Request`.  
   *Failure Mode:* This forces external client developers to write defensive trial-and-error retry loops just to guess your server's arbitrary ceiling.

---

## 2. The Solution: Defensive Limit Clamping & Honest Envelopes

In our platform, we adopted the industry-standard defensive pattern: **Deterministic Limit Clamping**.

### How Clamping Works:
- **Default Page Size:** `20` records.
- **Maximum Ceiling:** `100` records.
- **Behavior under Burst / Extreme Requests:** If a client requests `limit=5000`, the server clamps the limit to `100`, executes the query efficiently using database indexes, and returns an **HTTP 200 OK** with explicit pagination metadata in the response envelope:

```json
{
  "data": [ /* exactly 100 items */ ],
  "meta": {
    "total": 400,
    "limit": 100,
    "offset": 0,
    "hasMore": true
  }
}
```

The client receives data immediately without crashing, while the `meta.limit` field transparently informs their pagination cursor that only 100 items were delivered.

---

## 3. Four Additional Edge Cases Defended

Beyond limit clamping, four critical catalog query traps were resolved:

1. **Negative Offsets (`offset=-10`):**  
   Returns an honest **HTTP 400 Bad Request** (`"Offset cannot be negative"`), preventing SQL syntax errors or unexpected offset wrapping.
2. **Deep Pagination Past Catalog End (`offset=5000`):**  
   Returns an **HTTP 200 OK** with `"data": []` and `"hasMore": false`. It does **not** return a 404, because the query syntax was valid—it simply matched zero remaining records.
3. **Pagination Drift (Tiebreaker Sorting):**  
   Sorting by `createdAt` or `price` can cause identical timestamps across batch inserts. We append a deterministic secondary key:  
   `ORDER BY "createdAt" DESC, "id" ASC`  
   This guarantees that items never duplicate or disappear between page requests during concurrent catalog writes.
4. **Whitelisted Sort Fields:**  
   Attempting to sort by arbitrary columns (`?sort=passwordHash` or `?sort=nonExistent`) is rejected with **HTTP 400 Bad Request**, explicitly listing the allowed fields (`price`, `createdAt`, `name`, `stockQuantity`).

---

## 4. Test It Live from Your Terminal

You can verify this live clamping right now. Open your terminal and paste this curl command hitting our deployed Render instance:

```bash
curl -i "https://ecommerce-api-xidz.onrender.com/api/v1/products?limit=5000"
```

Notice the response:
- `HTTP/1.1 200 OK`
- `meta.limit: 100` (clamped from 5,000)
- `meta.total: 400`
- `meta.hasMore: true`

---

## 5. Submission & Repository Links

* **GitHub Repository:** [https://github.com/olaflay/ecommerce-api](https://github.com/olaflay/ecommerce-api)
* **Live API Base:** [https://ecommerce-api-xidz.onrender.com/api/v1](https://ecommerce-api-xidz.onrender.com/api/v1)
* **Direct Resource URL:** [https://ecommerce-api-xidz.onrender.com/api/v1/products](https://ecommerce-api-xidz.onrender.com/api/v1/products)
* **Live Consumer Web Application:** [https://ecommerce-consumer.onrender.com](https://ecommerce-consumer.onrender.com)
* **Algorithmic Pseudocode:** [https://github.com/olaflay/ecommerce-api/blob/main/PSEUDOCODE.md](https://github.com/olaflay/ecommerce-api/blob/main/PSEUDOCODE.md)
* **System Design & Invariants:** [https://github.com/olaflay/ecommerce-api/blob/main/SYSTEM_DESIGN.md](https://github.com/olaflay/ecommerce-api/blob/main/SYSTEM_DESIGN.md)
* **Deployment & Code Review Audit:** [https://github.com/olaflay/ecommerce-api/blob/main/reviews/live-review-2026-09-16.md](https://github.com/olaflay/ecommerce-api/blob/main/reviews/live-review-2026-09-16.md)
* **Autonomous Background Worker Job:** [https://github.com/olaflay/ecommerce-api/blob/main/src/jobs/expireStaleOrders.ts](https://github.com/olaflay/ecommerce-api/blob/main/src/jobs/expireStaleOrders.ts)

---

## 6. Ready-to-Publish LinkedIn Post Copy

```text
What does your API do when a client requests ?limit=5000?

If you honour it without question, one scraper or heavy user will exhaust your database connection pool and spike memory usage.

If you reject it with a 400 Bad Request, you force clients to write custom retry loops just to guess your arbitrary ceiling.

While building out Task 1 for the Product Engineering Bootcamp, I chose the conventional defensiveness standard: limit clamping.

Here is the contract:
• Default page size: 20 records.
• Permitted maximum: 100 records.
• If a client requests limit=5000, the API clamps the limit to 100, returns HTTP 200, and specifies { "meta": { "limit": 100, "total": 400, "hasMore": true } }.

To guard the query further:
1. Negative offsets return an honest 400 Bad Request instead of overflowing or defaulting silently.
2. Requesting past the end of the collection (e.g. offset=1000 on a 400-item table) returns HTTP 200 with an empty array [] and hasMore: false (never a 404, because the query was valid).
3. A deterministic tiebreaker (ORDER BY createdAt DESC, id ASC) stops items from hopping between pages during active writes.

Paste this into your terminal right now to see the clamping in action against the live production server:
curl -i "https://ecommerce-api-xidz.onrender.com/api/v1/products?limit=5000"

Live API: https://ecommerce-api-xidz.onrender.com/api/v1/products
Live Consumer Client: https://ecommerce-consumer.onrender.com
GitHub Repo: https://github.com/olaflay/ecommerce-api

How do you usually handle oversized pagination requests on your public endpoints?
```
