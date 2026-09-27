import { BadRequestError } from "../types/index.js";

export type SortOrder = "asc" | "desc";

export interface ParsedSort<T extends string> {
  field: T;
  order: SortOrder;
  prismaOrderBy: Record<string, SortOrder>[];
}

export function parseSort<T extends string>(
  query: Record<string, unknown>,
  allowedFields: readonly T[],
  defaultField: T = "createdAt" as T,
  defaultOrder: SortOrder = "desc"
): ParsedSort<T> {
  if (Array.isArray(query.sort)) {
    throw new BadRequestError("Only one sort field is supported");
  }
  if (Array.isArray(query.order)) {
    throw new BadRequestError("Only one order direction is supported");
  }

  let field = defaultField;
  let order = defaultOrder;

  if (query.sort !== undefined && query.sort !== "") {
    const rawSort = String(query.sort).trim();
    if (!allowedFields.includes(rawSort as T)) {
      throw new BadRequestError(
        `Unsupported sort field: ${rawSort}. Allowed: ${allowedFields.join(", ")}`
      );
    }
    field = rawSort as T;
    // If sort is explicitly given without order, default order is 'asc' per PRD §10
    order = "asc";
  }

  if (query.order !== undefined && query.order !== "") {
    const rawOrder = String(query.order).trim().toLowerCase();
    if (rawOrder !== "asc" && rawOrder !== "desc") {
      throw new BadRequestError("order must be either 'asc' or 'desc'");
    }
    order = rawOrder as SortOrder;
  }

  return {
    field,
    order,
    // Add deterministic secondary sort key (id asc) per PRD §10 to guarantee stable pagination
    prismaOrderBy: [{ [field]: order }, { id: "asc" }],
  };
}
