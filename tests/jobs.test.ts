import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { expireStaleOrders } from "../src/jobs/expireStaleOrders.js";
import { OrderStatus } from "@prisma/client";

describe("Background Jobs: Expired Stale Order Auto-Cancellation", () => {
  let testCustomer: { id: string };
  let testProduct: { id: string; price: number; stockQuantity: number };

  beforeAll(async () => {
    const cust = await prisma.customer.findFirst({ select: { id: true } });
    const prod = await prisma.product.findFirst({
      where: { stockQuantity: { gt: 10 } },
      select: { id: true, price: true, stockQuantity: true },
    });

    if (!cust || !prod) {
      throw new Error("Missing seed data for job tests");
    }

    testCustomer = cust;
    testProduct = prod;
  });

  it("finds stale pending orders, cancels them, and restocks inventory atomically", async () => {
    // 1. Record baseline stock
    const baselineProduct = await prisma.product.findUniqueOrThrow({
      where: { id: testProduct.id },
    });
    const baselineStock = baselineProduct.stockQuantity;

    // 2. Decrement stock and create a stale order backdated by 45 minutes
    const orderQty = 3;
    await prisma.product.update({
      where: { id: testProduct.id },
      data: { stockQuantity: { decrement: orderQty } },
    });

    const staleTimestamp = new Date(Date.now() - 45 * 60 * 1000); // 45 mins ago
    const staleOrder = await prisma.order.create({
      data: {
        customerId: testCustomer.id,
        status: OrderStatus.pending,
        totalAmount: testProduct.price * orderQty,
        currency: "NGN",
        createdAt: staleTimestamp,
        items: {
          create: [
            {
              productId: testProduct.id,
              quantity: orderQty,
              unitPrice: testProduct.price,
            },
          ],
        },
      },
    });

    // 3. Create a recent order (created just now) which should NOT be expired
    const freshOrder = await prisma.order.create({
      data: {
        customerId: testCustomer.id,
        status: OrderStatus.pending,
        totalAmount: testProduct.price,
        currency: "NGN",
        items: {
          create: [
            {
              productId: testProduct.id,
              quantity: 1,
              unitPrice: testProduct.price,
            },
          ],
        },
      },
    });

    // 4. Run the background job targeting stale order
    const result = await expireStaleOrders({ expiryMinutes: 30, orderId: staleOrder.id });

    expect(result.cancelled).toBe(1);
    expect(result.orderIds).toContain(staleOrder.id);
    expect(result.restockedUnits).toBe(orderQty);

    // Also run on fresh order to ensure threshold is honored
    const freshCheckResult = await expireStaleOrders({ expiryMinutes: 30, orderId: freshOrder.id });
    expect(freshCheckResult.cancelled).toBe(0);

    // 5. Verify the stale order transitioned to CANCELLED
    const updatedStaleOrder = await prisma.order.findUniqueOrThrow({
      where: { id: staleOrder.id },
    });
    expect(updatedStaleOrder.status).toBe(OrderStatus.cancelled);

    // 6. Verify the fresh order is still PENDING
    const updatedFreshOrder = await prisma.order.findUniqueOrThrow({
      where: { id: freshOrder.id },
    });
    expect(updatedFreshOrder.status).toBe(OrderStatus.pending);

    // 7. Verify inventory was restored back to baseline
    const finalProduct = await prisma.product.findUniqueOrThrow({
      where: { id: testProduct.id },
    });
    expect(finalProduct.stockQuantity).toBe(baselineStock);

    // Clean up fresh order to leave DB tidy
    await prisma.orderItem.deleteMany({ where: { orderId: freshOrder.id } });
    await prisma.order.delete({ where: { id: freshOrder.id } });
  }, 60000);
});
