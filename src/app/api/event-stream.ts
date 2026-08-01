import { Injectable, inject, signal, type Signal } from '@angular/core';
import { QITS_API_BASE } from './api-base';
import type { EventCreatedFrame } from './dto';
import {
  WEB_SOCKET_FACTORY,
  WEB_SOCKET_OPEN,
  webSocketUrl,
  type WebSocketLike,
} from './web-socket';

/** The path the socket upgrades on. `stream` is a sibling of `api`, because this is not a JSON API. */
const STREAM_PATH = '/events/stream';

/** Subscribing to this instead of a name list means "every name, including ones I do not know". */
export const ALL_NAMES = '*';

/** What a frame handler is handed. Returning nothing; the caller owns its own list. */
export type FrameHandler = (frame: EventCreatedFrame) => void;

/** Stops a handler receiving further frames. Idempotent. */
export type Unsubscribe = () => void;

/**
 * The live tail's transport: one connection, whole events pushed, and a retry the browser will not
 * do for us.
 *
 * **Push the row, do not hint.** Unlike spa-workspaces' channel — which carries payload-free topic
 * names and is answered with a refetch — every frame here *is* the event, so a subscriber inserts
 * it and issues no request at all. The two fields the frame lacks, `createdAt` and `updatedAt`, are
 * two fields the log does not draw; **if that ever stops being true this decision must be revisited
 * in the same commit**, because the push path would silently become lossy.
 *
 * **Opening the socket is not subscribing.** A connection that has sent no `{"subscribe": [...]}`
 * frame receives nothing at all — silence is the server's honest default. So {@link open} sends one
 * on every connect, and every reconnect, before anything can arrive.
 *
 * **Invalidate everything on every connect.** {@link connects} bumps on each open, including
 * reopens. The stream is live-only: no replay, no offset, no resume token, and the gap a
 * disconnected window left is unknowable. A subscriber refetches its first page when this number
 * moves. That is spa-workspaces' rule applied to a different transport, and it is the same trade —
 * a handful of requests on reconnect against a class of correctness bugs. It is **not** a resume
 * protocol and must not be mistaken for one.
 *
 * **Frames are callbacks, not a signal.** A release train pushes five frames inside a few
 * milliseconds; a signal holding "the last frame" would collapse them into one on the next tick and
 * lose four events with no error anywhere. So handlers are called once per frame, synchronously.
 *
 * **The subscription set is replaced wholesale** by each frame the client sends, so a filter change
 * is one `send` rather than a reconnect — and changing the filter refetches anyway, which closes
 * the same gap by the same mechanism, which is what makes the filter mean one thing live and
 * historically.
 *
 * The service is application-scoped but singly-owned: the log page opens it and closes it on
 * destroy. {@link connected} is what draws the quiet stale marker — disconnected means the page is
 * briefly behind, not that it is wrong.
 */
@Injectable({ providedIn: 'root' })
export class EventStream {
  private readonly base = inject(QITS_API_BASE);
  private readonly openSocket = inject(WEB_SOCKET_FACTORY);

  private readonly link = signal(false);
  private readonly opens = signal(0);

  /** Whether the socket is up. False means the data is stale and will catch up, not that it is wrong. */
  readonly connected: Signal<boolean> = this.link.asReadonly();

  /**
   * How many times this stream has connected. Read it in an `effect`; the value is meaningless and
   * only its movement matters — each move means "refetch the first page, the gap is unknowable".
   */
  readonly connects: Signal<number> = this.opens.asReadonly();

  private socket: WebSocketLike | null = null;
  private names: readonly string[] = [ALL_NAMES];
  private handlers = new Set<FrameHandler>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoffMs = 0;
  private wanted = false;

  /**
   * Watch the stream, subscribed to these names. An empty list means every name.
   *
   * Calling it again with the same set does nothing, so an effect may call it freely. Calling it
   * with a different set sends one new subscribe frame over the connection already up — a filter
   * change costs no reconnect and no refetch of its own.
   */
  open(names: readonly string[] = []): void {
    this.wanted = true;
    this.names = names.length > 0 ? [...names] : [ALL_NAMES];
    if (this.socket) {
      this.subscribe();
      return;
    }
    this.connect();
  }

  /** Stop watching, and stop retrying. The page calls this on destroy; nothing else should need to. */
  close(): void {
    this.wanted = false;
    this.clearRetry();
    this.backoffMs = 0;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
    this.link.set(false);
  }

  /**
   * Receive every frame from now on. Returns the way to stop; calling it twice is harmless.
   *
   * Handlers are called in registration order and a throwing one is not allowed to starve the
   * others — a broken renderer must not silence the tail.
   */
  onFrame(handler: FrameHandler): Unsubscribe {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  private connect(): void {
    this.clearRetry();
    const socket = this.openSocket(webSocketUrl(this.base, STREAM_PATH));
    this.socket = socket;
    socket.onopen = () => this.handleOpen();
    socket.onmessage = (event) => this.handleFrame(event.data);
    socket.onerror = () => this.link.set(false);
    socket.onclose = () => this.handleClose();
  }

  private handleOpen(): void {
    this.backoffMs = 0;
    this.link.set(true);
    this.subscribe();
    this.opens.update((count) => count + 1);
  }

  private handleClose(): void {
    this.socket = null;
    this.link.set(false);
    if (this.wanted) {
      this.scheduleRetry();
    }
  }

  /**
   * One frame in: the names this connection wants. `["*"]` is every name, and it is the default —
   * a log with no name filter must show a name this build has never heard of the day it first
   * fires.
   */
  private subscribe(): void {
    if (this.socket && this.socket.readyState === WEB_SOCKET_OPEN) {
      this.socket.send(JSON.stringify({ subscribe: this.names }));
    }
  }

  /**
   * A malformed frame costs the frame and not the connection — the server's own rule for the
   * other direction, kept in this one. Anything without an id is not an event.
   */
  private handleFrame(data: string): void {
    let frame: EventCreatedFrame;
    try {
      frame = JSON.parse(data) as EventCreatedFrame;
    } catch {
      return;
    }
    if (!frame || typeof frame.id !== 'string') {
      return;
    }
    for (const handler of [...this.handlers]) {
      try {
        handler(frame);
      } catch (error) {
        // One broken renderer must not starve the others or kill the tail — but it must not
        // disappear either. Rethrowing on its own turn puts it in front of the global error
        // listener `app.config.ts` installs, which is where an application error belongs.
        setTimeout(() => {
          throw error;
        });
      }
    }
  }

  /**
   * Reconnect, backing off 1s, 2s, 4s … to 30s, and reset by the next successful open.
   *
   * The browser retries an `EventSource` on its own and does nothing at all for a socket, so this
   * is the piece spa-workspaces did not have to write. The ceiling is 30 seconds because the worst
   * case is a service redeploying itself — which qits-events does on every release of its own SPA —
   * and that is over in well under a minute.
   */
  private scheduleRetry(): void {
    this.backoffMs = this.backoffMs === 0 ? 1000 : Math.min(this.backoffMs * 2, 30000);
    this.retry = setTimeout(() => {
      this.retry = null;
      if (this.wanted) {
        this.connect();
      }
    }, this.backoffMs);
  }

  private clearRetry(): void {
    if (this.retry !== null) {
      clearTimeout(this.retry);
      this.retry = null;
    }
  }
}
