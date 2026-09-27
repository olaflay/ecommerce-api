import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

describe("Catalog Endpoints (Categories, Products, Customers)", () => {
  let sampleCategory: { id: string; name: string };
  let sampleProduct: { id: string; name: string; price: number };
  let sampleCustomer: { id: string; name: string; email: string };

  beforeAll(async () => {
    const cat = await prisma.category.findFirst({
      where: { name: { not: { startsWith: "Race-Test" } } },
      select: { id: true, name: true },
    });
    const prod = await prisma.product.findFirst({
      where: { name: { not: { startsWith: "Last Unit" } } },
      select: { id: true, name: true, price: true },
    });
    const cust = await prisma.customer.findFirst({
      where: { email: { not: { contains: "racer" } } },
      select: { id: true, name: true, email: true },
    });

    if (!cat || !prod || !cust) {
      throw new Error("Test setup failed: Seed data must be present in database");
    }

    sampleCategory = cat;
    sampleProduct = prod;
    sampleCustomer = cust;
  });

  describe("GET /api/v1/categories", () => {
    it("returns 200 with collection envelope and pagination meta", async () => {
      const res = await request(app).get("/api/v1/categories");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body).toHaveProperty("meta");
      expect(res.body.meta).toHaveProperty("total");
      expect(res.body.meta.limit).toBe(20);
      expect(res.body.meta.offset).toBe(0);
    });

    it("clamps limit > 100 to 100 per PRD §8", async () => {
      const res = await request(app).get("/api/v1/categories?limit=5000");
      expect(res.status).toBe(200);
      expect(res.body.meta.limit).toBe(100);
    });

    it("returns 400 when limit <= 0 or non-numeric", async () => {
      const zeroRes = await request(app).get("/api/v1/categories?limit=0");
      expect(zeroRes.status).toBe(400);
      expect(zeroRes.body.error.code).toBe("BAD_REQUEST");

      const textRes = await request(app).get("/api/v1/categories?limit=abc");
      expect(textRes.status).toBe(400);
      expect(textRes.body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 400 on negative offset", async () => {
      const res = await request(app).get("/api/v1/categories?offset=-5");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 200 with empty data when offset is beyond dataset", async () => {
      const res = await request(app).get("/api/v1/categories?offset=99999");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
      expect(res.body.meta.hasMore).toBe(false);
    });
  });

  describe("GET /api/v1/categories/:id", () => {
    it("returns 200 with single envelope for valid existing category", async () => {
      const res = await request(app).get(`/api/v1/categories/${sampleCategory.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toHaveProperty("id", sampleCategory.id);
      expect(res.body.data).toHaveProperty("name", sampleCategory.name);
    });

    it("returns 400 for malformed UUID format", async () => {
      const res = await request(app).get("/api/v1/categories/not-a-valid-uuid");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
    });

    it("returns 404 for valid-format UUID that does not exist", async () => {
      const res = await request(app).get(
        "/api/v1/categories/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("GET /api/v1/categories/:id/products", () => {
    it("returns 404 if category does not exist", async () => {
      const res = await request(app).get(
        "/api/v1/categories/00000000-0000-0000-0000-000000000000/products"
      );
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("NOT_FOUND");
    });

    it("returns 200 with products belonging to existing category", async () => {
      const res = await request(app).get(
        `/api/v1/categories/${sampleCategory.id}/products`
      );
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("data");
      expect(res.body).toHaveProperty("meta");
    });
  });

  describe("GET /api/v1/products", () => {
    it("returns 200 with collection envelope", async () => {
      const res = await request(app).get("/api/v1/products");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.meta.total).toBeGreaterThan(0);
    });

    it("filters products by inStock=true", async () => {
      const res = await request(app).get("/api/v1/products?inStock=true");
      expect(res.status).toBe(200);
      for (const product of res.body.data) {
        expect(product.stockQuantity).toBeGreaterThan(0);
      }
    });

    it("filters products by inStock=false", async () => {
      const res = await request(app).get("/api/v1/products?inStock=false");
      expect(res.status).toBe(200);
      for (const product of res.body.data) {
        expect(product.stockQuantity).toBe(0);
      }
    });

    it("returns 400 when minPrice > maxPrice (inverted range)", async () => {
      const res = await request(app).get(
        "/api/v1/products?minPrice=500000&maxPrice=100000"
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("minPrice cannot exceed maxPrice");
    });

    it("returns 400 when unsupported sort field is requested", async () => {
      const res = await request(app).get("/api/v1/products?sort=nonExistentField");
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Unsupported sort field");
    });

    it("returns 400 when multiple sort parameters are provided", async () => {
      const res = await request(app).get(
        "/api/v1/products?sort=price&sort=name"
      );
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("BAD_REQUEST");
      expect(res.body.error.message).toContain("Only one sort field is supported");
    });
  });

  describe("GET /api/v1/products/:id", () => {
    it("returns 200 for valid existing product", async () => {
      const res = await request(app).get(`/api/v1/products/${sampleProduct.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(sampleProduct.id);
    });

    it("returns 400 for malformed UUID", async () => {
      const res = await request(app).get("/api/v1/products/abc");
      expect(res.status).toBe(400);
    });

    it("returns 404 for non-existent UUID", async () => {
      const res = await request(app).get(
        "/api/v1/products/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/customers & /api/v1/customers/:id", () => {
    it("returns 200 with paginated customers", async () => {
      const res = await request(app).get("/api/v1/customers");
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("returns 200 for single customer by ID", async () => {
      const cust = await prisma.customer.findFirstOrThrow();
      const res = await request(app).get(`/api/v1/customers/${cust.id}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(cust.id);
    });

    it("returns 404 for unknown customer ID", async () => {
      const res = await request(app).get(
        "/api/v1/customers/00000000-0000-0000-0000-000000000000"
      );
      expect(res.status).toBe(404);
    });
  });
});
