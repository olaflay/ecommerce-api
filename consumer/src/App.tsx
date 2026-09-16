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

  const handleToggleInStock = () => {
    setInStockOnly((prev) => !prev);
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
    <div className="app-wrapper">
      {/* M3 Top App Bar */}
      <header className="m3-top-app-bar">
        <div className="top-bar-content">
          <div className="brand-section">
            <span className="brand-label">
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>storefront</span>
              M3 Catalog Client
            </span>
            <h1 className="page-title">Product Catalog</h1>
          </div>

          <div className="api-endpoint-chip">
            <span className="api-status-dot"></span>
            <span>API: {API_BASE_URL}</span>
          </div>
        </div>
      </header>

      <main className="main-container">
        {/* Cold Start Notice Banner (PRD §17 & M3 Tonal Alert) */}
        {isColdStarting && (
          <div className="m3-banner warning" role="alert">
            <span className="material-symbols-outlined banner-icon">bolt</span>
            <div className="banner-content">
              <h4>Waking up API (Cold Start in Progress)</h4>
              <p>
                Free-tier cloud containers sleep during platform idle. Cold-start wakeups may take 15–30 seconds. Thank you for your patience!
              </p>
            </div>
          </div>
        )}

        {/* Error Alert Banner */}
        {errorMessage && (
          <div className="m3-banner error" role="alert">
            <span className="material-symbols-outlined banner-icon">error</span>
            <div className="banner-content">
              <h4>Failed to load catalog data</h4>
              <p>{errorMessage}</p>
              <button
                className="m3-btn tonal"
                onClick={loadProducts}
                style={{ marginTop: "0.75rem", height: "32px", fontSize: "0.8rem" }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>refresh</span>
                Retry Request
              </button>
            </div>
          </div>
        )}

        {/* M3 Tonal Toolbar (Layered Surface Container) */}
        <section className="m3-tonal-toolbar" aria-label="Catalog Filters & Controls">
          <div className="toolbar-controls">
            {/* Category Dropdown */}
            <div className="m3-input-field">
              <span className="material-symbols-outlined">category</span>
              <select
                className="m3-select"
                value={selectedCategory}
                onChange={handleCategoryChange}
                aria-label="Filter products by category"
              >
                <option value="">All Categories ({categories.length})</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Sort Selector */}
            <div className="m3-input-field">
              <span className="material-symbols-outlined">sort</span>
              <select
                className="m3-select"
                value={`${sortBy}_${sortOrder}`}
                onChange={handleSortChange}
                aria-label="Sort products"
              >
                <option value="createdAt_desc">Newest First</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="name_asc">Alphabetical: A to Z</option>
              </select>
            </div>

            {/* M3 Filter Chip: In-Stock Only */}
            <button
              type="button"
              className={`m3-filter-chip ${inStockOnly ? "active" : ""}`}
              onClick={handleToggleInStock}
              aria-pressed={inStockOnly}
            >
              <span className="material-symbols-outlined">
                {inStockOnly ? "check" : "inventory_2"}
              </span>
              In-Stock Only
            </button>
          </div>

          <div className="toolbar-metrics">
            Showing {meta.total > 0 ? offset + 1 : 0}–
            {Math.min(offset + PAGE_LIMIT, meta.total)} of {meta.total} products
          </div>
        </section>

        {/* Product Cards Grid with M3 Tonal Layering */}
        {isLoading && products.length === 0 ? (
          <div className="m3-state-container">
            <div className="m3-circular-progress"></div>
            <h3 className="state-title">Loading Catalog</h3>
            <p className="state-subtitle">Querying product database...</p>
          </div>
        ) : products.length === 0 ? (
          <div className="m3-state-container">
            <span className="material-symbols-outlined state-icon">search_off</span>
            <h3 className="state-title">No products found</h3>
            <p className="state-subtitle">Try clearing or adjusting your category and stock filters.</p>
          </div>
        ) : (
          <div className="m3-card-grid">
            {products.map((product) => {
              const isInStock = product.stockQuantity > 0;
              return (
                <article key={product.id} className="m3-card">
                  <div>
                    <div className="card-top">
                      <span className="m3-badge category">
                        {product.category?.name || "General"}
                      </span>
                      <span
                        className={`m3-badge ${
                          isInStock ? "in-stock" : "out-of-stock"
                        }`}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>
                          {isInStock ? "check_circle" : "cancel"}
                        </span>
                        {isInStock ? `${product.stockQuantity} in stock` : "Out of stock"}
                      </span>
                    </div>

                    <h2 className="card-title">{product.name}</h2>
                    <p className="card-description">
                      {product.description || "No product description provided."}
                    </p>
                  </div>

                  <div className="card-bottom">
                    <div className="price-container">
                      <span className="price-label">Price</span>
                      <span className="price-value">{formatMoney(product.price)}</span>
                    </div>

                    <span
                      className="m3-badge"
                      style={{
                        background: "var(--md-sys-color-surface-container-highest)",
                        color: "var(--md-sys-color-on-surface-variant)",
                      }}
                    >
                      NGN
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* M3 Tonal Pagination Bar */}
        <footer className="m3-pagination-bar" aria-label="Pagination">
          <div className="pagination-stats">
            <span className="material-symbols-outlined">pages</span>
            <span>
              Page <strong>{currentPage}</strong> of <strong>{totalPages}</strong> ({meta.total} items)
            </span>
          </div>

          <div className="pagination-nav">
            <button
              className="m3-btn outlined"
              onClick={handlePrevPage}
              disabled={offset === 0 || isLoading}
              aria-label="Previous Page"
            >
              <span className="material-symbols-outlined">arrow_back</span>
              Previous
            </button>

            <button
              className="m3-btn filled"
              onClick={handleNextPage}
              disabled={!meta.hasMore || isLoading}
              aria-label="Next Page"
            >
              Next
              <span className="material-symbols-outlined">arrow_forward</span>
            </button>
          </div>
        </footer>
      </main>
    </div>
  );
}

export default App;
