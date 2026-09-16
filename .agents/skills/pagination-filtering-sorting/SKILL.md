---
name: pagination-filtering-sorting
description: Standards and edge cases for limit/offset pagination, whitelist sorting, tiebreakers, and range filters.
---

# pagination-filtering-sorting

**Load during:** Phase 3
**Trigger:** writing or reviewing any `GET` list endpoint

- `limit`: default 20, max 100. `limit > 100` → **clamp**, don't reject. `limit <= 0` or non-numeric → `400`.
- `offset`: default 0. Negative or non-numeric → `400`. Beyond dataset size → `200` with empty `data`, never an error.
- `sort`: whitelist only, per-resource. Unknown field → `400` naming the allowed set. Never silently fall back to default.
- `order`: `asc`/`desc` only (case-insensitive), default `asc`. Anything else → `400`.
- Multiple values for a single-value query param (e.g. `?sort=a&sort=b`) → `400`, don't silently take the first/last.
- Add a deterministic secondary sort key (`id`) under every primary sort so pagination is stable when primary-sort values tie.
- Filter range inversion (`minPrice > maxPrice`) → `400`, don't silently return empty results.
- A filter that matches zero rows is a valid `200` with empty `data` — never a `404`.
