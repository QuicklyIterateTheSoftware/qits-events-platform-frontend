/**
 * The one order this application draws the log in, and the two list operations the live tail needs.
 *
 * **The order is `(occurredAt, id)`, both descending, and the second half is not decoration.**
 * `occurredAt` alone is not a total order on this data: a release fork's siblings carry the run's
 * finish instant by construction, so 4 of 137 rows tie on the live store and a tied pair may come
 * back in either order from two calls. Everything downstream of that is worse — a page boundary on
 * a tie either drops a sibling or repeats it, and it lands precisely on the rows a release train is
 * read for. The server sorts the same way; this is the client agreeing rather than guessing.
 *
 * The functions are generic over {@link OrderedEvent} on purpose: a fetched row carries
 * `createdAt`/`updatedAt` and a pushed frame does not, and neither field takes part in the order.
 */

/** Everything ordering needs to know about an event. Both a fetched row and a pushed frame are one. */
export interface OrderedEvent {
  readonly id: string;
  readonly occurredAt: string;
}

/**
 * Newest first, ties broken by id descending.
 *
 * `occurredAt` is compared as a **string**, which is exact for the ISO-8601 instants this service
 * stamps and is not a shortcut: `Date.parse` truncates to milliseconds, and the store's timestamps
 * carry microseconds — the three ties measured on the live data agree to six decimal places, so a
 * millisecond comparison would merely produce more of them.
 */
export function compareNewestFirst(a: OrderedEvent, b: OrderedEvent): number {
  if (a.occurredAt !== b.occurredAt) {
    return a.occurredAt < b.occurredAt ? 1 : -1;
  }
  if (a.id === b.id) {
    return 0;
  }
  return a.id < b.id ? 1 : -1;
}

/** The same rows, in that order. A copy: the caller's array is never sorted in place. */
export function sortNewestFirst<T extends OrderedEvent>(rows: readonly T[]): readonly T[] {
  return [...rows].sort(compareNewestFirst);
}

/**
 * One pushed frame into a rendered list, **by position and not by prepending**.
 *
 * `occurredAt` is the caller's time and may be in the past — measured on the live store, one probe
 * disagrees with its own `createdAt` by eight minutes. A prepend would put such a row at the top of
 * the screen and then disagree with the next refetch, which is a shape drift nobody would see until
 * they scrolled.
 *
 * **An id already in the list is dropped, not replaced.** A refetch and a frame overlap by
 * construction, since frames keep arriving while the invalidating fetch is in flight; and where the
 * two disagree the fetched row is the richer one, so the rendered copy wins.
 */
export function insertNewestFirst<T extends OrderedEvent>(
  rows: readonly T[],
  row: T,
): readonly T[] {
  if (rows.some((existing) => existing.id === row.id)) {
    return rows;
  }
  const at = rows.findIndex((existing) => compareNewestFirst(row, existing) <= 0);
  const merged = [...rows];
  merged.splice(at === -1 ? merged.length : at, 0, row);
  return merged;
}

/**
 * Two lists into one, in order, deduplicated by id, with `preferred`'s copy of a shared id kept.
 *
 * This is the refetch's landing: the freshly fetched page is `preferred`, and what survives from
 * the rendered list is whatever the page did not carry — the frames that arrived while it was in
 * flight. Nothing here decides what to *drop* for length; that is the page's own budget to keep.
 */
export function mergeNewestFirst<T extends OrderedEvent>(
  preferred: readonly T[],
  other: readonly T[],
): readonly T[] {
  const seen = new Set(preferred.map((row) => row.id));
  return sortNewestFirst([...preferred, ...other.filter((row) => !seen.has(row.id))]);
}
