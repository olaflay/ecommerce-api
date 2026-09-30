/**
 * Part A3 evidence — the real centralized `errorHandler` middleware.
 *
 * No database required. Each input drives a real Express app with the real
 * errorHandler mounted, and the harness prints the exact response body so the
 * hand trace in part-a/03 can be checked character for character.
 */
import { check, finishAndExit, header, note } from "./_bootstrap.js";
import express from "express";
import request from "supertest";
import { errorHandler } from "../../../task-1-consumable-api/src/middleware/errorHandler.js";
import { correlationIdMiddleware } from "../../../task-1-consumable-api/src/middleware/correlationId.js";
import { ZodError } from "zod";
import { z } from "zod";
import { Prisma } from "@prisma/client";

header(
  "PART A3 EVIDENCE: centralized errorHandler — real Express responses",
  "task-1-consumable-api/src/middleware/errorHandler.ts :: errorHandler"
);

const SECRET = "SensitiveDatabaseConnectionCredentialsLeakHere";

function appThrowing(makeError: () => unknown) {
  const a = express();
  a.use(express.json({ limit: "100kb" }));
  a.use(correlationIdMiddleware);
  a.get("/boom", () => {
    throw makeError();
  });
  a.post("/boom", () => {
    throw makeError();
  });
  a.use(errorHandler);
  return a;
}

// ---- Input 1: known domain error (NotFoundError -> AppError branch) ----
console.log("--- Input 1: NotFoundError, a known AppError ---");
const { NotFoundError } = await import("../../../task-1-consumable-api/src/types/index.js");
{
  const res = await request(appThrowing(() => new NotFoundError("Product with ID 'xyz' not found"))).get(
    "/boom"
  );
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  console.log(`  X-Request-Id:  ${res.headers["x-request-id"]}`);
  check("Input 1 status", res.status, 404);
  check("Input 1 body", res.body, {
    error: { code: "NOT_FOUND", message: "Product with ID 'xyz' not found" },
  });
  console.log("  NOTE  the correlation id travels in the X-Request-Id response header, NOT in the body");
  console.log("  NOTE  there is no correlationId field in the emitted error envelope");
  console.log("");
}

// ---- Input 2: unknown internal exception (fallback branch, secret leak probe) ----
console.log(`--- Input 2: plain Error("${SECRET}") ---`);
{
  const res = await request(appThrowing(() => new Error(SECRET))).get("/boom");
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  check("Input 2 status", res.status, 500);
  check("Input 2 body", res.body, {
    error: { code: "INTERNAL_ERROR", message: "Internal server error" },
  });
  check("Input 2 response does NOT leak the secret", res.text.includes(SECRET), false);
  check("Input 2 response does NOT contain 'at '", res.text.includes("at "), false);
  check("Input 2 response does NOT contain 'Error:'", res.text.includes("Error:"), false);
  console.log("  NOTE  the real errorCode is INTERNAL_ERROR, not INTERNAL_SERVER_ERROR");
  console.log("");
}

// ---- Input 3: Zod validation failure (422 branch) ----
console.log("--- Input 3: ZodError from a missing required field ---");
{
  const schema = z.object({ customerId: z.string().uuid() });
  const zodErr = (() => {
    try {
      schema.parse({});
      throw new Error("expected the schema to reject an empty object");
    } catch (e) {
      return e as ZodError;
    }
  })();
  const res = await request(appThrowing(() => zodErr)).get("/boom");
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  check("Input 3 status", res.status, 422);
  check("Input 3 error code", res.body?.error?.code, "VALIDATION_ERROR");
  check("Input 3 message", res.body?.error?.message, "Request validation failed");
  check("Input 3 details shape is flattened fieldErrors", res.body?.error?.details, {
    customerId: ["Required"],
  });
  console.log("");
}

// ---- Input 4: real 422 over HTTP through the real validate() middleware ----
console.log("--- Input 4: real HTTP 422 via validate(createOrderSchema) with no customerId ---");
{
  const { validate } = await import("../../../task-1-consumable-api/src/middleware/validate.js");
  const { createOrderSchema } = await import(
    "../../../task-1-consumable-api/src/validation/order.schema.js"
  );
  const a = express();
  a.use(express.json());
  a.post("/api/v1/orders", validate(createOrderSchema), (_req, res) => res.status(201).json({ ok: true }));
  a.use(errorHandler);
  const res = await request(a).post("/api/v1/orders").send({ items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }] });
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  check("Input 4 status", res.status, 422);
  check("Input 4 error code", res.body?.error?.code, "VALIDATION_ERROR");
  check(
    "Input 4 message is built from the first issue as 'field: message'",
    res.body?.error?.message,
    "customerId: Required"
  );
  console.log("  NOTE  the real message is NOT the generic string the old pseudocode claimed");
  console.log("");
}

// ---- Input 5: Prisma P2002 unique constraint (409 CONFLICT branch) ----
console.log("--- Input 5: Prisma.PrismaClientKnownRequestError with code P2002 ---");
{
  const err = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target: ["email"] },
  });
  const res = await request(appThrowing(() => err)).get("/boom");
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  check("Input 5 status", res.status, 409);
  check("Input 5 body", res.body, {
    error: { code: "CONFLICT", message: "A record with this email already exists" },
  });
  console.log("");
}

// ---- Input 6: malformed JSON (400 BAD_REQUEST branch) ----
console.log("--- Input 6: malformed JSON body ---");
{
  const a = express();
  a.use(express.json());
  a.post("/boom", (_req, res) => res.sendStatus(204));
  a.use(errorHandler);
  const res = await request(a).post("/boom").set("Content-Type", "application/json").send("{ malformed json, missing quote }");
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  check("Input 6 status", res.status, 400);
  check("Input 6 body", res.body, {
    error: { code: "BAD_REQUEST", message: "Malformed JSON in request body" },
  });
  console.log("");
}

// ---- Input 7: payload too large (413 branch) ----
console.log("--- Input 7: body larger than the 100kb limit ---");
{
  const a = express();
  a.use(express.json({ limit: "100kb" }));
  a.post("/boom", (_req, res) => res.sendStatus(204));
  a.use(errorHandler);
  const res = await request(a)
    .post("/boom")
    .set("Content-Type", "application/json")
    .send(JSON.stringify({ blob: "x".repeat(200_000) }));
  console.log(`  HTTP status:   ${res.status}`);
  console.log(`  response body: ${JSON.stringify(res.body)}`);
  check("Input 7 status", res.status, 413);
  check("Input 7 error code", res.body?.error?.code, "PAYLOAD_TOO_LARGE");
  console.log("");
}

note(
  "Branch order in the real source",
  "SyntaxError400 -> 413 -> AppError -> ZodError -> PrismaKnown(P2002/P2025) -> PrismaValidation -> 500 fallback"
);

finishAndExit("partA3 errorHandler");
