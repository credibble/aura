/**
 * Subgraph pagination — filters, sorting and paging happen AT THE API (GraphQL)
 * level, and every list is an infinite query.
 *
 * `hasMore` is the page's own length against the requested size: a full page
 * means "ask for the next skip" (the subgraph has no total count on these
 * collections), a short page means we've reached the end.
 */
import { infiniteQueryOptions } from "@tanstack/react-query";
import { gql } from "./graphql";

export type SubgraphPage<T> = { items: T[]; hasMore: boolean; nextSkip: number };

export const SUBGRAPH_PAGE_SIZE = 30;

export function subgraphInfiniteOptions<T>({
  queryKey,
  entity,
  fields,
  where,
  orderBy,
  orderDirection = "desc",
  limit = SUBGRAPH_PAGE_SIZE,
}: {
  /** Include every filter/sort input so each permutation caches separately. */
  queryKey: readonly unknown[];
  /** Subgraph collection, e.g. "handles". */
  entity: string;
  /** Selection set (no braces). */
  fields: string;
  /** Raw where clause, e.g. `where: { active: true }`. */
  where?: string;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  limit?: number;
}) {
  const build = (skip: number) =>
    [
      where,
      orderBy ? `orderBy: ${orderBy}` : null,
      orderBy ? `orderDirection: ${orderDirection}` : null,
      `first: ${limit}`,
      `skip: ${skip}`,
    ]
      .filter(Boolean)
      .join(", ");

  return infiniteQueryOptions({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const data = await gql<Record<string, T[]>>(
        `{ ${entity}(${build(pageParam)}) { ${fields} } }`,
      );
      const items = data[entity] ?? [];
      return {
        items,
        hasMore: items.length >= limit,
        nextSkip: pageParam + items.length,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (last: SubgraphPage<T>) => (last.hasMore ? last.nextSkip : undefined),
  });
}

/** Flatten infinite pages into one list (order preserved). */
export function flatSubgraphPages<T>(pages: SubgraphPage<T>[] | undefined): T[] {
  return (pages ?? []).flatMap((p) => p.items);
}
