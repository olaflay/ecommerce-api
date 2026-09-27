import { OrderStatus } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export interface StaleOrderJobResult {
  scanned: number;
  cancelled: number;
  restockedUnits: number;
  orderIds: string[];
  elapsedMs: number;
}

export interface ExpireStaleOrdersOptions {
  expiryMinutes?: number;
  batchSize?: number;
  orderId?: string;
}

/**
 * Background job to find pending orders that have exceeded the expiry threshold,
 * cancel them, and return reserved inventory back to the product catalog atomically.
 */
export async function expireStaleOrders(
  optionsOrMinutes: number | ExpireStaleOrdersOptions = 30,
  legacyBatchSize = 100
): Promise<StaleOrderJobResult> {
  const options: ExpireStaleOrdersOptions =
    typeof optionsOrMinutes === "number"
      ? { expiryMinutes: optionsOrMinutes, batchSize: legacyBatchSize }
      : {
          expiryMinutes: optionsOrMinutes.expiryMinutes ?? 30,
          batchSize: optionsOrMinutes.batchSize ?? 100,
          orderId: optionsOrMinutes.orderId,
        };

  const expiryMinutes = options.expiryMinutes ?? 30;
  const batchSize = options.batchSize ?? 100;
  const startTime = Date.now();
  const cutoffDate = new Date(Date.now() - expiryMinutes * 60 * 1000);

  // 1. Identify candidate stale pending orders
  const candidateOrders = await prisma.order.findMany({
    where: {
      status: OrderStatus.pending,
      createdAt: { lte: cutoffDate },
      ...(options.orderId ? { id: options.orderId } : {}),
    },
    select: { id: true, createdAt: true },
    orderBy: { createdAt: "asc" },
    take: batchSize,
  });

  const cancelledOrderIds: string[] = [];
  let totalRestockedUnits = 0;

  // 2. Process each candidate order inside an isolated interactive transaction with row locking
  for (const candidate of candidateOrders) {
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Lock the order row to prevent race conditions with concurrent customer checkout/payment
          const rows = await tx.$queryRaw<Array<{ id: string; status: OrderStatus }>>`
            SELECT id, status FROM "Order" WHERE id = ${candidate.id}::uuid FOR UPDATE
          `;

          if (rows.length === 0 || rows[0]!.status !== OrderStatus.pending) {
            // Order was already deleted or transitioned concurrently by customer
            return null;
          }

          // Fetch items to restock
          const items = await tx.orderItem.findMany({
            where: { orderId: candidate.id },
            select: { productId: true, quantity: true },
          });

          let unitsRestocked = 0;
          for (const item of items) {
            await tx.product.update({
              where: { id: item.productId },
              data: {
                stockQuantity: { increment: item.quantity },
              },
            });
            unitsRestocked += item.quantity;
          }

          // Transition status to cancelled
          await tx.order.update({
            where: { id: candidate.id },
            data: { status: OrderStatus.cancelled },
          });

          return { orderId: candidate.id, unitsRestocked };
        },
        { maxWait: 10000, timeout: 20000 }
      );

      if (result) {
        cancelledOrderIds.push(result.orderId);
        totalRestockedUnits += result.unitsRestocked;
      }
    } catch (error) {
      console.error(
        `[Background Job] Error cancelling stale order ${candidate.id}:`,
        error
      );
    }
  }

  const elapsedMs = Date.now() - startTime;
  return {
    scanned: candidateOrders.length,
    cancelled: cancelledOrderIds.length,
    restockedUnits: totalRestockedUnits,
    orderIds: cancelledOrderIds,
    elapsedMs,
  };
}

/**
 * Worker execution loop for long-running daemon processes or containerized workers.
 */
export async function startOrderExpiryWorker(
  intervalMs = 60000 * 5,
  expiryMinutes = 30
) {
  console.log(
    `[Background Worker] Initialized: checking for stale orders every ${
      intervalMs / 1000
    }s (expiry threshold: ${expiryMinutes}m)`
  );

  const runTick = async () => {
    try {
      console.log(`[Background Worker] Executing stale order cleanup tick...`);
      const result = await expireStaleOrders(expiryMinutes);
      if (result.cancelled > 0) {
        console.log(
          `[Background Worker] Cleaned up ${result.cancelled} stale orders. Restocked ${result.restockedUnits} inventory units in ${result.elapsedMs}ms.`
        );
      } else {
        console.log(
          `[Background Worker] Tick complete: 0 stale orders found (${result.elapsedMs}ms).`
        );
      }
    } catch (err) {
      console.error("[Background Worker] Tick failed with error:", err);
    }
  };

  await runTick();
  const timer = setInterval(runTick, intervalMs);

  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("[Background Worker] Shutting down worker gracefully.");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    clearInterval(timer);
    console.log("[Background Worker] Shutting down worker gracefully.");
    process.exit(0);
  });
}

// CLI runner entrypoint
const isDirectExecution =
  process.argv[1]?.endsWith("expireStaleOrders.ts") ||
  process.argv[1]?.endsWith("expireStaleOrders.js");

if (isDirectExecution) {
  const isWorkerMode = process.argv.includes("--worker");
  const expiryMinutes = Number(process.env.ORDER_EXPIRY_MINUTES || 30);

  if (isWorkerMode) {
    const intervalMs = Number(process.env.WORKER_INTERVAL_MS || 60000 * 5);
    startOrderExpiryWorker(intervalMs, expiryMinutes).catch((err) => {
      console.error("Worker failed to start:", err);
      process.exit(1);
    });
  } else {
    expireStaleOrders(expiryMinutes)
      .then((res) => {
        console.log("Stale Order Expiry Job Result:", JSON.stringify(res, null, 2));
        process.exit(0);
      })
      .catch((err) => {
        console.error("Job failed with error:", err);
        process.exit(1);
      });
  }
}
