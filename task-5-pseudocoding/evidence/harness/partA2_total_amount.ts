/**
 * Part A2 evidence — the server-side total computation inside createOrder.
 *
 * HONEST SCOPE NOTE: there is NO exported `calculateOrderTotals` function
 * anywhere in task-1-consumable-api. The only money-touching computation in the
 * whole codebase is the labelled region at
 * task-1-consumable-api/src/services/order.service.ts lines 74-92, which runs
 * inside the real transaction. This harness exercises that real region through
 * the real HTTP endpoint, so the numbers below come from the shipped code.
 */
import { MARKER, check, finishAndExit, header, loadDatabaseUrl, note, prisma } from "./_bootstrap.js";
import request from "supertest";

loadDatabaseUrl();

const PRODUCT_A_PRICE = 200_000; // Item A: 2,000 NGN
const PRODUCT_B_PRICE = 100_000; // Item B: 1,000 NGN
const STOCK = 50;

let categoryId = "";
let productA = "";
let productB = "";
let customerId = "";

header(
  "PART A2 EVIDENCE: server-side total computation (order.service.ts:74-92)",
  "task-1-consumable-api/src/services/order.service.ts :: OrderService.createOrder (totalAmount region)"
);

try {
  const cat = await prisma.category.create({
    data: { name: `${MARKER}-cat-a2-${Date.now()}`, description: "Part A2 evidence fixture" },
  });
  categoryId = cat.id;
  const a = await prisma.product.create({
    data: {
      categoryId,
      name: `${MARKER}-A`,
      description: "Item A",
      price: PRODUCT_A_PRICE,
      stockQuantity: STOCK,
    },
  });
  productA = a.id;
  const b = await prisma.product.create({
    data: {
      categoryId,
      name: `${MARKER}-B`,
      description: "Item B",
      price: PRODUCT_B_PRICE,
      stockQuantity: STOCK,
    },
  });
  productB = b.id;
  const oos = await prisma.product.create({
    data: {
      categoryId,
      name: `${MARKER}-OOS`,
      description: "deliberately out of stock",
      price: 50_000,
      stockQuantity: 0,
    },
  });
  const cust = await prisma.customer.create({
    data: { name: `${MARKER}-customer-a2`, email: `${MARKER}-a2-${Date.now()}@example.com` },
  });
  customerId = cust.id;

  note("product A", { price: PRODUCT_A_PRICE, stock: STOCK });
  note("product B", { price: PRODUCT_B_PRICE, stock: STOCK });
  note("product OOS", { price: 50_000, stock: 0 });
  console.log("");

  const { app } = await import("../../../task-1-consumable-api/src/app.js");

  // ---- Input 1: two distinct products, straightforward accumulation ----
  console.log("--- Input 1: A x2 + B x1 ---");
  const res1 = await request(app)
    .post("/api/v1/orders")
    .send({
      customerId,
      items: [
        { productId: productA, quantity: 2 },
        { productId: productB, quantity: 1 },
      ],
    });
  console.log(`  totalAmount returned: ${res1.body.data?.totalAmount}`);
  console.log(`  lines returned:       ${JSON.stringify(res1.body.data?.items?.map((i: any) => ({ productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice })))}`);
  check("Input 1 HTTP status", res1.status, 201);
  check("Input 1 totalAmount = 200000*2 + 100000*1", res1.body.data?.totalAmount, 500_000);
  check("Input 1 line count", res1.body.data?.items?.length, 2);
  check(
    "Input 1 every unitPrice snapshot equals its catalog price",
    res1.body.data?.items?.every((i: any) => i.unitPrice === (i.productId === productA ? PRODUCT_A_PRICE : PRODUCT_B_PRICE)),
    true
  );
  console.log("");

  // ---- Input 2: out-of-stock product aborts before any total is committed ----
  console.log("--- Input 2: out-of-stock product, quantity 1 ---");
  const res2 = await request(app)
    .post("/api/v1/orders")
    .send({ customerId, items: [{ productId: oos.id, quantity: 1 }] });
  console.log(`  HTTP status:   ${res2.status}`);
  console.log(`  response body: ${JSON.stringify(res2.body)}`);
  check("Input 2 HTTP status", res2.status, 409);
  check("Input 2 error code", res2.body?.error?.code, "CONFLICT");
  const count2 = await prisma.order.count({ where: { customerId } });
  check("Input 2 no order row created", count2, 1);
  console.log("");

  // ---- Input 3: same product repeated, quantities merged before multiplication ----
  console.log("--- Input 3: A x2 then A x3 (duplicate productId merge) ---");
  const res3 = await request(app)
    .post("/api/v1/orders")
    .send({
      customerId,
      items: [
        { productId: productA, quantity: 2 },
        { productId: productA, quantity: 3 },
      ],
    });
  console.log(`  totalAmount returned: ${res3.body.data?.totalAmount}`);
  check("Input 3 HTTP status", res3.status, 201);
  check("Input 3 merged into a single line", res3.body.data?.items?.length, 1);
  check("Input 3 merged quantity is 5", res3.body.data?.items?.[0]?.quantity, 5);
  check("Input 3 totalAmount = 200000 * 5", res3.body.data?.totalAmount, 1_000_000);

  // ---- Arithmetic contract: accumulation is integer, in kobo, no rounding step ----
  console.log("");
  console.log("--- Arithmetic contract asserted by the pseudocode ---");
  const raw = await prisma.$queryRawUnsafe<Array<{ t: number; c: string }>>(
    `SELECT "totalAmount" AS t, "currency" AS c FROM "Order" WHERE id = '${res3.body.data.id}'`
  );
  check("totalAmount stored as an integer column", Number.isInteger(raw[0]!.t), true);
  check("totalAmount value", raw[0]!.t, 1_000_000);
  check("currency column written as NGN", raw[0]!.c, "NGN");
  note(
    "No rounding, no tax, no discount",
    "order.service.ts computes totalAmount purely as the running sum of price * quantity"
  );
} finally {
  console.log("");
  console.log("--- Cleanup (fixtures only; seeded rows untouched) ---");
  try {
    const orders = await prisma.order.findMany({ where: { customerId }, select: { id: true } });
    for (const o of orders) await prisma.orderItem.deleteMany({ where: { orderId: o.id } });
    await prisma.order.deleteMany({ where: { customerId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.product.deleteMany({ where: { categoryId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    console.log("  removed harness category, products, customer and their orders");
  } catch (e) {
    console.error("  CLEANUP FAILED — manual cleanup required:", (e as Error).message);
  }
  await prisma.$disconnect();
}

finishAndExit("partA2 total computation");
