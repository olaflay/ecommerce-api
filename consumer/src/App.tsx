import React, { useEffect, useState, useRef, useCallback } from "react";
import {
  API_BASE_URL,
  checkHealth,
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

  // Filter & Sort State
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [inStockOnly, setInStockOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<string>("createdAt");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [offset, setOffset] = useState<number>(0);

  // Status & Resilience States
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isColdStarting, setIsColdStarting] = useState<boolean>(false);
  const [coldStartSeconds, setColdStartSeconds] = useState<number>(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);
  const [healthStatus, setHealthStatus] = useState<
    "idle" | "checking" | "online" | "unreachable"
  >("idle");

  const abortControllerRef = useRef<AbortController | null>(null);
  const coldStartTimerRef = useRef<number | null>(null);
  const secondsIntervalRef = useRef<number | null>(null);
  const categoriesLoadedRef = useRef(categories.length > 0);

  useEffect(() => {
    categoriesLoadedRef.current = categories.length > 0;
  }, [categories]);

  // Categories Fetcher with Error Resilience
  const loadCategories = useCallback((signal?: AbortSignal) => {
    fetchCategories(signal)
      .then((data) => {
        setCategories(data);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.warn("Could not load categories on initial pass:", err.message);
        }
      });
  }, []);

  // Monitor Online/Offline Browser Status
  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      loadCategories();
      loadProducts();
    };
    const handleOffline = () => {
      setIsOffline(true);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [loadCategories]);

  // Load categories on initial mount
  useEffect(() => {
    const controller = new AbortController();
    loadCategories(controller.signal);
    return () => controller.abort();
  }, [loadCategories]);

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
    setColdStartSeconds(0);

    // 2. Cold-start detection: trigger warning if response takes longer than 2.5s
    if (coldStartTimerRef.current) {
      window.clearTimeout(coldStartTimerRef.current);
    }
    if (secondsIntervalRef.current) {
      window.clearInterval(secondsIntervalRef.current);
    }

    coldStartTimerRef.current = window.setTimeout(() => {
      setIsColdStarting(true);
      secondsIntervalRef.current = window.setInterval(() => {
        setColdStartSeconds((sec) => sec + 1);
      }, 1000);
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
        // If categories were empty due to earlier cold start, retry fetching them now that server is confirmed awake
        if (!categoriesLoadedRef.current) {
          loadCategories();
        }
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
        if (secondsIntervalRef.current) {
          window.clearInterval(secondsIntervalRef.current);
        }
        setIsLoading(false);
        setIsColdStarting(false);
      });
  }, [offset, selectedCategory, inStockOnly, sortBy, sortOrder, loadCategories]);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Check API Server Health & Diagnose Connectivity
  const handleCheckHealth = async () => {
    setHealthStatus("checking");
    const isHealthy = await checkHealth();
    if (isHealthy) {
      setHealthStatus("online");
      // Server is verified awake: refresh data immediately
      loadCategories();
      loadProducts();
    } else {
      setHealthStatus("unreachable");
    }
  };

  // Full manual retry (both categories and products)
  const handleFullRetry = () => {
    setHealthStatus("idle");
    loadCategories();
    loadProducts();
  };

  // Filter Reset Handlers (Guarantees Zero Dead Ends)
  const handleClearFilters = () => {
    setSelectedCategory("");
    setInStockOnly(false);
    setOffset(0);
  };

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

  // Pagination Handlers with Smooth Scroll to Top
  const handlePrevPage = () => {
    setOffset((prev) => Math.max(0, prev - PAGE_LIMIT));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleNextPage = () => {
    if (meta.hasMore) {
      setOffset((prev) => prev + PAGE_LIMIT);
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const handleBackToBeginning = () => {
    setOffset(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const currentPage = Math.floor(offset / PAGE_LIMIT) + 1;
  const totalPages = Math.ceil(meta.total / PAGE_LIMIT) || 1;
  const hasActiveFilters = selectedCategory !== "" || inStockOnly;
  const activeCategoryObj = categories.find((c) => c.id === selectedCategory);

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
            <span className={`api-status-dot ${isOffline ? "offline" : ""}`}></span>
            <span>{isOffline ? "Offline Mode" : `API: ${API_BASE_URL}`}</span>
          </div>
        </div>
      </header>

      <main className="main-container">
        {/* Offline Alert Banner */}
        {isOffline && (
          <div className="m3-banner error" role="alert">
            <span className="material-symbols-outlined banner-icon">wifi_off</span>
            <div className="banner-content">
              <h4>You are currently offline</h4>
              <p>Please check your network connection. We will automatically reconnect as soon as you are back online.</p>
            </div>
          </div>
        )}

        {/* Cold Start Notice Banner (PRD §17 & M3 Tonal Alert) */}
        {isColdStarting && (
          <div className="m3-banner warning" role="alert">
            <span className="material-symbols-outlined banner-icon">bolt</span>
            <div className="banner-content">
              <h4>Waking up API (Cold Start in Progress)</h4>
              <p>
                Free-tier cloud containers sleep during platform idle. Cold-start wakeups typically take 15–30 seconds ({coldStartSeconds}s elapsed). Thank you for your patience!
              </p>
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

        {/* Active Filters Summary Strip (Zero Dead-End Affordance) */}
        {hasActiveFilters && (
          <div className="m3-active-filters-bar" aria-label="Active filters">
            <span className="active-filters-label">Active filters:</span>
            {selectedCategory && (
              <button
                type="button"
                className="m3-filter-tag"
                onClick={() => {
                  setSelectedCategory("");
                  setOffset(0);
                }}
                title="Remove category filter"
              >
                <span>Category: {activeCategoryObj ? activeCategoryObj.name : selectedCategory}</span>
                <span className="material-symbols-outlined remove-icon">close</span>
              </button>
            )}

            {inStockOnly && (
              <button
                type="button"
                className="m3-filter-tag"
                onClick={() => {
                  setInStockOnly(false);
                  setOffset(0);
                }}
                title="Remove in-stock filter"
              >
                <span>In-Stock Only</span>
                <span className="material-symbols-outlined remove-icon">close</span>
              </button>
            )}

            <button
              type="button"
              className="m3-clear-all-btn"
              onClick={handleClearFilters}
            >
              Clear all filters
            </button>
          </div>
        )}

        {/* State Container 1: Dedicated Error State (Zero Dead End) */}
        {!isLoading && errorMessage && products.length === 0 ? (
          <div className="m3-state-container error-state">
            <span className="material-symbols-outlined state-icon error">cloud_off</span>
            <h3 className="state-title">Unable to Load Catalog</h3>
            <p className="state-subtitle">
              We encountered an issue communicating with the catalog API. This usually happens if the cloud container is sleeping or waking up from an idle period.
            </p>
            <div className="m3-error-details">
              <strong>Error Details:</strong> {errorMessage}
            </div>

            {healthStatus === "online" && (
              <div className="health-status-badge online">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>check_circle</span>
                API Server is Online! Fetching catalog data...
              </div>
            )}

            {healthStatus === "unreachable" && (
              <div className="health-status-badge offline">
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>cancel</span>
                API Server is currently unreachable. Please wait 15–20s for container startup.
              </div>
            )}

            <div className="m3-state-actions">
              <button className="m3-btn filled" onClick={handleFullRetry}>
                <span className="material-symbols-outlined">refresh</span>
                Try Again
              </button>
              <button
                className="m3-btn tonal"
                onClick={handleCheckHealth}
                disabled={healthStatus === "checking"}
              >
                <span className="material-symbols-outlined">network_ping</span>
                {healthStatus === "checking" ? "Checking Status..." : "Check Server Status"}
              </button>
            </div>
          </div>
        ) : isLoading && products.length === 0 ? (
          /* State Container 2: Loading State */
          <div className="m3-state-container">
            <div className="m3-circular-progress"></div>
            <h3 className="state-title">
              {isColdStarting ? "Starting Up Cloud Server" : "Loading Catalog"}
            </h3>
            <p className="state-subtitle">
              {isColdStarting
                ? `Waking up free-tier instance (${coldStartSeconds}s)... this usually takes 15–30 seconds.`
                : "Retrieving products and pricing information..."}
            </p>
          </div>
        ) : products.length === 0 ? (
          /* State Container 3: Empty State (Zero Dead End with Clear Actions) */
          <div className="m3-state-container">
            <span className="material-symbols-outlined state-icon">filter_alt_off</span>
            <h3 className="state-title">
              {hasActiveFilters ? "No products match your filters" : "Catalog is currently empty"}
            </h3>
            <p className="state-subtitle">
              {hasActiveFilters
                ? "We couldn't find any products that match your selected category or stock criteria. Clear your filters to see all available products."
                : "There are currently no products published in the database."}
            </p>
            <div className="m3-state-actions">
              {hasActiveFilters ? (
                <button className="m3-btn filled" onClick={handleClearFilters}>
                  <span className="material-symbols-outlined">filter_alt_off</span>
                  Clear All Filters
                </button>
              ) : (
                <button className="m3-btn filled" onClick={loadProducts}>
                  <span className="material-symbols-outlined">refresh</span>
                  Refresh Catalog
                </button>
              )}
            </div>
          </div>
        ) : (
          /* State Container 4: Product Grid */
          <>
            <div
              className={`m3-card-grid${isLoading ? " loading" : ""}`}
              aria-busy={isLoading}
            >
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

            {/* End of Catalog Banner (Clear feedback when no more items exist) */}
            {!meta.hasMore && meta.total > 0 && (
              <div className="m3-end-catalog-banner">
                <span>
                  ✨ You have reached the end of the catalog (Showing all {meta.total} products).
                </span>
                {totalPages > 1 && (
                  <button
                    className="m3-btn tonal"
                    onClick={handleBackToBeginning}
                    style={{ height: "32px", fontSize: "0.8rem", padding: "0 1rem" }}
                  >
                    <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                      vertical_align_top
                    </span>
                    Back to Page 1
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {/* M3 Tonal Pagination Bar */}
        {meta.total > 0 && (
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
        )}
      </main>
    </div>
  );
}

export default App;
