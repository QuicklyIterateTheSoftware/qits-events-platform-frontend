import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge, QitsButton } from '@qits/ui-components';
import type { EventCreatedFrame, EventQuery } from '../api/dto';
import { EventsApi } from '../api/events-api';
import { EventStream } from '../api/event-stream';
import { insertNewestFirst, mergeNewestFirst, sortNewestFirst } from '../api/event-order';
import { Async } from '../ui/async';
import { Empty } from '../ui/empty';
import { NONE, formatDayTime, plural, shortId } from '../ui/format';
import { IDLE, LOADING, failed, ready, type Loadable } from '../ui/loadable';
import { TimeRange } from '../ui/time-range';
import { rowGist, type RowGist } from './event-summary';
import { matchesFilters } from './frame-filter';
import { LiveTail } from './live-tail';
import { NameFilter } from './name-filter';

/** How many rows one page asks for. The server's own default, sent explicitly so it is visible. */
export const PAGE_SIZE = 200;

/**
 * What this table draws: a fetched row, or a frame the stream pushed.
 *
 * It is `EventCreatedFrame` and not `EventDto` on purpose. A frame is an event minus `createdAt` and
 * `updatedAt`, the two fields this log never draws, so the narrower type is the true one — and it is
 * the compiler holding the line under ⚖3: the day someone adds a `createdAt` column to this table it
 * will not build, which is exactly when the decision to push rows rather than refetch has to be
 * revisited.
 */
type LoggedEvent = EventCreatedFrame;

/** One row, with the two cells its payload fills already worked out. */
interface LogRow {
  readonly event: LoggedEvent;
  readonly gist: RowGist;
}

/** The comma-joined `?name=` parameter back as a list. */
function namesOf(value: string | null): readonly string[] {
  return (value ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);
}

/** The rows a `Loadable` holds, or none — so the template stays flat. */
function rowsOf(state: Loadable<readonly LoggedEvent[]>): readonly LoggedEvent[] {
  return state.kind === 'ready' ? state.value : [];
}

/**
 * The log: what has been happening, newest first, filterable, and legible without opening anything.
 *
 * **Load budget: `2 + 1 socket`, and the variable term is zero per row.**
 *
 * - `GET /events/api/events?limit=200` — one page of the log.
 * - `GET /events/api/events/names` — the filter's vocabulary, read once for the page's life.
 * - one `/events/stream` connection, opened once for the page's life and closed on destroy. It
 *   costs no request; **each of its connects costs one**, which is the tail's rule below and is
 *   what keeps the two additions to the budget separable.
 *
 * Nothing fans out per row. Everything a row draws arrived with the row: the time, the name, the
 * repository and gist its payload yields, and `parentId`. **The cause marker is a link and never a
 * count.** "This had a cause" is free because `parentId` is on the row; "this caused N" would be one
 * `?parentId=` request per row and would turn a flat budget into two hundred requests. Deriving the
 * counts from the loaded window instead would be worse than nothing — right in the middle of a page
 * and wrong at both edges, silently.
 *
 * "Load more" is `+1` and appends. It is a button and not an infinite scroll, because a scroll that
 * fires requests hides its own cost.
 *
 * **Every filter is server-side, and none of them is faked here.** `name`, `since` and `q` go into
 * the request; nothing in this component filters rows it has already fetched. Against *today's*
 * server — which declares one query parameter, `parentId`, and drops the rest in silence — that
 * means a filter appears not to work and the whole log arrives instead. That is the accepted cost of
 * shipping this page before the paging workstream: `limit` is advisory, a missing `nextCursor` is
 * "no more", and the day the backend lands nothing here changes. A client-side filter would look
 * like it worked and would lie about the store — filtering 200 loaded rows down to 3 reads as
 * "there are only 3".
 *
 * **URL state.** `?name=`, `?since=` and `?q=` are the filters, pushed as history entries so the
 * back button means "undo the filter"; `?cursor=` is how far down the reader got, written by "load
 * more" with `replaceUrl` because more of the same view is not a new view. Reopening an address
 * with a cursor resumes *at* that cursor in one request rather than replaying every page above it —
 * the budget is the point of the cursor — so the window then starts partway down the log and the
 * page says so, with a way back to the newest. Changing any filter drops the cursor: a position in
 * one filtered log means nothing in another.
 *
 * **The live tail pushes rows, and refetches on every connect.** The frame *is* the event (⚖3), so
 * an arrival costs no request at all: it goes through `insertNewestFirst`, which places it by
 * `occurredAt` rather than prepending it — the caller's time may be in the past, and one probe on
 * the live store disagrees with its own `createdAt` by eight minutes — and drops an id already on
 * screen, because a refetch and a frame overlap by construction. **Nothing here polls.** The only
 * timer in the feature is the stream's own reconnect backoff.
 *
 * Every connect and reconnect calls {@link reload}: the stream is live-only, there is no replay and
 * no resume token, and the gap a disconnected window left is unknowable. That refetch is what heals
 * an at-most-once channel, and it is not a resume protocol.
 *
 * **The tail is off until the reader asks for it**, which is what keeps the front door at the two
 * requests above. Turning it on connects, subscribes and refetches — one request, on a press, and it
 * closes whatever the page missed while it sat there. See the note on {@link tailOn}.
 *
 * **A frame goes through the same filters as the request.** `?name=` is the socket's own subscribe
 * set, so the server does that one twice; `?since=` and `?q=` have no spelling on the socket and are
 * re-asked of the frame by `matchesFilters`, exactly, because the frame carries the payload and the
 * instant the server would have compared. Nothing fetched is ever filtered here — that is the
 * client-side filter ⚖2 rejects, and this is not it.
 */
@Component({
  selector: 'app-log-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, Empty, LiveTail, NameFilter, QitsBadge, QitsButton, RouterLink, TimeRange],
  templateUrl: './log-page.html',
  styleUrls: ['../ui/page.css', './log-page.css'],
})
export class LogPage {
  private readonly api = inject(EventsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly stream = inject(EventStream);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly NONE = NONE;
  protected readonly pageSize = PAGE_SIZE;
  protected readonly formatDayTime = formatDayTime;
  protected readonly shortId = shortId;

  private readonly queryParams = toSignal(this.route.queryParamMap, {
    initialValue: convertToParamMap({}),
  });

  /** The names in force. Empty is "every name", including ones this build has never heard of. */
  protected readonly selectedNames = computed(() => namesOf(this.queryParams().get('name')));

  /** The time floor, as an absolute instant. There is deliberately no ceiling: the cursor is one. */
  protected readonly since = computed(() => this.queryParams().get('since'));

  /** The payload substring. It is a payload search and the label says so, because it is not a
   * repository filter — the repository lives under two different keys and this matches neither by
   * name. */
  protected readonly search = computed(() => this.queryParams().get('q'));

  /**
   * The three filters as one value, so the effect below re-runs when a filter changes and not when
   * "load more" records its position. A cursor written into the URL must not refetch the page it
   * was written by.
   */
  private readonly filters = computed(() =>
    JSON.stringify([this.selectedNames(), this.since(), this.search()]),
  );

  /** The page of the log, the pages appended to it, and the frames pushed into it. */
  protected readonly log = signal<Loadable<readonly LoggedEvent[]>>(LOADING);

  /**
   * Whether the reader wants the tail, and **it is off until they say so.**
   *
   * The plan asks for two things that collide on the first connect: a front door of two requests,
   * and a refetch on *every* open including the first. A tail that were on by default would connect
   * a moment after the page's own fetch and spend a third request healing a gap a few milliseconds
   * wide — so the budget above would be a number this page never actually costs. Off by default
   * keeps the budget honest, keeps the every-open rule literal with no exception carved into it, and
   * puts the third request behind a press, where the reader can see what it bought. The plan's own
   * browser pass says "turn the live tail on", which is the same reading.
   *
   * It is component state and not a query parameter: the four filters are the URL's, and a
   * preference for how a page behaves is not a description of what it is showing.
   */
  protected readonly tailOn = signal(false);

  /** Whether the socket is up. False is "briefly behind", never "wrong". */
  protected readonly tailConnected = this.stream.connected;

  /** Whether it has ever been up, which is what tells a first connect from a reconnect. */
  protected readonly tailEverConnected = computed(() => this.stream.connects() > 0);

  /** The filter's vocabulary. Its failure is inline and takes nothing else down. */
  protected readonly vocabulary = signal<Loadable<readonly string[]>>(LOADING);

  /** "Load more"'s own state, so a failed append leaves the rows on screen. Idle draws nothing. */
  protected readonly appending = signal<Loadable<null>>(IDLE);

  /** Where the next page starts, or null for "this is the end of the log". */
  protected readonly nextCursor = signal<string | null>(null);

  /** The cursor the first rendered page was fetched with — set only when an address carried one. */
  protected readonly windowStart = signal<string | null>(null);

  /**
   * A server answered with more rows than were asked for and did not page them.
   *
   * True only against a server that ignores `limit`, which is the one running today. The newest
   * `PAGE_SIZE` are shown and the page says out loud that the rest were not drawn, because silently
   * dropping rows is exactly the failure a client-side filter would be.
   */
  protected readonly capped = signal(false);

  /** The cursor this page was entered with, spent once. */
  private entry: string | null = this.route.snapshot.queryParamMap.get('cursor');

  protected readonly rows = computed<readonly LogRow[]>(() =>
    rowsOf(this.log()).map((event) => ({ event, gist: rowGist(event) })),
  );

  /** `137 events · newest first` — the shape of what is on screen, above the table. */
  protected readonly lede = computed(() => {
    if (this.log().kind !== 'ready') {
      return '';
    }
    const shown = `${plural(this.rows().length, 'event')} · newest first`;
    return this.nextCursor() ? `${shown} · more below` : shown;
  });

  /** Whether any filter is in force, which is what tells "nothing matches" from "nothing exists". */
  protected readonly filtered = computed(
    () => this.selectedNames().length > 0 || !!this.since() || !!this.search(),
  );

  constructor() {
    void this.loadVocabulary();

    // What the URL says is shown, is shown — on first load, on a filter change, and on the back
    // button. The first run spends the address's cursor; every later one starts from the head,
    // because the filter it is answering is a different log.
    // The dependency is the filter key and nothing else — `reload` reads the same parameters out of
    // the same URL, and left tracked it would make *any* query-parameter write re-enter this
    // effect, including the one "load more" makes to record where the reader got to.
    effect(() => {
      this.filters();
      untracked(() => {
        this.windowStart.set(this.entry);
        this.entry = null;
        void this.reload();
      });
    });

    // The socket follows the switch and the name filter, and nothing else. A filter change while it
    // is up is one subscribe frame rather than a reconnect — the server replaces the set wholesale —
    // and the refetch that closes the same gap is the effect above's, which is what makes `?name=`
    // mean one thing live and historically.
    effect(() => {
      if (!this.tailOn()) {
        this.stream.close();
        return;
      }
      this.stream.open(this.selectedNames());
    });

    // Every connect and every reconnect invalidates the window on screen. Zero is "nothing has
    // connected yet", where the page's own first load stands and there is nothing to heal; every
    // move after that is a gap of unknowable width, and `reload` is the only thing that closes it.
    effect(() => {
      if (this.stream.connects() === 0) {
        return;
      }
      untracked(() => void this.reload());
    });

    const stopFrames = this.stream.onFrame((frame) => this.accept(frame));
    this.destroyRef.onDestroy(() => {
      stopFrames();
      this.stream.close();
    });
  }

  /**
   * One pushed frame, into the list on screen.
   *
   * Four reasons to drop one, and each is a case where inserting would put a row on screen that the
   * request behind it would not have returned:
   *
   * - the tail is off, so nothing was asked for;
   * - there is no ready list to insert into — a frame is not a way to recover from a failed fetch;
   * - the window has a cursor above it, so an event created a moment ago is outside it entirely;
   * - the frame does not match the filters in force.
   *
   * Everything else is `insertNewestFirst`, which places it by `(occurredAt, id)` and drops an id
   * already drawn. No request is issued here, on any path.
   */
  private accept(frame: EventCreatedFrame): void {
    const state = this.log();
    if (!this.tailOn() || this.windowStart() !== null || state.kind !== 'ready') {
      return;
    }
    const filters = { names: this.selectedNames(), since: this.since(), q: this.search() };
    if (!matchesFilters(frame, filters)) {
      return;
    }
    this.log.set(ready(insertNewestFirst(state.value, frame)));
  }

  /** The switch. Turning it on connects, subscribes and refetches; turning it off closes the socket. */
  protected setTail(on: boolean): void {
    this.tailOn.set(on);
  }

  /**
   * Read the window's first page again — the retry, and the hook the live tail refetches through on
   * every connect and reconnect.
   *
   * It reads the window's *start*, not the position "load more" recorded: a retry must not skip
   * whatever was on screen, and the tail's invalidating refetch must land on the top of the window
   * it is inserting into. A filter change is what moves the start, and it moves it to the head.
   */
  protected async reload(): Promise<void> {
    const cursor = this.windowStart();
    this.log.set(LOADING);
    this.appending.set(IDLE);
    this.capped.set(false);
    try {
      const page = await this.api.list({ ...this.query(), cursor });
      this.log.set(ready(sortNewestFirst(page.events.slice(0, PAGE_SIZE))));
      this.nextCursor.set(page.nextCursor);
      this.capped.set(page.events.length > PAGE_SIZE && !page.nextCursor);
    } catch (error) {
      this.log.set(failed(error));
      this.nextCursor.set(null);
    }
  }

  /**
   * One more page, appended.
   *
   * The merge dedupes by id and keeps the whole list in one order, so a row can neither be shown
   * twice nor land in the wrong place — which matters at exactly one point: the page boundary that
   * falls on a tie, where two events share an instant and only the id tells them apart.
   */
  protected async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.appending().kind === 'loading') {
      return;
    }
    this.appending.set(LOADING);
    try {
      const page = await this.api.list({ ...this.query(), cursor });
      this.log.update((state) =>
        ready(mergeNewestFirst(rowsOf(state), page.events.slice(0, PAGE_SIZE))),
      );
      this.nextCursor.set(page.nextCursor);
      this.appending.set(IDLE);
      this.remember(cursor);
    } catch (error) {
      this.appending.set(failed(error));
    }
  }

  protected async loadVocabulary(): Promise<void> {
    this.vocabulary.set(LOADING);
    try {
      this.vocabulary.set(ready(await this.api.names()));
    } catch (error) {
      this.vocabulary.set(failed(error));
    }
  }

  protected setNames(names: readonly string[]): void {
    this.navigate({ name: names.length > 0 ? names.join(',') : null });
  }

  protected setSince(since: string | null): void {
    this.navigate({ since });
  }

  protected setSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.navigate({ q: value.length > 0 ? value : null });
  }

  /** Back to the head of the log, from a window an address started partway down. */
  protected toNewest(): void {
    this.navigate({});
  }

  /**
   * The badge's tone, which says nothing at all about an outcome.
   *
   * A release is what a person came to the log for and a build is the background — 127 of 137 rows
   * are `BuildSuccessful`, so a page of identical grey badges is a wall of one word. The tone is a
   * scanning aid and no more: there is no failure event on this bus, and nothing here may be read
   * as a status.
   */
  protected tone(name: string): 'info' | 'neutral' {
    return name === 'SCMRelease' || name === 'SoftwareRelease' ? 'info' : 'neutral';
  }

  /** The filters as the API spells them. The cursor is the caller's business. */
  private query(): EventQuery {
    return {
      limit: PAGE_SIZE,
      name: this.selectedNames(),
      since: this.since(),
      q: this.search(),
    };
  }

  /**
   * A filter change: a history entry, so back undoes it, and always without the cursor — a position
   * in one filtered log is meaningless in another.
   */
  private navigate(params: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ...params, cursor: null },
      queryParamsHandling: 'merge',
    });
  }

  /**
   * How far the reader got, written over the address rather than pushed onto it: pressing back
   * should undo the filter, not step back through four presses of "load more". Reopening the
   * address resumes at this cursor in one request, which is the window the page then says it is
   * showing.
   */
  private remember(cursor: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { cursor },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
