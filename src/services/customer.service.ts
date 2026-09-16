import { prisma } from "../db/prisma.js";
import { NotFoundError } from "../types/index.js";
import { parsePagination, buildPaginationMeta } from "../utils/pagination.js";
import { parseSort } from "../utils/sorting.js";

const ALLOWED_CUSTOMER_SORT = ["createdAt", "name"] as const;

export class CustomerService {
  static async listCustomers(query: Record<string, unknown>) {
    const { limit, offset } = parsePagination(query);
    const { prismaOrderBy } = parseSort(
      query,
      ALLOWED_CUSTOMER_SORT,
      "createdAt",
      "desc"
    );

    const [total, customers] = await prisma.$transaction([
      prisma.customer.count(),
      prisma.customer.findMany({
        skip: offset,
        take: limit,
        orderBy: prismaOrderBy,
      }),
    ]);

    const meta = buildPaginationMeta(total, limit, offset);
    return { customers, meta };
  }

  static async getCustomerById(id: string) {
    const customer = await prisma.customer.findUnique({
      where: { id },
    });

    if (!customer) {
      throw new NotFoundError("Customer not found");
    }

    return customer;
  }
}
