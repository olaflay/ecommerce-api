/**
 * Part A1 evidence — `OrderService.createOrder` (real code, real database).
 *
 * Drives the real Express app with supertest against the real Prisma/Postgres
 * stack, using fixtures this harness creates and deletes itself.
 *
 * Produces evidence for part-a/01_own_complex_create_order.md.
 */
import { MARKER, check, finishAndExit, header, loadDatabaseUrl, note, prisma } from "./_bootstrap.js";
import request from "supertest";

loadDatabaseUrl();

const PRICE = 500_000; // 5,000 NGN in kobo, matching the hand trace
const STOCK = 10;

let categoryId = "";
let productId = "";
let customerId = "";

header(
  "PART A1 EVIDENCE: createOrder — real HTTP request, real Postgres transaction",
  "task-1-consumable-api/src/services/order.service.ts :: OrderService.createOrder"
);

try {
  const cat = await prisma.category.create({
    data: { name: `${MARKER}-cat-${Date.now()}`, description: "Part A1 evidence fixture" },
  });
  categoryId = cat.id;
  const prod = await prisma.product.create({
    data: {
      categoryId,
      name: `${MARKER}-product`,
      description: "Part A1 evidence fixture",
      price: PRICE,
      stockQuantity: STOCK,
    },
  });
  productId = prod.id;
  const cust = await prisma.customer.create({
    data: { name: `${MARKER}-customer`, email: `${MARKER}-${Date.now()}@example.com` },
  });
  customerId = cust.id;

  note("fixture product", { id: productId, price: PRICE, stockQuantity: STOCK });
  note("fixture customer", { id: customerId });
  note("fixture category", { id: categoryId });
  console.log("");

  const { app } = await import("../../../task-1-consumable-api/src/app.js");

  // ---- Input 1: happy path, quantity 2 ----
  console.log("--- Input 1: happy path, items [{productId, quantity: 2}] ---");
  const before = await prisma.product.findUnique({ where: { id: productId } });
  const res1 = await request(app)
    .post("/api/v1/orders")
    .send({ customerId, items: [{ productId, quantity: 2 }] });
  const after = await prisma.product.findUnique({ where: { id: productId } });
  console.log(`  HTTP status:            ${res1.status}`);
  console.log(`  response data:          ${JSON.stringify(res1.body.data, null, 2)}`);
  check("Input 1 HTTP status", res1.status, 201);
  check("Input 1 order status", res1.body.data?.status, "pending");
  check("Input 1 totalAmount = price * quantity", res1.body.data?.totalAmount, PRICE * 2);
  check("Input 1 currency written", res1.body.data?.currency, "NGN");
  check("Input 1 order item count", res1.body.data?.items?.length, 1);
  check("Input 1 unit price snapshotted", res1.body.data?.items?.[0]?.unitPrice, PRICE);
  check("Input 1 stock decremented by 2", after!.stockQuantity, before!.stockQuantity - 2);
  console.log("");

  // ---- Input 1b: duplicate productIds are merged and summed ----
  console.log("--- Input 1b: duplicate productIds merged and summed ---");
  const before1b = await prisma.product.findUnique({ where: { id: productId } });
  const res1b = await request(app)
    .post("/api/v1/orders")
    .send({
      customerId,
      items: [
        { productId, quantity: 1 },
        { productId, quantity: 2 },
      ],
    });
  const after1b = await prisma.product.findUnique({ where: { id: productId } });
  check("Input 1b HTTP status", res1b.status, 201);
  check("Input 1b merged into 1 line item", res1b.body.data?.items?.length, 1);
  check("Input 1b quantity summed to 3", res1b.body.data?.items?.[0]?.quantity, 3);
  check("Input 1b totalAmount = price * 3", res1b.body.data?.totalAmount, PRICE * 3);
  check(
    "Input 1b stock decremented once by 3",
    after1b!.stockQuantity,
    before1b!.stockQuantity - 3
  );
  console.log("");

  // ---- Input 2: insufficient stock -> 409 ----
  console.log("--- Input 2: edge case, quantity exceeds stock ---");
  const res2 = await request(app)
    .post("/api/v1/orders")
    .send({ customerId, items: [{ productId, quantity: 999 }] });
  console.log(`  HTTP status:            ${res2.status}`);
  console.log(`  response body:          ${JSON.stringify(res2.body)}`);
  check("Input 2 HTTP status", res2.status, 409);
  check("Input 2 error code", res2.body?.error?.code, "CONFLICT");
  check(
    "Input 2 message names the shortage",
    /Insufficient stock/.test(res2.body?.error?.message ?? ""),
    true
  );
  const after2 = await prisma.product.findUnique({ where: { id: productId } });
  check("Input 2 stock unchanged (transaction rolled back)", after2!.stockQuantity, after1b!.stockQuantity);
  const ordersAfter2 = await prisma.order.count({ where: { customerId } });
  check("Input 2 no order row written (rollback)", ordersAfter2, 2);
  console.log("");

  // ---- Input 3: unknown customer -> 404 ----
  console.log("--- Input 3: invalid case, customerId does not exist ---");
  const res3 = await request(app)
    .post("/api/v1/orders")
    .send({
      customerId: "00000000-0000-0000-0000-000000000000",
      items: [{ productId, quantity: 1 }],
    });
  console.log(`  HTTP status:            ${res3.status}`);
  console.log(`  response body:          ${JSON.stringify(res3.body)}`);
  check("Input 3 HTTP status", res3.status, 404);
  check("Input 3 error code", res3.body?.error?.code, "NOT_FOUND");
  check("Input 3 message", res3.body?.error?.message, "Customer not found");
  console.log("");

  // ---- Input 4: unknown product -> 404 (covers the SELECT ... FOR UPDATE miss) ----
  console.log("--- Input 4: invalid case, productId does not exist ---");
  const res4 = await request(app)
    .post("/api/v1/orders")
    .send({
      customerId,
      items: [{ productId: "00000000-0000-0000-0000-000000000000", quantity: 1 }],
    });
  check("Input 4 HTTP status", res4.status, 404);
  check("Input 4 error code", res4.body?.error?.code, "NOT_FOUND");
  check(
    "Input 4 message names the missing product",
    /Product not found/.test(res4.body?.error?.message ?? ""),
    true
  );
  console.log("");

  // ---- Structural facts asserted by the pseudocode ----
  console.log("--- Structural facts claimed by the pseudocode ---");
  const raw = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "OrderItem" WHERE "orderId" = '${res1.body.data.id}'`
  );
  check("orderItems written equal merged item count", raw[0]!.n, 1);
  const uniqIdx = await prisma.$queryRawUnsafe<Array<{ n: number }>>(
    `SELECT count(*)::int AS n FROM "OrderItem" WHERE "orderId" = '${res1.body.data.id}' AND "unitPrice" <> ${PRICE}`
  );
  check("no orderItem carries a non-snapshotted unitPrice", uniqIdx[0]!.n, 0);
  note("No deadlock-avoidance sort exists in the source", "productIds are passed to WHERE id = ANY(...) as-is");
} finally {
  console.log("");
  console.log("--- Cleanup (fixtures only; seeded rows untouched) ---");
  try {
    const orders = await prisma.order.findMany({ where: { customerId }, select: { id: true } });
    for (const o of orders) {
      await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
    }
    await prisma.order.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    console.log("  removed harness category, product, customer and their orders");
  } catch (e) {
    console.error("  CLEANUP FAILED — manual cleanup required:", (e as Error).message);
  }
  await prisma.$disconnect();
}

finishAndExit("partA1 createOrder");
