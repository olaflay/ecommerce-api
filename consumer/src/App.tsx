import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  API_BASE_URL,
  fetchCategories,
  fetchProducts,
  formatMoney,
} from "./api.js";
import { Category, MetaPagination, Product } from "./types.js";

const PAGE_LIMIT = 20;

export function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [meta, setMeta] = useState<MetaPagination>({
    total: 0,
    limit: PAGE_LIMIT,
    offset: 0,
    hasMore: false,
  });

  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState<number>(0);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isColdStarting, setIsColdStarting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const coldStartTimerRef = useRef<number | null>(null);

  // Load categories once on mount
  useEffect(() => {
    const controller = new AbortController();
    fetchCategories(controller.signal)
      .then(setCategories)
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.warn("Could not load categories:", err.message);
        }
      });
    return () => controller.abort();
  }, []);

  // Fetch products with stale-request guard and cold-start detection (PRD §17)
  const loadProducts = useCallback(() => {
    // 1. Cancel in-flight request to guard against stale responses
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoading(true);
    setErrorMessage(null);
    setIsColdStarting(false);

    // 2. Cold-start timer: trigger warning if response takes longer than 2.5s
    if (coldStartTimerRef.current) {
      window.clearTimeout(coldStartTimerRef.current);
    }
    coldStartTimerRef.current = window.setTimeout(() => {
      setIsColdStarting(true);
    }, 2500);

    fetchProducts(
      {
        limit: PAGE_LIMIT,
        offset,
        categoryId: selectedCategory || undefined,
        inStock: inStockOnly ? true : undefined,
        sort: sortBy,
        order: sortOrder,
      },
      controller.signal
    )
      .then((res) => {
        setProducts(res.data);
        setMeta(res.meta);
        setErrorMessage(null);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          setErrorMessage(err.message || "Failed to fetch products from API");
        }
      })
      .finally(() => {
        if (coldStartTimerRef.current) {
          window.clearTimeout(coldStartTimerRef.current);
        }
        setIsLoading(false);
        setIsColdStarting(false);
      });
  }, [offset, selectedCategory, inStockOnly, sortBy, sortOrder]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Handlers for filter/sort changes reset offset to 0
  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setSelectedCategory(e.target.value);
    setOffset(0);
  };

  const handleStockChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInStockOnly(e.target.checked);
    setOffset(0);
  };

  const handleSortChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === "price_asc") {
      setSortBy("price");
      setSortOrder("asc");
    } else if (val === "price_desc") {
      setSortBy("price");
      setSortOrder("desc");
    } else if (val === "name_asc") {
      setSortBy("name");
      setSortOrder("asc");
    } else {
      setSortBy("createdAt");
      setSortOrder("desc");
    }
    setOffset(0);
  };

  const handlePrevPage = () => {
    setOffset((prev) => Math.max(0, prev - PAGE_LIMIT));
  };

  const handleNextPage = () => {
    if (meta.hasMore) {
      setOffset((prev) => prev + PAGE_LIMIT);
    }
  };

  const currentPage = Math.floor(offset / PAGE_LIMIT) + 1;
  const totalPages = Math.ceil(meta.total / PAGE_LIMIT) || 1;

  return (
    <div className="container">
      {/* Header */}
      <header className="header">
        <div className="brand-badge">Bootcamp Task 1 — Reference Consumer</div>
        <h1 className="title">Product Catalog</h1>
        <p className="subtitle">
          Demonstrating resilient API consumption, cold-start tolerance, and server-side pagination.
        </p>
        <span className="api-source-tag">Connected to: {API_BASE_URL}</span>
      </header>

      {/* Cold-Start Warning Banner (PRD §17 & consumer-app-reliability skill) */}
      {isColdStarting && (
        <div className="banner banner-warning" role="alert">
          <span>⚡</span>
          <div>
            <strong>Waking up API on free-tier cloud host...</strong>
            <p>
              Free-tier instances (e.g. Render/Railway) sleep during inactivity. Cold starts may take 15–30 seconds.
            </p>
          </div>
        </div>
      )}

      {/* Error Banner */}
      {errorMessage && (
        <div className="banner banner-danger" role="alert">
          <span>⚠️</span>
          <div>
            <strong>API Error:</strong> {errorMessage}
            <button
              onClick={loadProducts}
              style={{
                display: "block",
                marginTop: "0.5rem",
                background: "transparent",
                border: "1px solid currentColor",
                color: "inherit",
                padding: "0.25rem 0.75rem",
                borderRadius: "4px",
                cursor: "pointer",
              }}
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Toolbar Controls */}
      <div className="toolbar">
        <div className="filter-group">
          {/* Category Filter */}
          <select
            className="select-control"
            value={selectedCategory}
            onChange={handleCategoryChange}
            aria-label="Filter by category"
          >
            <option value="">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          {/* Sort Selector */}
          <select
            className="select-control"
            value={`${sortBy}_${sortOrder}`}
            onChange={handleSortChange}
            aria-label="Sort products"
          >
            <option value="createdAt_desc">Newest First</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="name_asc">Name: A to Z</option>
          </select>

          {/* In Stock Toggle */}
          <label className="checkbox-label">
            <input
              type="checkbox"
              className="checkbox-control"
              checked={inStockOnly}
              onChange={handleStockChange}
            />
            In Stock Only
          </label>
        </div>

        <div className="page-info">
          Showing {meta.total > 0 ? offset + 1 : 0}–
          {Math.min(offset + PAGE_LIMIT, meta.total)} of {meta.total} products
        </div>
      </div>

      {/* Content Area */}
      {isLoading && products.length === 0 ? (
        <div className="state-box">
          <div className="spinner"></div>
          <h3>Loading products...</h3>
          <p>Querying catalog database...</p>
        </div>
      ) : products.length === 0 ? (
        <div className="state-box">
          <h3>No products match your criteria</h3>
          <p>Try clearing filters or selecting another category.</p>
        </div>
      ) : (
        <div className="product-grid">
          {products.map((p) => {
            const isInStock = p.stockQuantity > 0;
            return (
              <article key={p.id} className="product-card">
                <div>
                  <div className="product-header">
                    <span className="category-tag">
                      {p.category?.name || "General"}
                    </span>
                    <span
                      className={`stock-badge ${
                        isInStock ? "in-stock" : "out-of-stock"
                      }`}
                    >
                      {isInStock ? `● ${p.stockQuantity} in stock` : "✕ Out of Stock"}
                    </span>
                  </div>
                  <h2 className="product-name">{p.name}</h2>
                  <p className="product-description">{p.description || "No description provided."}</p>
                </div>

                <div className="product-footer">
                  <div className="price">{formatMoney(p.price)}</div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Pagination Footer */}
      <footer className="pagination">
        <div className="page-info">
          Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong>
        </div>

        <div className="pagination-buttons">
          <button
            className="btn"
            onClick={handlePrevPage}
            disabled={offset === 0 || isLoading}
            aria-label="Previous Page"
          >
            ← Previous
          </button>
          <button
            className="btn btn-primary"
            onClick={handleNextPage}
            disabled={!meta.hasMore || isLoading}
            aria-label="Next Page"
          >
            Next →
          </button>
        </div>
      </footer>
    </div>
  );
}
export default App;
