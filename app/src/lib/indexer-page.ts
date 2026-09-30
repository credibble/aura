/**
 * Indexer pagination — filters, sorting and paging happen AT THE API (GraphQL)
 * level, and every list is an infinite query.
 *
 * Envio's dialect (not The Graph's): `limit`/`offset` instead of `first`/`skip`,
 * and `order_by: { field: asc | desc }` instead of `orderBy` + `orderDirection`.
 *
 * `hasMore` is the page's own length against the requested size: a full page
 * means "ask for the next offset" (these collections have no total count), a
 * short page means we've reached the end.
 */
import { infiniteQueryOptions } from "@tanstack/react-query";
import { gql } from "./graphql";

export type IndexerPage<T> = { items: T[]; hasMore: boolean; nextOffset: number };

export const INDEXER_PAGE_SIZE = 30;

export function indexerInfiniteOptions<T>({
  queryKey,
  entity,
  fields,
  where,
  orderBy,
  orderDirection = "desc",
  limit = INDEXER_PAGE_SIZE,
}: {
  /** Include every filter/sort input so each permutation caches separately. */
  queryKey: readonly unknown[];
  /** Entity name as declared in the schema, e.g. "Handle". */
  entity: string;
  /** Selection set (no braces). */
  fields: string;
  /** Raw where clause in Envio syntax, e.g. `where: { active: { _eq: true } }`. */
  where?: string;
  orderBy?: string;
  orderDirection?: "asc" | "desc";
  limit?: number;
}) {
  const build = (offset: number) =>
    [
      where,
      orderBy ? `order_by: { ${orderBy}: ${orderDirection} }` : null,
      `limit: ${limit}`,
      `offset: ${offset}`,
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
        nextOffset: pageParam + items.length,
      };
    },
    initialPageParam: 0,
    getNextPageParam: (last: IndexerPage<T>) => (last.hasMore ? last.nextOffset : undefined),
  });
}

/** Flatten infinite pages into one list (order preserved). */
export function flatIndexerPages<T>(pages: IndexerPage<T>[] | undefined): T[] {
  return (pages ?? []).flatMap((p) => p.items);
}
