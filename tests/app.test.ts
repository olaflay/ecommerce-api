import { describe, it, expect } from "vitest";
import request from "supertest";
import { app } from "../src/app.js";

describe("Scaffold & Health check", () => {
  it("GET /healthz returns 200 with ok status", async () => {
    const res = await request(app).get("/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
    expect(res.body).toHaveProperty("timestamp");
  });

  it("GET /api/v1/healthz returns 200 with ok status", async () => {
    const res = await request(app).get("/api/v1/healthz");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("status", "ok");
  });

  it("GET /non-existent-route returns 404 with standard error envelope", async () => {
    const res = await request(app).get("/non-existent-route");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
      },
    });
  });
});
