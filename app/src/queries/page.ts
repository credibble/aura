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

/** Concatenate every loaded page into one array. */
export function flatPages<T>(pages: Page<T>[] | undefined): T[] {
  return pages?.flatMap((p) => p.items) ?? [];
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
