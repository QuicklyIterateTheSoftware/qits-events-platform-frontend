import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink, convertToParamMap } from '@angular/router';

/**
 * One event and its chain — **a placeholder, and it says so on screen.**
 *
 * The route and its `:id` are real, so a deep link already lands here with the id in hand; the
 * header, the payload renderer and the bounded walker land in the workstream that follows.
 *
 * The budget that page will have to keep: **`1 + U + D`** — the event itself, `U` hops up by
 * `parentId` and `D` breadth-first `?parentId=` calls down from the root. Measured on live data
 * that is 2 requests for a root with no children and 8 for the largest component the platform has
 * ever produced. The caps — 32 hops up, depth 8 and 200 nodes down, and an id-seen set on both
 * walks — exist because the API bounds nothing for us and because nothing server-side prevents a
 * cycle. When a cap is hit the tree draws a "bounded here" node; it never truncates in silence.
 *
 * Two facts about this data that the walker must not treat as errors: a `parentId` that answers
 * **404** is a chain start whose cause was deleted on purpose, and there is a live row that needs
 * that rendering today; and `?parentId=` answers **200 with an empty list** for an id that is not in
 * the log at all, so "no children" and "no such event" are the same response.
 */
@Component({
  selector: 'app-event-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <p class="crumbs"><a routerLink="/">Events</a><span class="sep">/</span>{{ eventId() }}</p>
    <h1>One event</h1>
    <p class="lede">
      The event page is not built yet. This page is the route it will mount into, and the id above
      is the one the URL carried.
    </p>
  `,
  styleUrls: ['../ui/page.css'],
  styles: `
    h1 {
      margin: 0;
      font-size: 1.4rem;
    }
  `,
})
export class EventPage {
  private readonly route = inject(ActivatedRoute);

  private readonly params = toSignal(this.route.paramMap, {
    initialValue: convertToParamMap({}),
  });

  /**
   * The event's id, as the path segment spells it. It is a UUID and it is not validated here: an id
   * that is not in the log answers 404, which is this page's own state rather than a routing
   * decision.
   */
  protected readonly eventId = computed(() => this.params().get('id') ?? '');
}
