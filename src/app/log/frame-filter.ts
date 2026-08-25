/**
 * Whether a pushed frame belongs in the log the reader is looking at.
 *
 * **The stream's vocabulary is one word wide.** A subscribe frame names event *names* and nothing
 * else, so `?name=` is honoured by the server for the tail exactly as it is for the list. `?since=`
 * and `?q=` have no spelling on the socket at all — the server cannot filter a frame by either, and
 * a tail that ignored them would push rows the fetched list would never have contained.
 *
 * So the frame goes through the same predicate here. **This is not a client-side filter in the sense
 * ⚖2 rejects**: nothing fetched is filtered, no row on screen is hidden, and the counts stay the
 * store's. It is one frame being asked the question the request already asked — and it can be asked
 * exactly, because the frame carries the payload and the instant the server would have compared.
 * Each clause below mirrors one clause of `EventRepository.listPage`, and a change on either side is
 * a change on both.
 *
 * The name check is kept even though the subscribe set already carries it: a filter change replaces
 * the subscription with one frame, and a frame for the old set may already be in flight.
 */

/** What a filter needs to read. A fetched row is one and so is a pushed frame. */
export interface FilterableEvent {
  readonly name: string;
  readonly occurredAt: string;
  readonly payload: string | null;
  readonly environment: string | null;
}

/** The four filters the log's URL carries. `?cursor=` is a position, not a filter. */
export interface LogFilters {
  /** The names in force. Empty is every name, including ones this build has never heard of. */
  readonly names: readonly string[];
  /** The lower bound on `occurredAt`, inclusive, or null for the whole log. */
  readonly since: string | null;
  /** A substring of the payload text, or null. */
  readonly q: string | null;
  /** The tier the publisher stamped, exactly, or null for every tier. */
  readonly environment: string | null;
}

/** All four, as the request asks them. */
export function matchesFilters(event: FilterableEvent, filters: LogFilters): boolean {
  return (
    named(event, filters.names) &&
    atOrAfter(event, filters.since) &&
    contains(event, filters.q) &&
    inTier(event, filters.environment)
  );
}

/** `name in :names` — and an empty set is no clause at all rather than "match nothing". */
function named(event: FilterableEvent, names: readonly string[]): boolean {
  return names.length === 0 || names.includes(event.name);
}

/**
 * `occurredAt >= :since`, inclusive.
 *
 * Both sides go through `Date.parse`, which truncates to milliseconds while the store keeps
 * microseconds. That is a knowingly bounded disagreement: an event inside one millisecond of the
 * floor may be judged differently here than by the server, and the next refetch settles it. Comparing
 * the strings instead would be worse rather than better — the floor is written by this application at
 * millisecond precision and `occurredAt` arrives at microsecond precision, so `…:23Z` would sort
 * above `…:23.928965Z` and drop a row the server keeps.
 *
 * A floor this cannot read is left to the server, which answers the request with a 400; there are
 * then no rows to insert into and nothing here to police.
 */
function atOrAfter(event: FilterableEvent, since: string | null): boolean {
  if (!since) {
    return true;
  }
  const floor = Date.parse(since);
  if (Number.isNaN(floor)) {
    return true;
  }
  const at = Date.parse(event.occurredAt);
  return !Number.isNaN(at) && at >= floor;
}

/**
 * `lower(payload) like '%…%' escape '!'` — a literal substring of the payload text, case-insensitive.
 *
 * The server escapes `%` and `_` in the caller's text before it builds the pattern, so "substring"
 * means substring there too and `includes` is the same question. `toLowerCase` rather than
 * `toLocaleLowerCase` because the server lower-cases in `Locale.ROOT`.
 *
 * A null payload matches nothing, exactly as `lower(null) like …` is null and never true. A blank
 * search is no clause at all, and not a search for the empty string.
 */
function contains(event: FilterableEvent, q: string | null): boolean {
  const needle = (q ?? '').trim().toLowerCase();
  if (needle.length === 0) {
    return true;
  }
  return (event.payload ?? '').toLowerCase().includes(needle);
}

/**
 * `environment = :environment` — an exact match on the tier the publisher stamped, mirroring the
 * server's indexed equality. A frame from before the field, or from a publisher that stamps
 * nothing, carries null and matches no filter value — exactly as its row would not have been in the
 * filtered fetch. Blank is no clause at all.
 */
function inTier(event: FilterableEvent, environment: string | null): boolean {
  const tier = (environment ?? '').trim();
  if (tier.length === 0) {
    return true;
  }
  return event.environment === tier;
}
