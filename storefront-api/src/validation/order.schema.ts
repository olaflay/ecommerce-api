import { z } from "zod";
import { OrderStatus } from "@prisma/client";

export const orderItemInputSchema = z
  .object({
    productId: z.string().uuid("productId must be a valid UUID"),
    quantity: z
      .number({ invalid_type_error: "quantity must be a number" })
      .int("quantity must be an integer")
      .min(1, "quantity must be at least 1"),
  })
  .strict();

export const createOrderSchema = z
  .object({
    customerId: z.string().uuid("customerId must be a valid UUID"),
    items: z
      .array(orderItemInputSchema)
      .min(1, "items array must contain at least one item"),
  })
  .strict();

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const patchOrderSchema = z.object({
  status: z.nativeEnum(OrderStatus, {
    errorMap: () => ({
      message: `status must be one of: ${Object.values(OrderStatus).join(", ")}`,
    }),
  }),
});

export type PatchOrderInput = z.infer<typeof patchOrderSchema>;
