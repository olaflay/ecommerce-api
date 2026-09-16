import { z } from "zod";
import { BadRequestError } from "../types/index.js";

export const ALLOWED_PRODUCT_SORT_FIELDS = [
  "price",
  "createdAt",
  "name",
  "stockQuantity",
] as const;

export type ProductSortField = (typeof ALLOWED_PRODUCT_SORT_FIELDS)[number];

export interface ProductFilterQuery {
  categoryId?: string;
  minPrice?: number;
  maxPrice?: number;
  inStock?: boolean;
}

export function parseProductFilters(
  query: Record<string, unknown>,
  pathCategoryId?: string
): ProductFilterQuery {
  const filters: ProductFilterQuery = {};

  // Path category ID overrides query param if both exist (PRD §9)
  const categoryIdToUse = pathCategoryId || query.categoryId;
  if (categoryIdToUse !== undefined && categoryIdToUse !== "") {
    if (Array.isArray(categoryIdToUse)) {
      throw new BadRequestError("Multiple categoryId parameters are not allowed");
    }
    const catStr = String(categoryIdToUse).trim();
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(catStr)) {
      throw new BadRequestError("Invalid categoryId format: must be a valid UUID");
    }
    filters.categoryId = catStr;
  }

  // minPrice
  if (query.minPrice !== undefined && query.minPrice !== "") {
    if (Array.isArray(query.minPrice)) {
      throw new BadRequestError("Multiple minPrice parameters are not allowed");
    }
    const rawMin = String(query.minPrice).trim();
    if (!/^\d+$/.test(rawMin)) {
      throw new BadRequestError("minPrice must be a non-negative integer");
    }
    filters.minPrice = parseInt(rawMin, 10);
  }

  // maxPrice
  if (query.maxPrice !== undefined && query.maxPrice !== "") {
    if (Array.isArray(query.maxPrice)) {
      throw new BadRequestError("Multiple maxPrice parameters are not allowed");
    }
    const rawMax = String(query.maxPrice).trim();
    if (!/^\d+$/.test(rawMax)) {
      throw new BadRequestError("maxPrice must be a non-negative integer");
    }
    filters.maxPrice = parseInt(rawMax, 10);
  }

  // Inverted range check (PRD §9)
  if (
    filters.minPrice !== undefined &&
    filters.maxPrice !== undefined &&
    filters.minPrice > filters.maxPrice
  ) {
    throw new BadRequestError("minPrice cannot exceed maxPrice");
  }

  // inStock: must be exactly "true" or "false"
  if (query.inStock !== undefined && query.inStock !== "") {
    if (Array.isArray(query.inStock)) {
      throw new BadRequestError("Multiple inStock parameters are not allowed");
    }
    const rawStock = String(query.inStock).trim();
    if (rawStock === "true") {
      filters.inStock = true;
    } else if (rawStock === "false") {
      filters.inStock = false;
    } else {
      throw new BadRequestError("inStock must be either 'true' or 'false'");
    }
  }

  return filters;
}
