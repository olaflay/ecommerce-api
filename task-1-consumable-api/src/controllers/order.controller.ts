import { Request, Response } from "express";
import { OrderService } from "../services/order.service.js";
import { sendNoContent, sendSingle } from "../utils/response.js";

export class OrderController {
  static async create(req: Request, res: Response) {
    const order = await OrderService.createOrder(req.body);
    sendSingle(res, order, 201);
  }

  static async getById(req: Request, res: Response) {
    const order = await OrderService.getOrderById(req.params.id as string);
    sendSingle(res, order);
  }

  static async updateStatus(req: Request, res: Response) {
    const updated = await OrderService.updateOrderStatus(
      req.params.id as string,
      req.body.status
    );
    sendSingle(res, updated);
  }

  static async delete(req: Request, res: Response) {
    await OrderService.deletePendingOrder(req.params.id as string);
    sendNoContent(res);
  }
}
