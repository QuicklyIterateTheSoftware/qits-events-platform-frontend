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
import type { EventDto } from '../api/dto';
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
 */
describe('LogPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

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

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
    http = TestBed.inject(HttpTestingController);
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
});
