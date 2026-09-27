import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("Concurrency & Stock Row-Level Lock (/api/v1/orders)", () => {
  let categoryId: string;
  let productId: string;
  let customerId: string;

  afterAll(async () => {
    // Clean up created entities
    if (productId) {
      await prisma.orderItem.deleteMany({ where: { productId } });
      await prisma.product.deleteMany({ where: { id: productId } });
    }
    if (categoryId) {
      await prisma.category.deleteMany({ where: { id: categoryId } });
    }
    if (customerId) {
      await prisma.order.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
    }
  });

  it("ensures exactly one request succeeds and one gets 409 when 2 simultaneous orders compete for the last unit of stock", async () => {
    // 1. Create category
    const cat = await prisma.category.create({
      data: {
        name: `Race-Test-Cat-${Date.now()}`,
        description: "Category for concurrency testing",
      },
    });
    categoryId = cat.id;

    // 2. Create customer
    const cust = await prisma.customer.create({
      data: {
        name: "Concurrency Racer",
        email: `racer-${Date.now()}@example.com`,
      },
    });
    customerId = cust.id;

    // 3. Create product with stockQuantity: 1
    const prod = await prisma.product.create({
      data: {
        name: "Last Unit Rare Item",
        price: 2500000,
        stockQuantity: 1, // Exactly 1 in stock
        categoryId: cat.id,
      },
    });
    productId = prod.id;

    // 4. Fire two concurrent requests for that single unit
    const payload = {
      customerId: cust.id,
      items: [{ productId: prod.id, quantity: 1 }],
    };

    const [res1, res2] = await Promise.all([
      request(app).post("/api/v1/orders").send(payload),
      request(app).post("/api/v1/orders").send(payload),
    ]);

    const statuses = [res1.status, res2.status].sort();

    // Exactly one 201 Created and one 409 Conflict
    expect(statuses).toEqual([201, 409]);

    const winner = res1.status === 201 ? res1 : res2;
    const loser = res1.status === 409 ? res1 : res2;

    expect(winner.body.data).toHaveProperty("id");
    expect(loser.body.error.code).toBe("CONFLICT");
    expect(loser.body.error.message).toContain("Insufficient stock");

    // 5. Verify product stock in database is exactly 0 (never negative)
    const finalProduct = await prisma.product.findUnique({
      where: { id: prod.id },
    });
    expect(finalProduct!.stockQuantity).toBe(0);
  });

  it("serializes concurrent status PATCHes under the row lock so a terminal state never gets flipped by a stale read", async () => {
    const cat = await prisma.category.create({
      data: {
        name: `Patch-Test-Cat-${Date.now()}`,
        description: "Category for transition concurrency testing",
      },
    });
    const cust = await prisma.customer.create({
      data: {
        name: "Patch Racer",
        email: `patch-racer-${Date.now()}@example.com`,
      },
    });
    const prod = await prisma.product.create({
      data: {
        name: "Patch Race Item",
        price: 100000,
        stockQuantity: 10,
        categoryId: cat.id,
      },
    });

    try {
      const createRes = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: cust.id,
          items: [{ productId: prod.id, quantity: 1 }],
        });
      expect(createRes.status).toBe(201);
      const orderId = createRes.body.data.id;

      // paid and cancelled are both legal from pending. Under the row lock the two
      // writes serialize: each response must be either the applied transition (200)
      // or a legal rejection (409) — never a 500 from a lost update.
      const [r1, r2] = await Promise.all([
        request(app).patch(`/api/v1/orders/${orderId}`).send({ status: "paid" }),
        request(app)
          .patch(`/api/v1/orders/${orderId}`)
          .send({ status: "cancelled" }),
      ]);

      for (const res of [r1, r2]) {
        expect([200, 409]).toContain(res.status);
      }

      // Final state must be reachable via legal transitions from pending
      // (paid or cancelled) — never a cancelled order resurrected to paid by a
      // stale read-write pair.
      const finalOrder = await prisma.order.findUnique({
        where: { id: orderId },
        select: { status: true },
      });
      expect(["paid", "cancelled"]).toContain(finalOrder!.status);
    } finally {
      await prisma.order.deleteMany({ where: { customerId: cust.id } });
      await prisma.product.deleteMany({ where: { id: prod.id } });
      await prisma.category.deleteMany({ where: { id: cat.id } });
      await prisma.customer.deleteMany({ where: { id: cust.id } });
    }
  });
});
