---
name: prisma-schema-and-seed
description: Schema rules, onDelete relationships, indexing strategy, check constraints, and seed idempotency.
---

# prisma-schema-and-seed

**Load during:** Phase 1 and Phase 2
**Trigger:** editing `schema.prisma` or `seed.ts`

- Every FK's `onDelete` behavior is deliberate, not default: `Restrict` everywhere except `OrderItem → Order`, which is `Cascade` (line items have no independent meaning without their order).
- Indexes exist only where an actual query needs them (`Product.categoryId`, `Product.price`, `Order.customerId`, `Order.status`, `Order.createdAt`, both `OrderItem` FKs, unique `Customer.email`). Don't index every column — that's a filler metric, not a real gate criterion.
- Check constraints at the DB level: `stockQuantity >= 0`, `price > 0`, `quantity >= 1`, `unitPrice > 0` — defense in depth even if app-level validation should already catch these.
- `Customer.email` is lowercased on write and uniquely indexed on the lowercased value — case-insensitive uniqueness, not Postgres's default case-sensitive behavior.
- Seed script: `faker.seed(42)` fixed at the top for reproducibility; truncate-and-regenerate strategy (not upsert) since Faker data has no natural stable keys; deliberately force at least some `stockQuantity: 0` products and at least one order per status, rather than leaving that to random chance.
- Seed is destructive by design — document that loudly, and never wire it into an automatic deploy pipeline (Phase 7 runs it manually, once).
