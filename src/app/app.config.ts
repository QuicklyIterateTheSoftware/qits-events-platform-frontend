import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import {
  provideQitsBuilds,
  provideQitsNavigation,
  provideQitsProjects,
  provideQitsScope,
} from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Seven providers, in the order every sibling repeats.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries this app's state: the event is a path segment and the log's filters are
 *   query parameters, so the URL is what makes both bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. Every call this app makes is a same-origin path behind the edge and
 *   carries no credential at all — this service authenticates nothing by design, and the socket
 *   upgrade was measured answering `101` with none.
 * - `provideQitsNavigation` is what puts links in the shared layout's sidebar. It issues one `GET
 *   /main-navigation` at startup and hands the answer to `QitsMainLayout`: the platform's door list
 *   is the edge's answer now, derived from the deployments it actually serves, rather than a list
 *   compiled into `@qits/ui-components` that lagged every new application. It needs the
 *   `provideHttpClient` above, and without it the sidebar renders empty.
 * - `provideQitsProjects` fills the chrome's project picker from one `GET /projects/api/projects`,
 *   and installs the repositories of whatever project is in scope alongside it.
 * - `provideQitsScope('project')` says how deep this application's own addresses go. Every page
 *   here is about the platform's event log, which one project narrows but does not divide, so the
 *   deepest address this app serves is `/<projectSlug>/…` — never the repository form. The scope is
 *   read from the address and nothing else, so picking a project navigates rather than remembers.
 * - `provideQitsBuilds` puts the pending-builds bolt beside the picker: a popover of what qits-ci is
 *   building right now, from `GET /ci/api/runs/active`. Same-origin like every other read here — the
 *   edge routes `/ci` on every vhost — so it needs the `provideHttpClient` above and names no origin
 *   of its own. Providing it is what puts the bolt there, exactly as no project source means no
 *   picker. Closed, it asks nothing at all; it polls only while a reader keeps the panel open.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
    provideQitsProjects(),
    provideQitsScope('project'),
    provideQitsBuilds(),
  ],
};
