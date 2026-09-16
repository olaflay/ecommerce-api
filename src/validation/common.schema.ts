import { z } from "zod";

export const uuidParamSchema = z.object({
  id: z.string().uuid("Invalid ID format: must be a valid UUID"),
});

export type UuidParam = z.infer<typeof uuidParamSchema>;
