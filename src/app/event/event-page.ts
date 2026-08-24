import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';
import { QitsBadge } from '@qits/ui-components';
import { injectScopedProject } from '../nav/scoped-project';
import type { EventDto } from '../api/dto';
import { EventsApi } from '../api/events-api';
import { rowGist } from '../log/event-summary';
import { Async } from '../ui/async';
import { NONE, exactInstant, formatDayTime, formatInstant, plural, shortId } from '../ui/format';
import { LOADING, failed, ready, type Loadable } from '../ui/loadable';
import {
  ChainWalker,
  DOWN_DEPTH_CAP,
  DOWN_NODE_CAP,
  UP_HOP_CAP,
  type Chain,
  type ChainStart,
} from './chain';
import { renderPayload } from './payload';

/**
 * One drawn line of the chain table — a node or a marker — with everything the row needs already
 * worked out.
 *
 * It is flat where {@link ChainRow} is a union, and that is for the template: a discriminated union
 * read in three places would put narrowing in the markup, and this list is rebuilt whole on every
 * walk anyway. The payload cells are read here, once per row, by the same reader the log's rows use.
 */
interface ChainLine {
  readonly kind: 'event' | 'loop' | 'bound';
  /** Levels below the root; the row indents by it. */
  readonly depth: number;
  readonly event: EventDto | null;
  /** The event the reader arrived at. */
  readonly current: boolean;
  /** The id a `loop` row points back at. */
  readonly loopId: string | null;
  readonly repository: string | null;
  readonly summary: string;
}

/** Everything but an ordinary root: the three ways a walk upward can stop short. */
type ShortStart = Exclude<ChainStart, { kind: 'root' }>;

/**
 * One event, whole, and the causation it sits in.
 *
 * **Load budget: `1 + U + D`** — the event itself, `U` requests walking up by `parentId` to the
 * root, and `D` requests walking down by `?parentId=`, one per node of the component. Measured on
 * the live store: **2** for a childless root (`1 + 0 + 1`), and **8** for the largest graph the
 * platform has produced in its lifetime — the five-node npm release train entered from its deepest
 * leaf (`1 + 2 + 5`). The walk is bounded at 32 hops up, 8 levels down and 200 events drawn, and
 * every bound draws a row saying the walk stopped rather than truncating in silence. The number is
 * also printed under the table, so a walk that grew a request says so on screen.
 *
 * Nothing else on the page costs anything. The header, the payload block and every cell of the
 * chain table are read out of events already fetched — the repository and gist come from the same
 * reader the log's rows use, so one event says the same thing in both places, and it issues no
 * request there either.
 *
 * **The chain page is the causation view, and the fork is why.** An inline tree in the log was
 * priced and rejected: 120 of 137 events are roots, so the expand affordance would be empty on 88%
 * of rows, learning which rows are worth expanding is the per-row request the log's flat budget
 * forbids, and an expansion cannot show the walk *upwards* at all, which is half the question. This
 * page answers both directions at once and renders a fork as a fork — one `SCMRelease` becoming a
 * `BuildSuccessful` and a `SoftwareRelease` at the same microsecond is a picture, and as five
 * navigations it is a memory test.
 *
 * **The chain is its own panel with its own state.** The event's own fetch failing is the page
 * failing; the walk failing is one panel failing, with the header and the payload still on screen
 * and a retry beside the gap. A 404 on the event itself is drawn as "no such event", which is an
 * ordinary answer for a deep link into a log somebody may have pruned.
 *
 * **A `parentId` that answers 404 is the chain's start and never an error.** `59934bf8` names
 * `064158b0` as its cause today, that row was deleted on purpose, and the migration that deleted it
 * recorded the reading this page draws: the surviving child becomes a chain start. The row above
 * the tree says the cause is not in the log and names the id, so the reader can see there was one.
 *
 * Every row links to its own event page, so the graph is navigable as well as visible — and the
 * log's cause column lands here, on the causing event, with its whole chain already drawn.
 */
@Component({
  selector: 'app-event-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async, QitsBadge, RouterLink],
  templateUrl: './event-page.html',
  styleUrls: ['../ui/page.css', './event-page.css'],
})
export class EventPage {
  /** The project the address names — what the crumb links back into, and what the header says. */
  protected readonly scoped = injectScopedProject();

  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(EventsApi);
  private readonly walker = inject(ChainWalker);

  protected readonly NONE = NONE;
  protected readonly upHopCap = UP_HOP_CAP;
  protected readonly downDepthCap = DOWN_DEPTH_CAP;
  protected readonly downNodeCap = DOWN_NODE_CAP;
  protected readonly formatDayTime = formatDayTime;
  protected readonly formatInstant = formatInstant;
  protected readonly exactInstant = exactInstant;
  protected readonly shortId = shortId;

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  /**
   * The event's id, as the path segment spells it. It is a UUID and it is not validated here: an id
   * that is not in the log answers 404, which is this page's own state rather than a routing
   * decision.
   */
  protected readonly eventId = computed(() => this.params().get('id') ?? '');

  /** The event itself. Its failure is the page's. */
  protected readonly event = signal<Loadable<EventDto>>(LOADING);

  /** The walk. Its failure takes down the tree and nothing else. */
  protected readonly chain = signal<Loadable<Chain>>(LOADING);

  constructor() {
    // The id is a path segment, so following a chain row to another event *reuses* this component
    // rather than rebuilding it. Reading the id as a signal is what makes that navigation a fetch:
    // without it the second event would never load and the URL would quietly disagree with the page.
    effect(() => {
      const id = this.eventId();
      if (id.length > 0) {
        void this.load(id);
      }
    });
  }

  /** The event once it has arrived, so the template reads a value rather than narrowing a union. */
  protected readonly loaded = computed<EventDto | null>(() => {
    const state = this.event();
    return state.kind === 'ready' ? state.value : null;
  });

  /** The event's payload, whole, canonical, and never assumed to be JSON. */
  private readonly rendered = computed(() => renderPayload(this.loaded()?.payload ?? null));

  /** `none`, `json` or `raw` — which of the three the payload block draws. */
  protected readonly payloadKind = computed(() => this.rendered().kind);

  /** The payload as drawn: pretty and key-sorted, or the raw string, or nothing at all. */
  protected readonly payloadText = computed(() => {
    const rendered = this.rendered();
    return rendered.kind === 'none' ? '' : rendered.text;
  });

  /**
   * The event's own repository and one-line gist, **read exactly as the log reads them**.
   *
   * One event says one thing in both places, and the reader who followed a row here recognises what
   * they clicked. It also inherits the fallback the log's reader carries: a name this build has
   * never heard of still renders its first keys rather than a blank.
   */
  protected readonly gist = computed(() => {
    const event = this.loaded();
    return event === null ? null : rowGist(event);
  });

  /** The chain's rows, each with the two payload cells the log's rows draw. */
  protected readonly lines = computed<readonly ChainLine[]>(() => {
    const state = this.chain();
    if (state.kind !== 'ready') {
      return [];
    }
    return state.value.rows.map((row) => {
      const line = { kind: row.kind, depth: row.depth };
      if (row.kind === 'event') {
        const gist = rowGist(row.event);
        return { ...line, ...gist, event: row.event, current: row.current, loopId: null };
      }
      return {
        ...line,
        event: null,
        current: false,
        loopId: row.kind === 'loop' ? row.id : null,
        repository: null,
        summary: '',
      };
    });
  });

  /** Whether the node cap ended the walk, which is a statement about the walk and not about a row. */
  protected readonly capped = computed(() => {
    const state = this.chain();
    return state.kind === 'ready' && state.value.capped;
  });

  /**
   * `5 events · 8 requests` — what is drawn, and what the whole page cost to draw it.
   *
   * The count is `1 + U + D` and **includes the page's own fetch**, because that is the budget this
   * page states and a number on screen that quietly omitted a request would not match the network
   * panel a reader checks it against. A retry is not in it: this is what the page costs, not a
   * running total of what the reader has asked for.
   */
  protected readonly chainLede = computed(() => {
    const state = this.chain();
    if (state.kind !== 'ready') {
      return '';
    }
    const events = state.value.rows.filter((row) => row.kind === 'event').length;
    return `${plural(events, 'event')} · ${plural(state.value.requests + 1, 'request')}`;
  });

  /** What the walk itself cost — `U + D`, without the page's own fetch. */
  protected readonly chainCost = computed(() => {
    const state = this.chain();
    return state.kind === 'ready' ? plural(state.value.requests, 'request') : '';
  });

  /**
   * Where the chain begins, when it does not begin at an ordinary root.
   *
   * Null for a root, because "this event was caused by nothing" is already said by the tree having
   * a top; the three short starts are the ones that need a sentence.
   */
  protected readonly start = computed<ShortStart | null>(() => {
    const state = this.chain();
    if (state.kind !== 'ready' || state.value.start.kind === 'root') {
      return null;
    }
    return state.value.start;
  });

  /**
   * The event, then its chain.
   *
   * In that order and not in parallel: the walk starts from the event's own `parentId`, so there is
   * nothing to walk until the event has arrived. That is the whole of the `1 +` in the budget.
   */
  protected async load(id: string): Promise<void> {
    this.event.set(LOADING);
    this.chain.set(LOADING);
    let event: EventDto;
    try {
      event = await this.api.get(id);
    } catch (error) {
      this.event.set(failed(error));
      this.chain.set(failed(error));
      return;
    }
    this.event.set(ready(event));
    await this.walkFrom(event);
  }

  /** The whole page again, from the id the URL carries. */
  protected async reload(): Promise<void> {
    await this.load(this.eventId());
  }

  /** The walk again, on its own, from the event already on screen. */
  protected async retryChain(): Promise<void> {
    const state = this.event();
    if (state.kind === 'ready') {
      await this.walkFrom(state.value);
    }
  }

  private async walkFrom(event: EventDto): Promise<void> {
    this.chain.set(LOADING);
    try {
      this.chain.set(ready(await this.walker.walk(event)));
    } catch (error) {
      this.chain.set(failed(error));
    }
  }

  /**
   * The badge's tone, which says nothing about an outcome — the same reading the log's rows use.
   * There is no failure event on this bus, and a release being the thing a person came for is a
   * scanning aid rather than a status.
   */
  protected tone(name: string): 'info' | 'neutral' {
    return name === 'SCMRelease' || name === 'SoftwareRelease' ? 'info' : 'neutral';
  }
}
