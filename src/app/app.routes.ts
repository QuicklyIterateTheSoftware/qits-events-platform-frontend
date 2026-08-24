import type { Route, Routes } from '@angular/router';
import { QitsMainLayout } from '@qits/ui-components';
import { EventPage } from './event/event-page';
import { LogPage } from './log/log-page';
import { NotFound } from './not-found/not-found';

/**
 * Two pages, each reachable twice: once at the root and once under a project.
 *
 * `QitsMainLayout` sits at `''` as a *component* route so the bar and the navigation mount once and
 * survive every navigation beneath them — wrapping it around each page instead would tear the
 * sidebar down and rebuild it on every click.
 *
 * **The event page repeats the noun, and that is the decision rather than an oversight.**
 * `/events/:id` — a bare id at the root — reads better, swallows every future top-level route and
 * makes `**` unreachable, and it cannot be undone once a link is shared. Every sibling repeats its
 * noun (`/runs/…`, `/repositories/…`) and this segment matches the API path it mirrors.
 *
 * **Every level that costs a request is URL state.** Here the split is by kind: the event is its
 * own page because it is its own fetch and its own walk, while the log's four filters — name,
 * since, payload search, cursor — are *query parameters*, because they narrow one screen rather
 * than enter a level. Both halves are bookmarkable, and the back button means "undo the filter" on
 * one and "leave the event" on the other.
 *
 * Both pages load eagerly. There are two of them, they share every component below them, and a lazy
 * chunk boundary would be ceremony that costs a round trip.
 */
const OWN: Routes = [
  { path: '', component: LogPage },
  { path: 'events/:id', component: EventPage },
];

/**
 * The same two pages under a project slug — `/qits/events/<id>` beside `/events/<id>`.
 *
 * **Order is the whole guard.** The literal routes above are matched first, so `/events` stays this
 * app's own event route and never reads as a project called `events`; only what none of them claim
 * falls through to `:project`. A page never reads these parameters: it asks `QITS_SCOPE`, which
 * parses the address the same way in both forms, so one component serves both.
 *
 * This app is project scoped and not repository scoped: the log is the platform's, and a project
 * narrows it rather than dividing it, so there is no `/<slug>/<category>/<repo>/` address here.
 */
const SCOPED: Route = { path: ':project', children: OWN };

/**
 * The `**` route sits inside the layout: this application is served at the root of its own host, so
 * an unknown URL is an ordinary 404 and is drawn with the chrome around it. `/events/api` and
 * `/events/stream` never reach it — the service claims both ahead of the SPA.
 */
export const routes: Routes = [
  {
    path: '',
    component: QitsMainLayout,
    children: [...OWN, SCOPED, { path: '**', component: NotFound }],
  },
];
