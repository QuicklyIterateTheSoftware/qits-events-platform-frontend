import type { Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { EventPage } from './event/event-page';
import { LogPage } from './log/log-page';
import { NotFound } from './not-found/not-found';

/**
 * Two pages, both inside the platform chrome.
 *
 * `QitsMainLayout` sits at `''` as a *component* route so the bar and the navigation mount once and
 * survive every navigation beneath them — wrapping it around each page instead would tear the
 * sidebar down and rebuild it on every click.
 *
 * **The event page repeats the noun, and that is the decision rather than an oversight.**
 * `/events/events/:id` reads awkwardly; `/events/:id` — a bare id under the base href — reads
 * better, swallows every future top-level route and makes `**` unreachable, and it cannot be undone
 * once a link is shared. Every sibling repeats its noun (`/ci/runs/…`, `/artifacts/repositories/…`)
 * and this segment matches the API path it mirrors.
 *
 * **Every level that costs a request is URL state.** Here the split is by kind: the event is its
 * own page because it is its own fetch and its own walk, while the log's four filters — name,
 * since, payload search, cursor — are *query parameters*, because they narrow one screen rather
 * than enter a level. Both halves are bookmarkable, and the back button means "undo the filter" on
 * one and "leave the event" on the other.
 *
 * Both pages load eagerly. There are two of them, they share every component below them, and a lazy
 * chunk boundary would be ceremony that costs a round trip.
 *
 * The `**` route sits inside the layout: `/events/` is a segment this application owns outright, so
 * an unknown URL under it is an ordinary 404 and is drawn with the chrome around it. `/events/api`
 * and `/events/stream` never reach it — the service claims both ahead of the SPA.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [
      { path: '', component: LogPage },
      { path: 'events/:id', component: EventPage },
      { path: '**', component: NotFound },
    ],
  },
];
