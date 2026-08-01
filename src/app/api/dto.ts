/**
 * The wire shapes qits-events answers with, as this application reads them.
 *
 * Three rules run through the whole file and are worth stating once rather than at every field.
 *
 * **`payload` is a string, not an object.** The service stores whatever the publisher sent,
 * verbatim, and compares it byte-for-byte; the column is documented as never queried by content.
 * So it arrives as JSON *text* and this app parses it itself — and must survive text that is not
 * JSON at all, because the hand-recorded `POST` path accepts any string a person types.
 *
 * **`occurredAt` is the caller's time, `createdAt` is this database's.** They disagree in the live
 * store by as much as eight minutes. Everything the log orders by is `occurredAt`; `createdAt` is
 * bookkeeping and is drawn only on the event page.
 *
 * **Two events can share an `occurredAt`.** A release fork's siblings carry the run's finish
 * instant by construction — 4 of 137 rows tie on the live store — which is why the cursor is the
 * composite `(occurredAt, id)` and never a scalar time.
 */

/**
 * One event, as `GET /events/api/events` and `GET /events/api/events/{id}` return it.
 *
 * `parentId` is the id of the event that caused this one, or null for a root. A `parentId` that
 * resolves to a 404 is **data, not damage**: a deleted cause makes its child a chain start, and the
 * live store has one such row today. Nothing here may treat it as an error.
 *
 * `description` is null on every row the platform writes; the field belongs to the hand-recorded
 * path.
 */
export interface EventDto {
  readonly id: string;
  readonly name: string;
  readonly occurredAt: string;
  readonly payload: string | null;
  readonly description: string | null;
  readonly parentId: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/**
 * The list envelope.
 *
 * `nextCursor` is the `(occurredAt, id)` of the last row of this page, or null when this page is
 * the last one. It is **optional on the wire on purpose**: the server that ships today answers the
 * whole log with no such field, and a client that reads its absence as "no more" renders correctly
 * against both. That is what lets this SPA ship before the paging workstream lands.
 */
export interface EventsResponse {
  readonly events: readonly EventDto[];
  readonly nextCursor?: string | null;
}

/**
 * The single-event envelope.
 *
 * `GET /events/api/events/{id}` answers `{"event": …}` and **not the event itself** — measured on
 * the live service and written that way in `EventController.get`, whose response record holds one
 * field named `event`. The list route's envelope is `events`/`nextCursor` and the vocabulary's is
 * `names`, so every route here is enveloped and this one is no exception; it only looks like one
 * because a single object could plausibly have been the whole body.
 *
 * The difference is invisible to a type assertion and total at runtime: a client that reads the
 * body as an event gets an object whose every field is `undefined`, with no error anywhere.
 */
export interface EventResponse {
  readonly event: EventDto;
}

/**
 * The vocabulary: every distinct `name` in the log, sorted.
 *
 * It exists so the filter can be populated without fetching all of history — which is the thing
 * paging exists to stop. Five names live today, three of them produced by services and two by
 * hand-recorded probes, and the set grows with no frontend deploy.
 */
export interface NamesResponse {
  readonly names: readonly string[];
}

/**
 * The `/events/stream` frame: an event that was just **created**.
 *
 * It is {@link EventDto} minus `createdAt`/`updatedAt`, and the omission is deliberate — those are
 * the database's bookkeeping, not facts about the thing that happened. The log draws neither, so a
 * frame carries everything a row needs.
 *
 * **If the log ever renders `createdAt`, the push path becomes lossy and the decision to push rows
 * rather than refetch must be revisited in the same commit.**
 *
 * Fields may be *appended* by a later service; nothing here may fail on one it has not heard of.
 */
export interface EventCreatedFrame {
  readonly id: string;
  readonly name: string;
  readonly occurredAt: string;
  readonly payload: string | null;
  readonly description: string | null;
  readonly parentId: string | null;
}

/**
 * The list route's query, as this app spells it. Every field is optional and an unset one is simply
 * not sent — an empty `name` list is "no filter", not "match nothing".
 *
 * - `limit` — how many rows, default 200 server-side, clamped to 1000. Advisory against today's
 *   server, which ignores it and answers the whole log; that costs one over-fetch and nothing else.
 * - `cursor` — the composite `<occurredAt>,<id>` of the previous page's last row.
 * - `name` — sent comma-joined, and the same set the socket subscribes to.
 * - `since` — a lower bound only. There is deliberately no `until`: the cursor *is* the upper one.
 * - `q` — a case-insensitive substring match on the payload **text**. It is a payload search and
 *   not a repository filter, and the UI must label it as one: the repository lives under `repoId`
 *   on builds and `repository` on releases, so no single key means "which repository" and `q`
 *   over-matches slightly by design.
 */
export interface EventQuery {
  readonly limit?: number;
  readonly cursor?: string | null;
  readonly name?: readonly string[];
  readonly since?: string | null;
  readonly q?: string | null;
}

/** One page of the log, with the cursor that follows it. `nextCursor` null means this is the end. */
export interface EventPage {
  readonly events: readonly EventDto[];
  readonly nextCursor: string | null;
}
