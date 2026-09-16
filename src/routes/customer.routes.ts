import { Router } from "express";
import { CustomerController } from "../controllers/customer.controller.js";
import { validate } from "../middleware/validate.js";
import { uuidParamSchema } from "../validation/common.schema.js";

const router = Router();

router.get("/", CustomerController.list);
router.get("/:id", validate(uuidParamSchema, "params"), CustomerController.getById);

export default router;
