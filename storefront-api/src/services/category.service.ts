import { prisma } from "../db/prisma.js";
import { NotFoundError } from "../types/index.js";
import { parsePagination, buildPaginationMeta } from "../utils/pagination.js";
import { parseSort } from "../utils/sorting.js";

const ALLOWED_CATEGORY_SORT = ["createdAt", "name"] as const;

export class CategoryService {
  static async listCategories(query: Record<string, unknown>) {
    const { limit, offset } = parsePagination(query);
    const { prismaOrderBy } = parseSort(
      query,
      ALLOWED_CATEGORY_SORT,
      "createdAt",
      "desc"
    );

    const [total, categories] = await prisma.$transaction([
      prisma.category.count(),
      prisma.category.findMany({
        skip: offset,
        take: limit,
        orderBy: prismaOrderBy,
      }),
    ]);

    const meta = buildPaginationMeta(total, limit, offset);
    return { categories, meta };
  }

  static async getCategoryById(id: string) {
    const category = await prisma.category.findUnique({
      where: { id },
    });

    if (!category) {
      throw new NotFoundError("Category not found");
    }

    return category;
  }
}
