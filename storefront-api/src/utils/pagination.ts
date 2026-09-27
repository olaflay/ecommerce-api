import { BadRequestError, MetaPagination } from "../types/index.js";

export interface ParsedPagination {
  limit: number;
  offset: number;
}

export function parsePagination(query: Record<string, unknown>): ParsedPagination {
  let limit = 20;
  let offset = 0;

  // Multiple query values (e.g. ?limit=10&limit=20)
  if (Array.isArray(query.limit)) {
    throw new BadRequestError("Multiple limit parameters are not allowed");
  }
  if (Array.isArray(query.offset)) {
    throw new BadRequestError("Multiple offset parameters are not allowed");
  }

  if (query.limit !== undefined && query.limit !== "") {
    const rawLimit = String(query.limit).trim();
    if (!/^-?\d+$/.test(rawLimit)) {
      throw new BadRequestError("limit must be a valid integer");
    }
    const parsedLimit = parseInt(rawLimit, 10);
    if (parsedLimit <= 0) {
      throw new BadRequestError("limit must be greater than zero");
    }
    // Clamp to 100 per PRD §8
    limit = parsedLimit > 100 ? 100 : parsedLimit;
  }

  if (query.offset !== undefined && query.offset !== "") {
    const rawOffset = String(query.offset).trim();
    if (!/^-?\d+$/.test(rawOffset)) {
      throw new BadRequestError("offset must be a valid integer");
    }
    const parsedOffset = parseInt(rawOffset, 10);
    if (parsedOffset < 0) {
      throw new BadRequestError("offset must be greater than or equal to zero");
    }
    offset = parsedOffset;
  }

  return { limit, offset };
}

export function buildPaginationMeta(
  total: number,
  limit: number,
  offset: number
): MetaPagination {
  return {
    total,
    limit,
    offset,
    hasMore: offset + limit < total,
  };
}
