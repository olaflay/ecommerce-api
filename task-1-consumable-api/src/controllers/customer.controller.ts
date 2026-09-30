import { Request, Response } from "express";
import { CustomerService } from "../services/customer.service.js";
import { sendCollection, sendSingle } from "../utils/response.js";

export class CustomerController {
  static async list(req: Request, res: Response) {
    const { customers, meta } = await CustomerService.listCustomers(req.query);
    sendCollection(res, customers, meta);
  }

  static async getById(req: Request, res: Response) {
    const customer = await CustomerService.getCustomerById(req.params.id as string);
    sendSingle(res, customer);
  }
}
