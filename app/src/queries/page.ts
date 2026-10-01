/**
 * Pagination contract shared by every oracle `Page<T>` endpoint:
 * `{ items, meta: { page, limit, total, hasMore } }` (the backend applies
 * skip/take once; controllers wrap with `sliced()`).
 */
import { useEffect, useMemo } from "react";
import { type InfiniteData, type UseInfiniteQueryResult } from "@tanstack/react-query";

export type PageMeta = {
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
};

export type Page<T> = {
  items: T[];
  meta: PageMeta;
};

/**
 * Concatenate every loaded page into one array, dropping duplicate ids.
 *
 * Offset pagination over a LIVE feed can place the same row on two pages (a
 * post inserted between page fetches shifts the boundary), which otherwise
 * yields duplicate React keys and duplicated rows. Items are kept in
 * first-seen order; items without a string `id` are never dropped.
 */
export function flatPages<T>(pages: Page<T>[] | undefined): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  for (const page of pages ?? []) {
    for (const item of page.items) {
      const id = (item as { id?: unknown } | null)?.id;
      if (typeof id === "string") {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      out.push(item);
    }
  }
  return out;
}

/** v5 `getNextPageParam`: next page number, or undefined at the end. */
export function nextParam<T>(last: Page<T>): number | undefined {
  return last.meta.hasMore ? last.meta.page + 1 : undefined;
}

/**
 * Drain an infinite query built as an ID set (follows, subs, likes): keeps
 * fetching the next page until the backend reports no more, then flattens.
 */
export function useAllPages<T>(
  query: UseInfiniteQueryResult<InfiniteData<Page<T>, unknown>, Error>,
): T[] {
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  return useMemo(() => flatPages(query.data?.pages), [query.data]);
}
