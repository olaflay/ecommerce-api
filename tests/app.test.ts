import { describe, it, expect } from "vitest";
import request from "supertest";
import express from "express";
import { app } from "../src/app.js";
import { errorHandler } from "../src/middleware/errorHandler.js";

describe("Scaffold, Security & Health check", () => {
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

  it("returns 400 with standard envelope on malformed JSON payload", async () => {
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Content-Type", "application/json")
      .send("{ malformed json, missing quote }");
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "BAD_REQUEST",
        message: "Malformed JSON in request body",
      },
    });
  });

  it("confirms 500 error hides stack traces and returns safe generic error envelope (Phase 5 gate)", async () => {
    const testApp = express();
    testApp.get("/test-error-500", () => {
      throw new Error("SensitiveDatabaseConnectionCredentialsLeakHere");
    });
    testApp.use(errorHandler);

    const res = await request(testApp).get("/test-error-500");
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
    expect(res.text).not.toContain("SensitiveDatabaseConnectionCredentialsLeakHere");
    expect(res.text).not.toContain("Error:");
    expect(res.text).not.toContain("at ");
  });
});
