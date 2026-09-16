import { Router } from "express";
import { OrderController } from "../controllers/order.controller.js";
import { validate } from "../middleware/validate.js";
import { uuidParamSchema } from "../validation/common.schema.js";
import {
  createOrderSchema,
  patchOrderSchema,
} from "../validation/order.schema.js";

const router = Router();

router.post("/", validate(createOrderSchema, "body"), OrderController.create);
router.get("/:id", validate(uuidParamSchema, "params"), OrderController.getById);
router.patch(
  "/:id",
  validate(uuidParamSchema, "params"),
  validate(patchOrderSchema, "body"),
  OrderController.updateStatus
);
router.delete(
  "/:id",
  validate(uuidParamSchema, "params"),
  OrderController.delete
);

export default router;
