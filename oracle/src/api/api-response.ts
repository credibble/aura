/** Structured, paginated, fully-typed API responses. */

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
}

export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

export interface ApiResponse<T> {
  ok: true;
  ts: number;
  data: T;
}

/** Slice an already-loaded array into a page (page is 1-based). */
export function paginate<T>(items: T[], page = 1, limit = 20): Page<T> {
  const total = items.length;
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    meta: {
      page,
      limit,
      total,
      hasMore: start + limit < total,
    },
  };
}

/** Wrap any payload in the standard envelope. */
export function ok<T>(data: T): ApiResponse<T> {
  return { ok: true, ts: Date.now(), data };
}

/** Wrap a slice of a known-total collection. */
export function page<T>(items: T[], total: number, page = 1, limit = 20): Page<T> {
  const start = (page - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    meta: { page, limit, total, hasMore: start + limit < total },
  };
}

/** Wrap a service-sliced page (service already applied skip/take) — no re-slicing. */
export function sliced<T>(items: T[], total: number, page: number, limit: number): Page<T> {
  return { items, meta: { page, limit, total, hasMore: (page - 1) * limit + items.length < total } };
}

/** Parse + clamp query pagination params. */
export function paging(query: { page?: string; limit?: string }, maxLimit = 100): { page: number; limit: number } {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(query.limit) || 20));
  return { page, limit };
}