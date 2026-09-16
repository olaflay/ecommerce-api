# LinkedIn Post Draft — E-Commerce API & Consumer Client Project

Use this ready-to-publish post to showcase your project on LinkedIn. Pair it with the screenshots in this folder (`consumer_app_loaded.png` and `consumer_app_filtered.png`).

---

## Post Copy

Building an e-commerce API sounds straightforward—until two customers click "Buy Now" on the last in-stock item at the exact same millisecond. 🛒⚡

Over the past few days, I built and deployed a production-grade E-Commerce Catalog & Ordering REST API paired with a Material Design 3 consumer catalog.

Rather than just building basic CRUD routes, I focused heavily on real-world engineering constraints:

🔒 Concurrency & Stock Integrity:
Implemented row-level database locking (SELECT ... FOR UPDATE) inside transactional blocks. If two simultaneous requests race for the final unit of inventory, exactly one succeeds and the other receives a clean 409 Conflict. Inventory never drops below zero.

💰 Strict Financial Precision:
Eliminated floating-point rounding bugs by storing all currency values as integers in minor units (kobo). Order totals are strictly re-computed server-side from snapshot prices, rejecting any client-supplied totals.

🚦 Order Lifecycle State Machine:
Enforced strict transition gates (pending ➔ paid ➔ shipped ➔ delivered). Deleting orders is only permissible in "pending" status, automatically restocking inventory before cascading deletions.

🛡️ Production Hardening:
• Config-driven rate limiting with Retry-After headers and reverse-proxy trust
• 100kb payload ceiling to prevent trivial payload DoS
• Centralized error masking with correlation IDs (X-Request-Id) to prevent internal stack leakages
• Automated seed pipeline generating 400 products, 40 categories, and 800 distributed orders

🌐 Live Deployments:
• Consumer Client: https://ecommerce-consumer.onrender.com
• REST API: https://ecommerce-api-xidz.onrender.com

Tech stack: Node.js, TypeScript, Express, Prisma ORM, PostgreSQL, Vite, React, Material Design 3.

Huge thanks to the community for the continuous feedback! Would love to hear your thoughts on concurrency handling patterns in relational databases.

#SoftwareEngineering #Backend #WebDevelopment #TypeScript #PostgreSQL #Prisma #NodeJS #SystemDesign #FullStack
