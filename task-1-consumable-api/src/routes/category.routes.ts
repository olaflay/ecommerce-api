import { Router } from "express";
import { CategoryController } from "../controllers/category.controller.js";
import { validate } from "../middleware/validate.js";
import { uuidParamSchema } from "../validation/common.schema.js";

const router = Router();

router.get("/", CategoryController.list);
router.get("/:id", validate(uuidParamSchema, "params"), CategoryController.getById);
router.get(
  "/:id/products",
  validate(uuidParamSchema, "params"),
  CategoryController.getProducts
);

export default router;
