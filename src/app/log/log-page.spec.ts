import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventCreatedFrame, EventDto } from '../api/dto';
import { WEB_SOCKET_FACTORY, WEB_SOCKET_OPEN, type WebSocketLike } from '../api/web-socket';
import { routes } from '../app.routes';

/**
 * The log, one state at a time.
 *
 * The assertion this file exists for is the first one: **two requests, and none per row.** One page
 * of the log and one vocabulary, whatever the store holds — so the cost of the front door does not
 * grow with the log, and the cause column stays a link rather than becoming a count that would cost
 * one request per row.
 *
 * The rest are about honesty: a filter is carried into the request and never applied to rows
 * already fetched, a window that does not start at the top of the log says so, a page boundary that
 * falls on a tie repeats nothing, and a server that cannot page yet is reported rather than
 * silently truncated.
 *
 * The live tail is driven by hand at the bottom of the file — turned on, connected, pushed, dropped
 * and reopened — because a socket never goes through `HttpClient` and `HttpTestingController` cannot
 * see one. What those cases are really asserting is that an arrival costs **no request**, and that a
 * frame the request would not have returned never reaches the screen.
 */
describe('LogPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;
  let sockets: FakeSocket[];

  const CURSOR = '2026-08-01T08:52:23.928965Z,0bdbe98d-0000-0000-0000-000000000000';

  const build = (over: Partial<EventDto> = {}): EventDto => ({
    id: 'a3528932-0000-0000-0000-000000000000',
    name: 'BuildSuccessful',
    occurredAt: '2026-08-01T08:52:29Z',
    payload: JSON.stringify({
      branch: 'main',
      commitSha: 'a35289326fbb2c1f5b9a0e7d4c3b2a19',
      repoId: 'qits-spa-home',
      runId: '9f0c',
    }),
    description: null,
    parentId: null,
    createdAt: '2026-08-01T08:52:29.1Z',
    updatedAt: '2026-08-01T08:52:29.1Z',
    ...over,
  });

  const release = (over: Partial<EventDto> = {}): EventDto =>
    build({
      id: 'c5edabb5-0621-4ff8-bf1b-29a3df2bb03c',
      name: 'SCMRelease',
      occurredAt: '2026-08-01T08:51:49Z',
      payload: JSON.stringify({
        branch: 'main',
        projectId: 'qits',
        repository: 'qits-spa-ui-components',
        version: '2026.801.85149',
      }),
      ...over,
    });

  const frame = (over: Partial<EventCreatedFrame> = {}): EventCreatedFrame => ({
    id: '99c733d8-0000-0000-0000-000000000000',
    name: 'BuildSuccessful',
    occurredAt: '2026-08-01T09:30:00Z',
    payload: JSON.stringify({ branch: 'main', repoId: 'qits-spa-ci', runId: '7c1a' }),
    description: null,
    parentId: null,
    ...over,
  });

  beforeEach(() => {
    sockets = [];
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
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
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function open(url = '/'): Promise<void> {
    harness = await RouterTestingHarness.create(url);
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function listRequest(): TestRequest {
    return http.expectOne((request) => request.url === '/events/api/events');
  }

  function flushNames(names: readonly string[] = ['BuildSuccessful', 'SCMRelease']): void {
    http.expectOne('/events/api/events/names').flush({ names });
  }

  function flushList(events: readonly EventDto[], nextCursor?: string | null): TestRequest {
    const request = listRequest();
    request.flush(nextCursor === undefined ? { events } : { events, nextCursor });
    return request;
  }

  function press(label: string): void {
    const button = Array.from(page().querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    button?.click();
  }

  function bodyRows(): number {
    return page().querySelectorAll('tbody tr').length;
  }

  /** Each row's time cell, in the order they are drawn — the one place the order is visible. */
  function rowTimes(): readonly string[] {
    return Array.from(page().querySelectorAll('tbody tr th')).map((cell) =>
      (cell.textContent ?? '').trim(),
    );
  }

  /** The reader flipping the live tail's switch. */
  function toggleTail(): void {
    (page().querySelector('app-live-tail input[type="checkbox"]') as HTMLInputElement).click();
  }

  /** What the quiet marker beside the switch is saying. */
  function tailMark(): string {
    return (page().querySelector('app-live-tail .mark')?.textContent ?? '').trim();
  }

  /** The log on screen, the tail switched on and connected, and the connect's refetch answered. */
  async function tailing(events: readonly EventDto[] = [build()], url = '/'): Promise<void> {
    await open(url);
    flushList(events);
    flushNames();
    await settle();
    toggleTail();
    await settle();
    sockets[0].open();
    await settle();
    flushList(events, null);
    await settle();
  }

  it('reads one page and one vocabulary, and nothing at all per row', async () => {
    await open();
    const request = listRequest();
    expect(request.request.params.get('limit')).toBe('200');
    expect(request.request.params.has('cursor')).toBe(false);
    request.flush({ events: [build(), release(), build({ id: '049165ec-0000-0000-0000-0000' })] });
    flushNames();
    await settle();

    // Three events on screen and no further traffic: the variable term of the budget is zero, and
    // the cause column is a link rather than a per-row child count.
    http.verify();
    expect(text()).toContain('3 events');
  });

  it('draws the time, the name, the repository and the payload’s gist on every row', async () => {
    await open();
    flushList([build(), release()]);
    flushNames();
    await settle();

    expect(text()).toContain('1 Aug 08:52');
    expect(text()).toContain('qits-spa-home');
    expect(text()).toContain('main · a352893');
    expect(text()).toContain('qits-spa-ui-components');
    expect(text()).toContain('2026.801.85149 · main');
  });

  it('links a row to its own page and a caused row to its cause, and counts nothing', async () => {
    await open();
    flushList([build({ parentId: 'c5edabb5-0621-4ff8-bf1b-29a3df2bb03c' }), release()]);
    flushNames();
    await settle();

    const links = Array.from(page().querySelectorAll('tbody a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toContain('/events/a3528932-0000-0000-0000-000000000000');
    expect(links).toContain('/events/c5edabb5-0621-4ff8-bf1b-29a3df2bb03c');
    http.verify();
  });

  it('carries the URL’s filters into the request rather than filtering what it fetched', async () => {
    await open('/?name=SCMRelease,SoftwareRelease&q=qits-stt&since=2026-08-01T00:00:00Z');
    const request = listRequest();

    expect(request.request.params.get('name')).toBe('SCMRelease,SoftwareRelease');
    expect(request.request.params.get('q')).toBe('qits-stt');
    expect(request.request.params.get('since')).toBe('2026-08-01T00:00:00Z');

    request.flush({ events: [release()] });
    flushNames();
    await settle();
    http.verify();
  });

  it('refetches from the head on a filter change, and reads the vocabulary only once', async () => {
    await open();
    flushList([build(), release()]);
    flushNames(['BuildSuccessful', 'SCMRelease']);
    await settle();

    const checkbox = Array.from(page().querySelectorAll('input[type="checkbox"]')).find(
      (input) => (input.parentElement?.textContent ?? '').trim() === 'SCMRelease',
    ) as HTMLInputElement;
    checkbox.click();
    await settle();

    const request = listRequest();
    expect(request.request.params.get('name')).toBe('SCMRelease');
    expect(request.request.params.has('cursor')).toBe(false);
    request.flush({ events: [release()] });
    await settle();

    http.expectNone('/events/api/events/names');
    expect(TestBed.inject(Router).url).toContain('name=SCMRelease');
    expect(text()).toContain('1 event');
  });

  it('appends the next page, asks for it with the composite cursor, and repeats no row', async () => {
    await open();
    flushList([build(), release()], CURSOR);
    flushNames();
    await settle();

    press('Load more');
    await settle();

    const request = listRequest();
    expect(request.request.params.get('cursor')).toBe(CURSOR);
    request.flush({
      // The tie's other sibling, plus the row already on screen: a page boundary on a shared
      // instant may hand back a row that was already drawn, and it must not be drawn twice.
      events: [release(), build({ id: '99c733d8-0000-0000-0000-000000000000' })],
      nextCursor: null,
    });
    await settle();

    expect(bodyRows()).toBe(3);
    expect(text()).toContain('3 events');
    expect(text()).toContain('That is the end of the log');
  });

  it('remembers how far the reader got in the address, without a history entry per press', async () => {
    await open();
    flushList([build()], CURSOR);
    flushNames();
    await settle();

    press('Load more');
    await settle();
    listRequest().flush({ events: [release()], nextCursor: null });
    await settle();

    expect(decodeURIComponent(TestBed.inject(Router).url)).toContain(`cursor=${CURSOR}`);
  });

  it('resumes at the cursor an address carries, in one request, and says the window is not the top', async () => {
    await open(`/?cursor=${encodeURIComponent(CURSOR)}`);
    const request = listRequest();
    expect(request.request.params.get('cursor')).toBe(CURSOR);
    request.flush({ events: [release()], nextCursor: null });
    flushNames();
    await settle();

    http.verify();
    expect(text()).toContain('This window starts partway down the log');
  });

  it('refreshes the window it is showing, not the head of a log it is not', async () => {
    await open(`/?cursor=${encodeURIComponent(CURSOR)}`);
    flushList([release()], null);
    flushNames();
    await settle();

    // The same hook the live tail refetches through on every connect: it must land on the top of
    // the window on screen, or a resumed reader would silently be moved to the newest events.
    press('Refresh');
    await settle();

    expect(listRequest().request.params.get('cursor')).toBe(CURSOR);
  });

  it('says the vocabulary is unavailable and leaves the log standing beside it', async () => {
    await open();
    flushList([build()]);
    http
      .expectOne('/events/api/events/names')
      .flush({ message: 'no such event' }, { status: 404, statusText: 'Not Found' });
    await settle();

    expect(text()).toContain('Vocabulary unavailable');
    expect(text()).toContain('qits-spa-home');
  });

  it('tells a filter that matches nothing from a log that holds nothing', async () => {
    await open('/?q=nothing-matches-this');
    flushList([]);
    flushNames();
    await settle();

    expect(text()).toContain('No event matches these filters');
  });

  it('says the log is empty when it genuinely is', async () => {
    await open();
    flushList([]);
    flushNames();
    await settle();

    expect(text()).toContain('The log holds no events at all');
  });

  it('reports a failed log rather than drawing an empty one, and offers it a retry', async () => {
    await open();
    listRequest().flush({ message: 'down' }, { status: 503, statusText: 'Service Unavailable' });
    flushNames();
    await settle();

    expect(text()).toContain('Could not load the log');
    expect(text()).not.toContain('The log holds no events at all');

    press('Retry');
    await settle();
    flushList([build()]);
    await settle();

    expect(text()).toContain('qits-spa-home');
  });

  it('draws the newest 200 and says so when a server answers with more and pages none of it', async () => {
    await open();
    const events = Array.from({ length: 201 }, (_, index) =>
      build({ id: `${index}`.padStart(8, '0') + '-0000-0000-0000-000000000000' }),
    );
    flushList(events);
    flushNames();
    await settle();

    expect(bodyRows()).toBe(200);
    expect(text()).toContain('paged none of them');
  });

  it('opens no socket until the reader asks for one, and says the log is a snapshot', async () => {
    await open();
    flushList([build()]);
    flushNames();
    await settle();

    // The front door is two requests and no connection at all. The third request the tail costs is
    // behind the switch, where the reader can see what it bought.
    expect(sockets).toHaveLength(0);
    expect(tailMark()).toContain('snapshot');
    http.verify();
  });

  it('connects, subscribes to every name, and refetches the window on the first connect', async () => {
    await open();
    flushList([build()]);
    flushNames();
    await settle();

    toggleTail();
    await settle();
    expect(sockets).toHaveLength(1);
    expect(tailMark()).toContain('Connecting');

    sockets[0].open();
    await settle();
    expect(sockets[0].subscribed).toEqual(['*']);

    // The stream is live-only: connecting says nothing about what was missed, so the window is read
    // again. It is the window's own start, not the head of a log this page may not be showing.
    const request = listRequest();
    expect(request.request.params.has('cursor')).toBe(false);
    request.flush({ events: [build()], nextCursor: null });
    await settle();

    expect(tailMark()).toContain('Live');
    http.verify();
  });

  it('subscribes to the name filter’s own set, so a filter means one thing live and historically', async () => {
    await tailing([release()], '/?name=SCMRelease');
    expect(sockets[0].subscribed).toEqual(['SCMRelease']);
  });

  it('changes the subscription with one frame rather than a reconnect', async () => {
    await tailing();

    const checkbox = Array.from(page().querySelectorAll('input[type="checkbox"]')).find(
      (input) => (input.parentElement?.textContent ?? '').trim() === 'SCMRelease',
    ) as HTMLInputElement;
    checkbox.click();
    await settle();
    flushList([release()], null);
    await settle();

    expect(sockets).toHaveLength(1);
    expect(sockets[0].subscribed).toEqual(['SCMRelease']);
  });

  it('draws a pushed frame and issues no request for it', async () => {
    await tailing();

    sockets[0].push(frame());
    await settle();

    expect(bodyRows()).toBe(2);
    expect(text()).toContain('qits-spa-ci');
    // The whole of ⚖3: the frame *is* the event, so a live row costs nothing at all.
    http.verify();
  });

  it('places a frame by its own instant rather than at the top of the screen', async () => {
    await tailing();

    // `occurredAt` is the caller's time and may be in the past; a prepend would put this row above a
    // newer one and then disagree with the next refetch.
    sockets[0].push(frame({ occurredAt: '2026-08-01T08:00:00Z' }));
    await settle();

    expect(rowTimes()).toEqual(['1 Aug 08:52', '1 Aug 08:00']);
  });

  it('drops a frame whose id is already on screen', async () => {
    await tailing();

    // A refetch and a frame overlap by construction: frames keep arriving while the invalidating
    // fetch is in flight.
    sockets[0].push(frame({ id: 'a3528932-0000-0000-0000-000000000000' }));
    await settle();

    expect(bodyRows()).toBe(1);
  });

  it('holds a frame the name filter would not have returned', async () => {
    await tailing([release()], '/?name=SCMRelease');

    sockets[0].push(frame({ name: 'BuildSuccessful' }));
    await settle();

    expect(bodyRows()).toBe(1);
  });

  it('holds a frame below the time floor, which the socket has no way to filter', async () => {
    await tailing([build()], '/?since=2026-08-01T08:00:00.000Z');

    sockets[0].push(frame({ occurredAt: '2026-07-31T13:21:00Z' }));
    await settle();
    expect(bodyRows()).toBe(1);

    sockets[0].push(frame({ occurredAt: '2026-08-01T09:30:00Z' }));
    await settle();
    expect(bodyRows()).toBe(2);
  });

  it('holds a frame the payload search would not have returned', async () => {
    await tailing([build()], '/?q=qits-spa-home');

    sockets[0].push(frame({ payload: '{"repoId":"qits-spa-ci"}' }));
    await settle();
    expect(bodyRows()).toBe(1);

    sockets[0].push(frame({ payload: '{"repoId":"qits-spa-home"}' }));
    await settle();
    expect(bodyRows()).toBe(2);
  });

  it('says it is reconnecting, refetches when it comes back, and repeats no row', async () => {
    await tailing();
    sockets[0].push(frame());
    await settle();
    expect(bodyRows()).toBe(2);

    // Only the stream's own backoff is faked, and only for as long as it takes to fire. Faking the
    // whole clock would take the framework's scheduling with it.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    sockets[0].drop();
    vi.advanceTimersByTime(1000);
    vi.useRealTimers();
    await settle();

    expect(tailMark()).toContain('Reconnecting');
    expect(sockets).toHaveLength(2);

    sockets[1].open();
    await settle();
    expect(sockets[1].subscribed).toEqual(['*']);

    // The refetch is what heals an at-most-once channel, and the row that arrived by frame is in it.
    listRequest().flush({
      events: [
        build(),
        { ...frame(), createdAt: '2026-08-01T09:30:01Z', updatedAt: '' } as EventDto,
      ],
      nextCursor: null,
    });
    await settle();

    expect(bodyRows()).toBe(2);
    expect(tailMark()).toContain('Live');
  });

  it('closes the socket and stops inserting when the tail is switched off', async () => {
    await tailing();

    toggleTail();
    await settle();

    expect(sockets[0].closed).toBe(true);
    expect(tailMark()).toContain('snapshot');
    sockets[0].push(frame());
    await settle();
    expect(bodyRows()).toBe(1);
  });

  it('holds its frames in a window a cursor bounds above, and says why', async () => {
    await open(`/?cursor=${encodeURIComponent(CURSOR)}`);
    flushList([release()], null);
    flushNames();
    await settle();

    toggleTail();
    await settle();
    sockets[0].open();
    await settle();
    const refetch = listRequest();
    expect(refetch.request.params.get('cursor')).toBe(CURSOR);
    refetch.flush({ events: [release()], nextCursor: null });
    await settle();

    // The window's ceiling is the cursor, so an event created a moment ago is outside it. Inserting
    // it would draw a row the window does not contain.
    expect(tailMark()).toContain('Paused');
    sockets[0].push(frame());
    await settle();

    expect(bodyRows()).toBe(1);
    http.verify();
  });
});

/**
 * The socket, driven by hand: open it, push a frame, drop it.
 *
 * The same shape `event-stream.spec.ts` uses, because the seam is the same one — a socket is opened
 * by the browser and there is no test transport that can see it.
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

  open(): void {
    this.onopen?.(new Event('open'));
  }

  push(frame: unknown): void {
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(frame) }));
  }

  drop(): void {
    this.onclose?.(new CloseEvent('close'));
  }

  /** What this connection subscribed to, last frame wins — the server replaces the set wholesale. */
  get subscribed(): readonly string[] {
    const last = this.sent.at(-1);
    return last ? (JSON.parse(last) as { subscribe: string[] }).subscribe : [];
  }
}
