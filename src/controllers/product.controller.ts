import { Request, Response } from "express";
import { ProductService } from "../services/product.service.js";
import { sendCollection, sendSingle } from "../utils/response.js";

export class ProductController {
  static async list(req: Request, res: Response) {
    const { products, meta } = await ProductService.listProducts(req.query);
    sendCollection(res, products, meta);
  }

  static async getById(req: Request, res: Response) {
    const product = await ProductService.getProductById(req.params.id as string);
    sendSingle(res, product);
  }
}
