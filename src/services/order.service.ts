import { OrderStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { ConflictError, NotFoundError } from "../types/index.js";
import { CreateOrderInput } from "../validation/order.schema.js";

const ALLOWED_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  [OrderStatus.pending]: [OrderStatus.paid, OrderStatus.cancelled],
  [OrderStatus.paid]: [OrderStatus.shipped, OrderStatus.cancelled],
  [OrderStatus.shipped]: [OrderStatus.delivered],
  [OrderStatus.delivered]: [],
  [OrderStatus.cancelled]: [],
};

const ORDER_FULL_INCLUDE = {
  customer: {
    select: {
      id: true,
      name: true,
      email: true,
    },
  },
  items: {
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
        },
      },
    },
  },
} satisfies Prisma.OrderInclude;

export class OrderService {
  static async createOrder(input: CreateOrderInput) {
    // 1. Verify customer exists (PRD §6 step 6)
    const customer = await prisma.customer.findUnique({
      where: { id: input.customerId },
    });
    if (!customer) {
      throw new NotFoundError("Customer not found");
    }

    // 2. Merge duplicate productIds in items array by summing quantities (PRD §6 step 5)
    const mergedItemMap = new Map<string, number>();
    for (const item of input.items) {
      const current = mergedItemMap.get(item.productId) || 0;
      mergedItemMap.set(item.productId, current + item.quantity);
    }
    const mergedItems = Array.from(mergedItemMap.entries()).map(
      ([productId, quantity]) => ({ productId, quantity })
    );

    const productIds = mergedItems.map((i) => i.productId);

    // 3. Execute inside an interactive transaction with row-level locking (PRD §6 step 9)
    const createdOrder = await prisma.$transaction(async (tx) => {
      // Row-level lock via SELECT ... FOR UPDATE ensures race safety under concurrent requests
      const lockedProducts = await tx.$queryRaw<
        Array<{ id: string; name: string; price: number; stockQuantity: number }>
      >`SELECT id, name, price, "stockQuantity" FROM "Product" WHERE id = ANY(${productIds}::uuid[]) FOR UPDATE`;

      const productMap = new Map(lockedProducts.map((p) => [p.id, p]));

      // Verify all products exist (PRD §6 step 7)
      for (const item of mergedItems) {
        if (!productMap.has(item.productId)) {
          throw new NotFoundError(`Product not found: ${item.productId}`);
        }
      }

      // Verify stock and compute totalAmount server-side (PRD §6 step 8 & 10)
      let totalAmount = 0;
      const orderLines = [];

      for (const item of mergedItems) {
        const product = productMap.get(item.productId)!;
        if (product.stockQuantity < item.quantity) {
          throw new ConflictError(
            `Insufficient stock for product "${product.name}". Requested: ${item.quantity}, Available: ${product.stockQuantity}`
          );
        }

        totalAmount += product.price * item.quantity;
        orderLines.push({
          productId: product.id,
          quantity: item.quantity,
          unitPrice: product.price, // Snapshotted price at order creation
        });
      }

      // Decrement stock atomically
      for (const item of mergedItems) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: { decrement: item.quantity },
          },
        });
      }

      // Create Order & OrderItem rows atomically
      return tx.order.create({
        data: {
          customerId: customer.id,
          status: OrderStatus.pending,
          totalAmount,
          currency: "NGN",
          items: {
            create: orderLines,
          },
        },
        include: {
          customer: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          items: {
            include: {
              product: {
                select: {
                  id: true,
                  name: true,
                  price: true,
                },
              },
            },
          },
        },
      });
    });

    return createdOrder;
  }

  static async getOrderById(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: ORDER_FULL_INCLUDE,
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    return order;
  }

  static async updateOrderStatus(id: string, newStatus: OrderStatus) {
    const updated = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: OrderStatus }>
      >`SELECT id, status FROM "Order" WHERE id = ${id}::uuid FOR UPDATE`;

      if (rows.length === 0) {
        throw new NotFoundError("Order not found");
      }

      const currentStatus = rows[0]!.status;

      // Idempotent same-status PATCH is a no-op 200 (PRD §6)
      if (currentStatus === newStatus) {
        return tx.order.findUniqueOrThrow({
          where: { id },
          include: ORDER_FULL_INCLUDE,
        });
      }

      // Validate state machine transition (PRD §6) while holding the row lock so a
      // concurrent PATCH cannot move the order into a state that makes this
      // transition illegal between read and write.
      const allowed = ALLOWED_TRANSITIONS[currentStatus];
      if (!allowed.includes(newStatus)) {
        throw new ConflictError(
          `Illegal status transition from "${currentStatus}" to "${newStatus}". Allowed transitions: ${
            allowed.length ? allowed.join(", ") : "none (terminal state)"
          }`
        );
      }

      return tx.order.update({
        where: { id },
        data: { status: newStatus },
        include: ORDER_FULL_INCLUDE,
      });
    });

    return updated;
  }

  static async deletePendingOrder(id: string) {
    await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ id: string; status: OrderStatus }>
      >`SELECT id, status FROM "Order" WHERE id = ${id}::uuid FOR UPDATE`;

      if (rows.length === 0) {
        throw new NotFoundError("Order not found");
      }

      // Only pending orders can be deleted (PRD §6); the row lock also serializes
      // against a concurrent status PATCH, so an order moved out of pending cannot
      // be deleted on a stale read.
      if (rows[0]!.status !== OrderStatus.pending) {
        throw new ConflictError(
          `Cannot delete an order with status "${rows[0]!.status}". Only pending orders can be deleted.`
        );
      }

      const items = await tx.orderItem.findMany({
        where: { orderId: id },
        select: { productId: true, quantity: true },
      });

      // Restock inventory and delete order atomically (PRD §6)
      for (const item of items) {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stockQuantity: { increment: item.quantity },
          },
        });
      }

      await tx.order.delete({
        where: { id },
      });
    });
  }
}
