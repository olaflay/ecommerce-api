import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("Database Storage-Level CHECK Constraints & Correlation Tracing", () => {
  let testCategoryId: string;

  beforeAll(async () => {
    const cat = await prisma.category.create({
      data: {
        name: `Constraint-Test-${Date.now()}`,
        description: "Testing DB CHECK constraints",
      },
    });
    testCategoryId = cat.id;
  });

  afterAll(async () => {
    if (testCategoryId) {
      await prisma.product.deleteMany({ where: { categoryId: testCategoryId } });
      await prisma.category.deleteMany({ where: { id: testCategoryId } });
    }
  });

  describe("PostgreSQL CHECK Constraints (PRD §14)", () => {
    it("rejects product with negative stockQuantity (check_product_stock_non_negative)", async () => {
      await expect(
        prisma.product.create({
          data: {
            name: "Illegal Negative Stock Product",
            price: 10000,
            stockQuantity: -5,
            categoryId: testCategoryId,
          },
        })
      ).rejects.toThrow(/check_product_stock_non_negative/);
    });

    it("rejects product with zero or negative price (check_product_price_positive)", async () => {
      await expect(
        prisma.product.create({
          data: {
            name: "Illegal Zero Price Product",
            price: 0,
            stockQuantity: 10,
            categoryId: testCategoryId,
          },
        })
      ).rejects.toThrow(/check_product_price_positive/);
    });
  });

  describe("Request Tracing & Correlation ID", () => {
    it("attaches X-Request-Id header to every API response", async () => {
      const res = await request(app).get("/healthz");
      expect(res.status).toBe(200);
      expect(res.headers).toHaveProperty("x-request-id");
      expect(res.headers["x-request-id"]).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    });

    it("propagates client-supplied X-Request-Id", async () => {
      const customId = "client-trace-id-12345";
      const res = await request(app)
        .get("/healthz")
        .set("X-Request-Id", customId);
      expect(res.status).toBe(200);
      expect(res.headers["x-request-id"]).toBe(customId);
    });
  });
});
