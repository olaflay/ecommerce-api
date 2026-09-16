import { Category, CollectionResponse, ErrorEnvelope, Product } from "./types.js";

const rawBaseUrl = import.meta.env.VITE_API_BASE_URL || "http://localhost:4000";
export const API_BASE_URL = rawBaseUrl.replace(/\/+$/, "");

export function formatMoney(kobo: number): string {
  const naira = kobo / 100;
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
  }).format(naira);
}

export async function fetchCategories(signal?: AbortSignal): Promise<Category[]> {
  const url = `${API_BASE_URL}/api/v1/categories?limit=100`;
  const res = await fetch(url, { signal });

  if (!res.ok) {
    const errorBody: ErrorEnvelope = await res.json().catch(() => ({
      error: { code: "HTTP_ERROR", message: `HTTP ${res.status} ${res.statusText}` },
    }));
    throw new Error(errorBody.error?.message || `Failed to fetch categories (${res.status})`);
  }

  const payload: CollectionResponse<Category> = await res.json();
  return payload.data;
}

export interface FetchProductsParams {
  limit: number;
  offset: number;
  categoryId?: string;
  inStock?: boolean;
  sort?: string;
  order?: "asc" | "desc";
}

export async function fetchProducts(
  params: FetchProductsParams,
  signal?: AbortSignal
): Promise<CollectionResponse<Product>> {
  const query = new URLSearchParams();
  query.set("limit", String(params.limit));
  query.set("offset", String(params.offset));

  if (params.categoryId) {
    query.set("categoryId", params.categoryId);
  }
  if (params.inStock !== undefined) {
    query.set("inStock", String(params.inStock));
  }
  if (params.sort) {
    query.set("sort", params.sort);
  }
  if (params.order) {
    query.set("order", params.order);
  }

  const url = `${API_BASE_URL}/api/v1/products?${query.toString()}`;
  const res = await fetch(url, { signal });

  if (!res.ok) {
    const errorBody: ErrorEnvelope = await res.json().catch(() => ({
      error: { code: "HTTP_ERROR", message: `HTTP ${res.status} ${res.statusText}` },
    }));
    throw new Error(errorBody.error?.message || `Failed to fetch products (${res.status})`);
  }

  const payload: CollectionResponse<Product> = await res.json();
  return payload;
}

export async function checkHealth(signal?: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/healthz`, { signal });
    if (!res.ok) return false;
    const body = await res.json();
    return body.status === "ok";
  } catch {
    return false;
  }
}

