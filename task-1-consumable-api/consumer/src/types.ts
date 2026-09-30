export interface Category {
  id: string;
  name: string;
  description: string | null;
}

export interface Product {
  id: string;
  name: string;
  description: string | null;
  price: number; // Stored in minor units (kobo)
  currency: string;
  stockQuantity: number;
  categoryId: string;
  category?: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface MetaPagination {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export interface CollectionResponse<T> {
  data: T[];
  meta: MetaPagination;
}

export interface SingleResponse<T> {
  data: T;
}

export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
