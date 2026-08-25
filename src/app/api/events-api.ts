import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { QITS_API_BASE } from './api-base';
import type {
  EventDto,
  EventPage,
  EventQuery,
  EventResponse,
  EventsResponse,
  NamesResponse,
} from './dto';

/**
 * Everything this app reads, and it reads from exactly one upstream: qits-events, through the
 * gateway, at `/events/api`. There is no second service to join against — an event's payload names
 * repositories and versions as *strings*, and nothing in the store carries a foreign key — so like
 * spa-artifacts this repository has one `@Injectable` rather than two.
 *
 * All four calls are `GET`, all are unauthenticated, and all are one-shot: `firstValueFrom` unwraps
 * the observable immediately, because a promise is what the pages' `async` methods want. The write
 * routes exist (`POST`, `PUT`, `DELETE`) and are deliberately absent here — the log is read-only
 * and this class is where that stays true.
 *
 * `HttpClient` on the fetch backend rather than bare `fetch()` buys two things:
 * `HttpTestingController`, which is the whole basis of this repository's specs, and a call that
 * goes through `window.fetch`, where the platform's browser telemetry can see it. The socket is the
 * one transport that cannot go through it, and it has its own seam — see `event-stream.ts`.
 *
 * **This class is written against a contract the backend is growing in parallel.** `limit`,
 * `cursor`, `name`, `since`, `q` and `GET …/events/names` are the agreed shapes; against today's
 * server the extra parameters are dropped in silence and the list answers the whole log with no
 * `nextCursor`. {@link list} treats a missing `nextCursor` as "no more", so it renders correctly on
 * both servers and needs no change on the day paging lands.
 */
@Injectable({ providedIn: 'root' })
export class EventsApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(QITS_API_BASE);

  /**
   * One page of the log, newest first.
   *
   * An unset filter is an *absent* parameter rather than an empty one: JAX-RS would read
   * `?name=` as the empty string, which is a name no event has. `name` is comma-joined because that
   * is the spelling the route takes, and it is the same set the socket subscribes to.
   */
  async list(query: EventQuery = {}): Promise<EventPage> {
    const response = await firstValueFrom(
      this.http.get<EventsResponse>(`${this.base}/events/api/events`, {
        params: listParams(query),
      }),
    );
    return { events: response.events ?? [], nextCursor: response.nextCursor ?? null };
  }

  /**
   * One event by id. A 404 is the honest answer for an id that is not in the log — including the
   * `parentId` of a row whose cause was deleted — so callers get the rejection and decide what it
   * means. The chain walker reads it as "chain starts here"; a deep link reads it as "no such
   * event".
   *
   * **The body is `{"event": …}` and is unwrapped here**, like the list's `events` and the
   * vocabulary's `names`. Every route on this service envelopes its answer; reading this one as a
   * bare event costs no error and every field, because a cast cannot see the difference and an
   * absent field is `undefined` rather than a failure.
   */
  async get(id: string): Promise<EventDto> {
    const response = await firstValueFrom(
      this.http.get<EventResponse>(`${this.base}/events/api/events/${encodeURIComponent(id)}`),
    );
    return response.event;
  }

  /**
   * The events one event caused, newest first.
   *
   * **An unknown parent answers 200 with an empty list, never 404** — measured, including for an id
   * that is not even a UUID. So an empty array here means "this caused nothing" *or* "no such
   * event", and nothing downstream may read it as the second.
   *
   * Deliberately not paged: a parent's children are N+1 for N declared artifacts, the observed
   * maximum is 2, and the shape is bounded by a pipeline file rather than by history.
   */
  async children(parentId: string): Promise<readonly EventDto[]> {
    const response = await firstValueFrom(
      this.http.get<EventsResponse>(`${this.base}/events/api/events`, {
        params: new HttpParams().set('parentId', parentId),
      }),
    );
    return response.events ?? [];
  }

  /**
   * Every distinct name in the log, sorted — the filter's vocabulary.
   *
   * The route is a literal sibling of `/{id}` under the same path, and JAX-RS sorts literals ahead
   * of templates, so `/names` wins. Against a server that does not have the route yet this rejects
   * with a 404 (the id lookup's), which a caller renders as "the filter cannot be populated" rather
   * than as an empty vocabulary.
   */
  async names(): Promise<readonly string[]> {
    const response = await firstValueFrom(
      this.http.get<NamesResponse>(`${this.base}/events/api/events/names`),
    );
    return response.names ?? [];
  }
}

/**
 * The list query as HTTP parameters, exported because the log page builds the same query for its
 * URL state and a spec should be able to assert the two agree.
 *
 * Empty, null and undefined are all "not sent". A blank `q` is not a search for the empty string.
 */
export function listParams(query: EventQuery): HttpParams {
  let params = new HttpParams();
  if (query.limit !== undefined) {
    params = params.set('limit', query.limit);
  }
  if (query.cursor) {
    params = params.set('cursor', query.cursor);
  }
  if (query.name && query.name.length > 0) {
    params = params.set('name', query.name.join(','));
  }
  if (query.since) {
    params = params.set('since', query.since);
  }
  if (query.q) {
    params = params.set('q', query.q);
  }
  if (query.environment) {
    params = params.set('environment', query.environment);
  }
  return params;
}
