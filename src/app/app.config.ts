import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideQitsNavigation } from '@qits/ui-components';

import { routes } from './app.routes';

/**
 * Four providers, in the order spa-home documents and every sibling repeats.
 *
 * - `provideBrowserGlobalErrorListeners` funnels genuinely-global errors and unhandled rejections
 *   into Angular's `ErrorHandler`.
 * - `provideRouter` carries this app's state: the event is a path segment and the log's filters are
 *   query parameters, so the URL is what makes both bookmarkable.
 * - `withFetch` is not a preference. The default XHR backend is invisible to OTLP fetch
 *   instrumentation, so choosing it would quietly forfeit client spans the moment this deployment
 *   grows a telemetry relay. Every call this app makes is a same-origin path behind the gateway and
 *   carries no credential at all — this service authenticates nothing by design, and the socket
 *   upgrade was measured answering `101` with none.
 * - `provideQitsNavigation` is what puts links in the shared layout's sidebar. It issues one `GET
 *   /main-navigation` at startup and hands the answer to `QitsMainLayout`: the platform's door list
 *   is the gateway's answer now, derived from the routes it actually serves, rather than a list
 *   compiled into `@qits/ui-components` that lagged every new application. It needs the
 *   `provideHttpClient` above, and without it the sidebar renders empty.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withFetch()),
    provideQitsNavigation(),
  ],
};
