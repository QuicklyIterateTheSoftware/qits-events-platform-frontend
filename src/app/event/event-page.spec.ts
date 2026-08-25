import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import type { EventDto } from '../api/dto';
import { routes } from '../app.routes';
import { DOWN_DEPTH_CAP } from './chain';

/**
 * The event page, one state at a time.
 *
 * The assertion this file exists for is the first one: **`1 + U + D` and not one request more**,
 * measured on the live shape it is written from — 2 for a childless root and 8 for the five-node
 * release train entered from its deepest leaf. Everything the page draws beyond the tree is read
 * out of events already fetched, so the budget is the whole of the page's cost.
 *
 * The rest are about honesty. A cause that is not in the log is drawn as the chain's start and
 * never as an error, because there is a live row that needs that today. A cap that is reached says
 * so on the page. A walk that fails takes the tree down and leaves the event standing, because half
 * a graph drawn as though it were whole is the one outcome this page must never produce.
 */
describe('EventPage', () => {
  let http: HttpTestingController;
  let harness: RouterTestingHarness;

  const ROOT = 'c5edabb5-0621-4ff8-bf1b-29a3df2bb03c';
  const BUILD = '99c733d8-bff8-4438-8bd4-7f8b219a4d32';
  const RELEASE = '0bdbe98d-6fc8-4018-9e5c-a97e8159ad79';
  const UNDER_BUILD = '049165ec-0000-4000-8000-000000000000';
  const UNDER_RELEASE = 'a3528932-0000-4000-8000-000000000000';
  const ORPHAN = '59934bf8-ebc6-4760-bec2-cbe7cafd0371';
  const DELETED = '064158b0-837f-40aa-aa3c-d287d34f929e';

  /** The instant a release fork's siblings share, by construction, to the microsecond. */
  const TIE = '2026-08-01T08:52:23.928965Z';

  const event = (id: string, over: Partial<EventDto> = {}): EventDto => ({
    id,
    name: 'BuildSuccessful',
    occurredAt: '2026-08-01T08:52:29Z',
    payload: JSON.stringify({
      branch: 'main',
      commitSha: '2633238c8828849df8f5fbc78e4838f21c1995be',
      repoId: 'qits-spa-home',
      runId: '32acd2b9',
    }),
    description: null,
    parentId: null,
    environment: null,
    createdAt: '2026-08-01T08:52:29.1Z',
    updatedAt: '2026-08-01T08:52:29.2Z',
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

  async function open(id: string): Promise<void> {
    harness = await RouterTestingHarness.create(`/events/${id}`);
    await settle();
  }

  async function settle(): Promise<void> {
    for (let round = 0; round < 8; round += 1) {
      await Promise.resolve();
      await harness.fixture.whenStable();
    }
  }

  function page(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function text(): string {
    return page().textContent ?? '';
  }

  /** The event itself, answered in its envelope — the shape the service actually sends. */
  async function answerGet(id: string, found: EventDto | null): Promise<void> {
    const request = http.expectOne(`/events/api/events/${id}`);
    if (found === null) {
      request.flush(
        { message: `Event not found: ${id}` },
        { status: 404, statusText: 'Not Found' },
      );
    } else {
      request.flush({ event: found });
    }
    await settle();
  }

  function answerChildren(parentId: string, children: readonly EventDto[]): void {
    http
      .expectOne(
        (request) =>
          request.url === '/events/api/events' && request.params.get('parentId') === parentId,
      )
      .flush({ events: children, nextCursor: null });
  }

  async function answerLevel(level: Record<string, readonly EventDto[]>): Promise<void> {
    for (const [parentId, children] of Object.entries(level)) {
      answerChildren(parentId, children);
    }
    await settle();
  }

  /** The chain table's rows, as the reader sees them. */
  function rows(): readonly string[] {
    return Array.from(page().querySelectorAll('tbody tr')).map((row) =>
      (row.textContent ?? '').replace(/\s+/g, ' ').trim(),
    );
  }

  it('costs two requests for a root that caused nothing, and says so on the page', async () => {
    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, event(UNDER_RELEASE));
    await answerLevel({ [UNDER_RELEASE]: [] });

    // One for the event and one to learn that it caused nothing: `1 + 0 + 1`, the common case, and
    // nothing at all per drawn row. The header, the payload and every cell of the table are read
    // out of what has already arrived.
    http.verify();
    expect(text()).toContain('1 event · 2 requests');
    expect(rows()).toHaveLength(1);
  });

  it('walks the live release train for eight requests and draws the fork as a fork', async () => {
    const root = event(ROOT, {
      name: 'SCMRelease',
      occurredAt: '2026-08-01T08:51:49Z',
      payload: JSON.stringify({
        branch: 'main',
        projectId: 'qits',
        repository: 'qits-spa-ui-components',
        version: '2026.801.85149',
      }),
    });
    const build = event(BUILD, {
      occurredAt: TIE,
      parentId: ROOT,
      payload: JSON.stringify({ branch: 'main', repoId: 'qits-spa-ui-components' }),
    });
    const release = event(RELEASE, {
      name: 'SoftwareRelease',
      occurredAt: TIE,
      parentId: ROOT,
      payload: JSON.stringify({
        packageName: '@qits/ui-components',
        packageType: 'npm',
        repository: 'qits-spa-ui-components',
        version: '2026.801.85149',
      }),
    });
    const underBuild = event(UNDER_BUILD, {
      parentId: BUILD,
      payload: JSON.stringify({ branch: 'main', repoId: 'qits-spa-workspaces' }),
    });
    const underRelease = event(UNDER_RELEASE, { parentId: RELEASE });

    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, underRelease);
    await answerGet(RELEASE, release);
    await answerGet(ROOT, root);
    await answerLevel({ [ROOT]: [build, release] });
    await answerLevel({ [BUILD]: [underBuild], [RELEASE]: [underRelease] });
    await answerLevel({ [UNDER_BUILD]: [], [UNDER_RELEASE]: [] });

    // `1 + 2 + 5` — the budget, on the largest graph the platform has produced in its lifetime.
    http.verify();
    expect(text()).toContain('5 events · 8 requests');

    // The fork is the information: two siblings under one parent, each with one child of its own.
    // Read as five click-throughs it is a memory test; drawn, it is a picture.
    const drawn = rows();
    expect(drawn).toHaveLength(5);
    expect(drawn[0]).toContain('qits-spa-ui-components');
    expect(drawn[1]).toContain('BuildSuccessful');
    expect(drawn[2]).toContain('qits-spa-workspaces');
    expect(drawn[3]).toContain('SoftwareRelease');

    // The arrived-at event is marked, and it is marked in words as well as in colour.
    expect(page().querySelectorAll('tbody tr.current')).toHaveLength(1);
    expect(drawn[4]).toContain('this event');

    // Every other row is a link to its own page, so the graph is navigable as well as visible.
    const links = Array.from(page().querySelectorAll('tbody a')).map((link) =>
      link.getAttribute('href'),
    );
    expect(links).toContain(`/events/${ROOT}`);
    expect(links).toContain(`/events/${BUILD}`);
    expect(links).not.toContain(`/events/${UNDER_RELEASE}`);
  });

  it('draws a cause that is not in the log as the chain’s start, not as an error', async () => {
    // The live fixture, exactly: 59934bf8 names 064158b0, and 064158b0 was deleted on purpose by a
    // migration that wrote down this reading — the surviving child becomes a chain start.
    await open(ORPHAN);
    await answerGet(ORPHAN, event(ORPHAN, { parentId: DELETED }));
    await answerGet(DELETED, null);
    await answerLevel({ [ORPHAN]: [] });

    http.verify();
    expect(text()).toContain('Cause not in the log');
    expect(text()).toContain('064158b');

    // Not a spinner, not an error, not a blank: the tree is drawn and the page is whole.
    expect(page().querySelector('.async-error')).toBeNull();
    expect(page().querySelector('.async-loading')).toBeNull();
    expect(rows()).toHaveLength(1);

    // The header still offers the cause as a link. It 404s, which is the honest answer, and the
    // reader is entitled to try it rather than being told the id does not exist.
    const facts = page().querySelector('.facts')?.textContent ?? '';
    expect(facts).toContain(DELETED);
  });

  it('says where the walk stopped when it reaches the depth cap', async () => {
    const line = Array.from({ length: DOWN_DEPTH_CAP + 2 }, (_, index) =>
      event(`down-${index}-0000-4000-8000-000000000000`, index === 0 ? {} : { parentId: 'above' }),
    );

    await open(line[0].id);
    await answerGet(line[0].id, line[0]);
    for (let depth = 0; depth < DOWN_DEPTH_CAP; depth += 1) {
      await answerLevel({ [line[depth].id]: [line[depth + 1]] });
    }

    // Nine events drawn and a row saying the tenth level was never asked about. A tree that simply
    // stopped would read as "this is all of it" — which is the one thing it is not.
    http.verify();
    expect(text()).toContain(`The walk stopped at depth ${DOWN_DEPTH_CAP}`);
    expect(page().querySelectorAll('tbody tr')).toHaveLength(DOWN_DEPTH_CAP + 2);
  });

  it('keeps the event on screen when the walk fails, and offers the walk again', async () => {
    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, event(UNDER_RELEASE, { description: 'a hand-recorded probe' }));
    http
      .expectOne((request) => request.url === '/events/api/events')
      .flush({ message: 'boom' }, { status: 503, statusText: 'Service Unavailable' });
    await settle();

    // The chain is one panel with one state. The header and the payload beside it are already
    // fetched and stay where they are; only the tree is missing, and the retry is where it was.
    expect(text()).toContain('a hand-recorded probe');
    expect(text()).toContain('qits-spa-home');
    expect(text()).toContain('Could not walk the chain');
    expect(page().querySelector('tbody')).toBeNull();

    // The retry walks again and costs the walk, not the page: the event is not fetched twice.
    (
      Array.from(page().querySelectorAll('button')).find((button) =>
        (button.textContent ?? '').includes('Retry'),
      ) as HTMLButtonElement
    ).click();
    await settle();
    await answerLevel({ [UNDER_RELEASE]: [] });

    http.verify();
    expect(text()).toContain('1 event · 2 requests');
  });

  it('draws a 404 on the event itself as the page’s own failure', async () => {
    await open(DELETED);
    await answerGet(DELETED, null);

    // A deep link into a log somebody pruned is an ordinary answer, and there is nothing to walk.
    http.verify();
    expect(text()).toContain('Could not load the event');
    expect(page().querySelector('.facts')).toBeNull();
  });

  it('pretty-prints the payload, and survives one that is not JSON and one that is absent', async () => {
    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, event(UNDER_RELEASE));
    await answerLevel({ [UNDER_RELEASE]: [] });

    // Sorted keys, two-space indent, and the whole sha: the canonical reading of the same bytes.
    const payload = page().querySelector('pre')?.textContent ?? '';
    expect(payload).toContain('"branch": "main"');
    expect(payload).toContain('2633238c8828849df8f5fbc78e4838f21c1995be');
    expect(payload.indexOf('"branch"')).toBeLessThan(payload.indexOf('"commitSha"'));
  });

  it('shows a payload that is not JSON as it arrived, and says that is what it is', async () => {
    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, event(UNDER_RELEASE, { payload: 'not json at all' }));
    await answerLevel({ [UNDER_RELEASE]: [] });

    expect(page().querySelector('pre')?.textContent).toContain('not json at all');
    expect(text()).toContain('is not JSON');
  });

  it('draws an empty state for an event that carries no payload', async () => {
    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, event(UNDER_RELEASE, { payload: null }));
    await answerLevel({ [UNDER_RELEASE]: [] });

    expect(text()).toContain('carries no payload');
    expect(page().querySelector('pre')).toBeNull();
  });

  it('draws both timestamps, the whole id, and the exact instant unparsed', async () => {
    await open(UNDER_RELEASE);
    await answerGet(UNDER_RELEASE, event(UNDER_RELEASE, { occurredAt: TIE }));
    await answerLevel({ [UNDER_RELEASE]: [] });

    const facts = page().querySelector('.facts')?.textContent ?? '';
    expect(facts).toContain(UNDER_RELEASE);
    // The microseconds are the evidence a fork is a fork, so the instant is printed as the service
    // sent it — `Date` truncates to milliseconds and would make a genuine tie look like a near miss.
    expect(facts).toContain(TIE);
    expect(facts).toContain('1 Aug 2026 08:52:23Z');
  });
});
