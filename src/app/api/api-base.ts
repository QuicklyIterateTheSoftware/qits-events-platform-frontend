import { InjectionToken } from '@angular/core';

/**
 * The origin every request in this app is built on, and it is empty on purpose.
 *
 * The SPA is served at `/events/` by qits-events itself, behind the same gateway that serves
 * `/events/api/…` and upgrades `/events/stream` — so a same-origin absolute path is not a
 * shortcut, it is what keeps these reads free of CORS and of any credential. A configured base URL
 * would move them cross-origin and buy nothing: every read here is already unauthenticated, and the
 * websocket upgrade was measured answering `101` with no credential at all.
 *
 * It is a token rather than a constant for one reason: a spec needs a seam to assert the path
 * against, and `ng serve` (no gateway in front) may want the dev proxy's prefix. That is the shape
 * spa-ci, spa-cd and spa-artifacts settled on, and it adds no behaviour, only a handle.
 */
export const QITS_API_BASE = new InjectionToken<string>('qits.api-base', {
  providedIn: 'root',
  factory: () => '',
});
