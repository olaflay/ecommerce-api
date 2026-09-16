import { Router } from "express";
import { ProductController } from "../controllers/product.controller.js";
import { validate } from "../middleware/validate.js";
import { uuidParamSchema } from "../validation/common.schema.js";

const router = Router();

router.get("/", ProductController.list);
router.get("/:id", validate(uuidParamSchema, "params"), ProductController.getById);

export default router;
