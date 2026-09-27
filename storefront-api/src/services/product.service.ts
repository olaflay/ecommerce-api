import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.js";
import { NotFoundError } from "../types/index.js";
import { parsePagination, buildPaginationMeta } from "../utils/pagination.js";
import { parseSort } from "../utils/sorting.js";
import {
  ALLOWED_PRODUCT_SORT_FIELDS,
  parseProductFilters,
} from "../validation/product.schema.js";

export class ProductService {
  static async listProducts(
    query: Record<string, unknown>,
    pathCategoryId?: string
  ) {
    const { limit, offset } = parsePagination(query);
    const { prismaOrderBy } = parseSort(
      query,
      ALLOWED_PRODUCT_SORT_FIELDS,
      "createdAt",
      "desc"
    );
    const filters = parseProductFilters(query, pathCategoryId);

    const where: Prisma.ProductWhereInput = {};

    if (filters.categoryId) {
      where.categoryId = filters.categoryId;
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) {
        where.price.gte = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        where.price.lte = filters.maxPrice;
      }
    }

    if (filters.inStock !== undefined) {
      if (filters.inStock) {
        where.stockQuantity = { gt: 0 };
      } else {
        where.stockQuantity = { equals: 0 };
      }
    }

    const [total, products] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip: offset,
        take: limit,
        orderBy: prismaOrderBy,
        include: {
          category: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      }),
    ]);

    const meta = buildPaginationMeta(total, limit, offset);
    return { products, meta };
  }

  static async getProductById(id: string) {
    const product = await prisma.product.findUnique({
      where: { id },
      include: {
        category: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!product) {
      throw new NotFoundError("Product not found");
    }

    return product;
  }
}
