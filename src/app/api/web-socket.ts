import { InjectionToken } from '@angular/core';

/**
 * The part of `WebSocket` this application uses, named so a spec can hand over something else.
 *
 * A socket is opened by the browser and never goes through `HttpClient`, so `HttpTestingController`
 * cannot see it and the seam has to be the constructor itself. This interface is what both sides of
 * it agree on. It is deliberately smaller than the real thing: no `binaryType`, because every frame
 * here is text, and no `addEventListener`, because the four handlers below are the whole protocol.
 *
 * This mirrors `EVENT_SOURCE_FACTORY` in spa-workspaces, which is the same seam over the other
 * one-way transport. The difference that matters is downstream: an `EventSource` reconnects by
 * itself and a `WebSocket` does not, so the retry is this application's to write.
 */
export interface WebSocketLike {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  readonly readyState: number;
  send(data: string): void;
  close(): void;
}

/** `WebSocket.OPEN` — the only state in which a subscribe frame can be sent. */
export const WEB_SOCKET_OPEN = 1;

/** Opens a socket at a URL. One function, so a fake is one function. */
export type WebSocketFactory = (url: string) => WebSocketLike;

/**
 * How this application opens the live stream.
 *
 * A token rather than a bare `new WebSocket(url)` for one reason, and it is the same reason
 * {@link ./api-base#QITS_API_BASE} is one: the socket carries the behaviour most worth testing on
 * this screen — subscribe-on-open, invalidate-on-every-connect, insert-by-`occurredAt`,
 * dedup-by-id, reconnect — and none of it is reachable without driving `onopen`, `onmessage` and
 * `onclose` by hand.
 */
export const WEB_SOCKET_FACTORY = new InjectionToken<WebSocketFactory>('qits.web-socket', {
  providedIn: 'root',
  factory: () => (url: string) => new WebSocket(url) as WebSocketLike,
});

/**
 * The `ws://`/`wss://` address of a path served by this same origin.
 *
 * A socket URL cannot be a bare path the way every other call in this app is, so this is the one
 * place an origin is spelled — and it is read off the document rather than configured, which keeps
 * the same-origin promise intact through the gateway and through `ng serve`'s proxy alike. An
 * explicit base (the dev proxy's, in a spec) wins when it is given.
 */
export function webSocketUrl(base: string, path: string): string {
  const origin = base || (typeof location === 'undefined' ? '' : location.origin);
  return `${origin}${path}`.replace(/^http/, 'ws');
}
