import { TestBed } from '@angular/core/testing';
import type { EventCreatedFrame } from './dto';
import { ALL_NAMES, EventStream } from './event-stream';
import { WEB_SOCKET_FACTORY, WEB_SOCKET_OPEN, type WebSocketLike } from './web-socket';

/**
 * The tail, driven by hand — open, subscribe, frame, close, reopen — because none of it is
 * reachable otherwise: a socket never goes through `HttpClient` and `HttpTestingController` cannot
 * see it.
 *
 * The two behaviours worth the whole file are **subscribe on every open** (a connection that has
 * not subscribed receives nothing at all, so a reconnect that forgot would go quiet and look
 * healthy) and **the connect counter moving on every open** (the stream is live-only, and the gap a
 * disconnect left is unknowable).
 */
class FakeSocket implements WebSocketLike {
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readyState = WEB_SOCKET_OPEN;
  readonly sent: string[] = [];
  closed = false;

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  /** The server accepting the upgrade. */
  open(): void {
    this.onopen?.(new Event('open'));
  }

  /** One text frame in. */
  push(frame: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  /** One frame that is not JSON at all. */
  pushRaw(data: string): void {
    this.onmessage?.(new MessageEvent('message', { data }));
  }

  /** The connection going away without anyone asking. */
  drop(): void {
    this.onclose?.(new CloseEvent('close'));
  }

  /** What this connection subscribed to, last frame wins — the server replaces the set wholesale. */
  get subscribed(): readonly string[] {
    const last = this.sent.at(-1);
    return last ? (JSON.parse(last) as { subscribe: string[] }).subscribe : [];
  }
}

describe('EventStream', () => {
  let sockets: FakeSocket[];
  let stream: EventStream;

  beforeEach(() => {
    // Only the retry's own timer. Faking the whole clock would take Angular's scheduling with it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sockets = [];
    TestBed.configureTestingModule({
      providers: [
        {
          provide: WEB_SOCKET_FACTORY,
          useValue: (url: string) => {
            const socket = new FakeSocket(url);
            sockets.push(socket);
            return socket;
          },
        },
      ],
    });
    stream = TestBed.inject(EventStream);
  });

  afterEach(() => {
    stream.close();
    vi.useRealTimers();
  });

  const frame = (id: string, name = 'BuildSuccessful'): EventCreatedFrame => ({
    id,
    name,
    occurredAt: '2026-08-01T08:52:23.928965Z',
    payload: '{"repoId":"qits-spa-home"}',
    description: null,
    parentId: null,
    environment: null,
  });

  it('opens the stream at the service’s own path, on this origin', () => {
    stream.open();
    expect(sockets).toHaveLength(1);
    expect(sockets[0].url).toMatch(/^wss?:\/\/.+\/events\/stream$/);
  });

  it('is not connected until the socket opens', () => {
    stream.open();
    expect(stream.connected()).toBe(false);
    sockets[0].open();
    expect(stream.connected()).toBe(true);
  });

  it('subscribes to everything when no name filter is set', () => {
    stream.open();
    sockets[0].open();
    expect(sockets[0].subscribed).toEqual([ALL_NAMES]);
  });

  it('subscribes to the filter’s own set', () => {
    stream.open(['SCMRelease', 'SoftwareRelease']);
    sockets[0].open();
    expect(sockets[0].subscribed).toEqual(['SCMRelease', 'SoftwareRelease']);
  });

  it('changes the filter with one more frame, not a reconnect', () => {
    stream.open(['SCMRelease']);
    sockets[0].open();
    stream.open(['BuildSuccessful']);
    expect(sockets).toHaveLength(1);
    expect(sockets[0].sent).toHaveLength(2);
    expect(sockets[0].subscribed).toEqual(['BuildSuccessful']);
  });

  it('counts every connect, so a subscriber refetches on the first one and on each reconnect', () => {
    expect(stream.connects()).toBe(0);
    stream.open();
    sockets[0].open();
    expect(stream.connects()).toBe(1);

    sockets[0].drop();
    expect(stream.connected()).toBe(false);
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(stream.connects()).toBe(2);
  });

  it('subscribes again on a reconnect, because a silent connection looks healthy', () => {
    stream.open(['SCMRelease']);
    sockets[0].open();
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    sockets[1].open();
    expect(sockets[1].subscribed).toEqual(['SCMRelease']);
  });

  it('backs off 1s then 2s between retries, and resets on a successful open', () => {
    stream.open();
    sockets[0].open();

    sockets[0].drop();
    vi.advanceTimersByTime(999);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    sockets[1].drop();
    vi.advanceTimersByTime(1999);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);

    sockets[2].open();
    sockets[2].drop();
    vi.advanceTimersByTime(1000);
    expect(sockets).toHaveLength(4);
  });

  it('hands every frame to every handler, one call per frame', () => {
    const seen: string[] = [];
    stream.onFrame((received) => seen.push(received.id));
    stream.open();
    sockets[0].open();

    sockets[0].push(frame('a'));
    sockets[0].push(frame('b'));
    sockets[0].push(frame('c'));

    expect(seen).toEqual(['a', 'b', 'c']);
  });

  it('does not let one throwing handler starve the next, or the connection', () => {
    const seen: string[] = [];
    stream.onFrame(() => {
      throw new Error('a broken renderer');
    });
    stream.onFrame((received) => seen.push(received.id));
    stream.open();
    sockets[0].open();

    sockets[0].push(frame('a'));

    expect(seen).toEqual(['a']);
    expect(stream.connected()).toBe(true);
    // The rethrow is queued for the global error listener; drop it rather than fail this spec.
    vi.clearAllTimers();
  });

  it('stops handing frames to an unsubscribed handler', () => {
    const seen: string[] = [];
    const stop = stream.onFrame((received) => seen.push(received.id));
    stream.open();
    sockets[0].open();
    sockets[0].push(frame('a'));
    stop();
    sockets[0].push(frame('b'));
    expect(seen).toEqual(['a']);
  });

  it('loses a malformed frame and not the connection', () => {
    const seen: string[] = [];
    stream.onFrame((received) => seen.push(received.id));
    stream.open();
    sockets[0].open();

    sockets[0].pushRaw('{not json');
    sockets[0].push({ name: 'BuildSuccessful' });
    sockets[0].push(frame('a'));

    expect(seen).toEqual(['a']);
    expect(stream.connected()).toBe(true);
  });

  it('keeps a frame carrying a field this build has never heard of', () => {
    const seen: EventCreatedFrame[] = [];
    stream.onFrame((received) => seen.push(received));
    stream.open();
    sockets[0].open();
    sockets[0].push({ ...frame('a'), somethingNew: 'appended later' });
    expect(seen).toMatchObject([{ id: 'a', name: 'BuildSuccessful' }]);
  });

  it('stops retrying once closed, so a destroyed page leaves no socket behind', () => {
    stream.open();
    sockets[0].open();
    stream.close();
    expect(sockets[0].closed).toBe(true);
    expect(stream.connected()).toBe(false);
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
  });

  it('does not reconnect after a close that the page asked for', () => {
    stream.open();
    sockets[0].open();
    stream.close();
    sockets[0].drop();
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);
  });
});
