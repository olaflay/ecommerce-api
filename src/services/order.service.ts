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

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    return order;
  }

  static async updateOrderStatus(id: string, newStatus: OrderStatus) {
    const order = await prisma.order.findUnique({
      where: { id },
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

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // Idempotent same-status PATCH is a no-op 200 (PRD §6)
    if (order.status === newStatus) {
      return order;
    }

    // Validate state machine transition (PRD §6)
    const allowed = ALLOWED_TRANSITIONS[order.status];
    if (!allowed.includes(newStatus)) {
      throw new ConflictError(
        `Illegal status transition from "${order.status}" to "${newStatus}". Allowed transitions: ${
          allowed.length ? allowed.join(", ") : "none (terminal state)"
        }`
      );
    }

    const updated = await prisma.order.update({
      where: { id },
      data: { status: newStatus },
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

    return updated;
  }

  static async deletePendingOrder(id: string) {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // Only pending orders can be deleted (PRD §6)
    if (order.status !== OrderStatus.pending) {
      throw new ConflictError(
        `Cannot delete an order with status "${order.status}". Only pending orders can be deleted.`
      );
    }

    // Restock inventory and delete order atomically (PRD §6)
    await prisma.$transaction(async (tx) => {
      for (const item of order.items) {
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
