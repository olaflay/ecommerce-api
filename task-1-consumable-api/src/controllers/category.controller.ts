import { Request, Response } from "express";
import { CategoryService } from "../services/category.service.js";
import { ProductService } from "../services/product.service.js";
import { sendCollection, sendSingle } from "../utils/response.js";

export class CategoryController {
  static async list(req: Request, res: Response) {
    const { categories, meta } = await CategoryService.listCategories(req.query);
    sendCollection(res, categories, meta);
  }

  static async getById(req: Request, res: Response) {
    const category = await CategoryService.getCategoryById(req.params.id as string);
    sendSingle(res, category);
  }

  static async getProducts(req: Request, res: Response) {
    const categoryId = req.params.id as string;
    // PRD §6: Category must exist first (404 if not), then product filters apply
    await CategoryService.getCategoryById(categoryId);
    const { products, meta } = await ProductService.listProducts(
      req.query,
      categoryId
    );
    sendCollection(res, products, meta);
  }
}
