import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("Order Write Path & State Machine (/api/v1/orders)", () => {
  let testCustomer: { id: string };
  let inStockProduct1: { id: string; price: number; stockQuantity: number };
  let inStockProduct2: { id: string; price: number; stockQuantity: number };
  let outOfStockProduct: { id: string };

  beforeAll(async () => {
    const cust = await prisma.customer.findFirst({ select: { id: true } });
    const prods = await prisma.product.findMany({
      where: { stockQuantity: { gt: 10 } },
      take: 2,
      select: { id: true, price: true, stockQuantity: true },
    });
    const oos = await prisma.product.findFirst({
      where: { stockQuantity: 0 },
      select: { id: true },
    });

    if (!cust || prods.length < 2 || !oos) {
      throw new Error("Setup failed: Missing required seed data for order tests");
    }

    testCustomer = cust;
    inStockProduct1 = prods[0]!;
    inStockProduct2 = prods[1]!;
    outOfStockProduct = oos;
  });

  describe("POST /api/v1/orders", () => {
    it("successfully creates order, computes totalAmount server-side, and decrements stock", async () => {
      const initialProduct = await prisma.product.findUnique({
        where: { id: inStockProduct1.id },
      });
      const initialStock = initialProduct!.stockQuantity;

      const orderPayload = {
        customerId: testCustomer.id,
        items: [{ productId: inStockProduct1.id, quantity: 2 }],
      };

      const res = await request(app).post("/api/v1/orders").send(orderPayload);
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveProperty("id");
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data.totalAmount).toBe(inStockProduct1.price * 2);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].unitPrice).toBe(inStockProduct1.price);

      // Verify stock was decremented in database
      const updatedProduct = await prisma.product.findUnique({
        where: { id: inStockProduct1.id },
      });
      expect(updatedProduct!.stockQuantity).toBe(initialStock - 2);
    });

    it("merges duplicate productIds in items array into one line item with summed quantity", async () => {
      const initialProduct = await prisma.product.findUnique({
        where: { id: inStockProduct2.id },
      });
      const initialStock = initialProduct!.stockQuantity;

      const orderPayload = {
        customerId: testCustomer.id,
        items: [
          { productId: inStockProduct2.id, quantity: 1 },
          { productId: inStockProduct2.id, quantity: 2 },
        ],
      };

      const res = await request(app).post("/api/v1/orders").send(orderPayload);
      expect(res.status).toBe(201);
      expect(res.body.data.items.length).toBe(1);
      expect(res.body.data.items[0].quantity).toBe(3);
      expect(res.body.data.totalAmount).toBe(inStockProduct2.price * 3);

      const updatedProduct = await prisma.product.findUnique({
        where: { id: inStockProduct2.id },
      });
      expect(updatedProduct!.stockQuantity).toBe(initialStock - 3);
    });

    it("returns 422 when items array is empty", async () => {
      const res = await request(app)
        .post("/api/v1/orders")
        .send({ customerId: testCustomer.id, items: [] });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 422 on unexpected fields in strict schema", async () => {
      const res = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: inStockProduct1.id, quantity: 1 }],
          discountCoupon: "BLACKFRIDAY",
        });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("VALIDATION_ERROR");
    });

    it("returns 404 if customerId does not exist", async () => {
      const res = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: "00000000-0000-0000-0000-000000000000",
          items: [{ productId: inStockProduct1.id, quantity: 1 }],
        });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 404 if a productId does not exist", async () => {
      const res = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
        });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 409 Conflict when requesting more stock than available", async () => {
      const res = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: outOfStockProduct.id, quantity: 1 }],
        });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("CONFLICT");
      expect(res.body.error.message).toContain("Insufficient stock");
    });
  });

  describe("PATCH /api/v1/orders/:id (State Machine)", () => {
    it("transitions order through valid states (pending -> paid -> shipped -> delivered)", async () => {
      // Create fresh order
      const createRes = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: inStockProduct1.id, quantity: 1 }],
        });
      const orderId = createRes.body.data.id;

      // pending -> paid
      const paidRes = await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .send({ status: "paid" });
      expect(paidRes.status).toBe(200);
      expect(paidRes.body.data.status).toBe("paid");

      // idempotent same-status PATCH (paid -> paid)
      const sameRes = await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .send({ status: "paid" });
      expect(sameRes.status).toBe(200);
      expect(sameRes.body.data.status).toBe("paid");

      // paid -> shipped
      const shippedRes = await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .send({ status: "shipped" });
      expect(shippedRes.status).toBe(200);
      expect(shippedRes.body.data.status).toBe("shipped");

      // shipped -> delivered
      const deliveredRes = await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .send({ status: "delivered" });
      expect(deliveredRes.status).toBe(200);
      expect(deliveredRes.body.data.status).toBe("delivered");
    });

    it("returns 409 Conflict on illegal status transition", async () => {
      // Create pending order
      const createRes = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: inStockProduct1.id, quantity: 1 }],
        });
      const orderId = createRes.body.data.id;

      // pending -> delivered is illegal (must go through paid, shipped)
      const illegalRes = await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .send({ status: "delivered" });
      expect(illegalRes.status).toBe(409);
      expect(illegalRes.body.error.code).toBe("CONFLICT");
      expect(illegalRes.body.error.message).toContain("Illegal status transition");
    });
  });

  describe("DELETE /api/v1/orders/:id", () => {
    it("deletes a pending order with 204 No Content and restocks inventory", async () => {
      const initialProduct = await prisma.product.findUnique({
        where: { id: inStockProduct1.id },
      });
      const stockBeforeOrder = initialProduct!.stockQuantity;

      // Create order
      const createRes = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: inStockProduct1.id, quantity: 2 }],
        });
      const orderId = createRes.body.data.id;

      // Stock should have decreased by 2
      const intermediateProduct = await prisma.product.findUnique({
        where: { id: inStockProduct1.id },
      });
      expect(intermediateProduct!.stockQuantity).toBe(stockBeforeOrder - 2);

      // DELETE pending order
      const delRes = await request(app).delete(`/api/v1/orders/${orderId}`);
      expect(delRes.status).toBe(204);
      expect(delRes.text).toBe("");

      // Stock should now be restored to original stockBeforeOrder
      const finalProduct = await prisma.product.findUnique({
        where: { id: inStockProduct1.id },
      });
      expect(finalProduct!.stockQuantity).toBe(stockBeforeOrder);

      // Order should no longer exist
      const getRes = await request(app).get(`/api/v1/orders/${orderId}`);
      expect(getRes.status).toBe(404);
    });

    it("returns 409 Conflict when attempting to delete non-pending order", async () => {
      const createRes = await request(app)
        .post("/api/v1/orders")
        .send({
          customerId: testCustomer.id,
          items: [{ productId: inStockProduct1.id, quantity: 1 }],
        });
      const orderId = createRes.body.data.id;

      // Transition to paid
      await request(app)
        .patch(`/api/v1/orders/${orderId}`)
        .send({ status: "paid" });

      // Attempt deletion
      const delRes = await request(app).delete(`/api/v1/orders/${orderId}`);
      expect(delRes.status).toBe(409);
      expect(delRes.body.error.code).toBe("CONFLICT");
      expect(delRes.body.error.message).toContain("Only pending orders can be deleted");
    });
  });
});
