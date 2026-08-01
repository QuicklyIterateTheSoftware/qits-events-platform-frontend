import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { EventDto } from '../api/dto';
import { ChainWalker, DOWN_DEPTH_CAP, DOWN_NODE_CAP, UP_HOP_CAP, type Chain } from './chain';

/**
 * The walker, and mostly the walker's limits.
 *
 * **The caps are asserted here, not described.** Every one of them guards against something the
 * service explicitly refuses to guard against — it bounds no walk, prevents no cycle and offers no
 * chain route — so a cap that silently stopped working would show up as a page that hangs on data
 * nobody has produced yet, which is the worst possible place to find out.
 *
 * The first case is the budget: the largest graph the platform has ever produced, entered from its
 * deepest leaf, costs **seven requests** for the walk and eight with the page's own fetch. It is
 * built from the real ids and the real instants, ties included, because the tie is what makes the
 * fork a fork.
 */
describe('ChainWalker', () => {
  let http: HttpTestingController;
  let walker: ChainWalker;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
    walker = TestBed.inject(ChainWalker);
  });

  afterEach(() => {
    http.verify();
  });

  const event = (id: string, over: Partial<EventDto> = {}): EventDto => ({
    id,
    name: 'BuildSuccessful',
    occurredAt: '2026-08-01T08:52:29Z',
    payload: null,
    description: null,
    parentId: null,
    createdAt: '2026-08-01T08:52:29.1Z',
    updatedAt: '2026-08-01T08:52:29.1Z',
    ...over,
  });

  /** Enough microtask turns for one awaited request to resolve and the next to be issued. */
  async function tick(): Promise<void> {
    for (let round = 0; round < 4; round += 1) {
      await Promise.resolve();
    }
  }

  /** One hop upward answered — with the event, or with the 404 a deleted cause gives. */
  async function answerGet(id: string, found: EventDto | null): Promise<void> {
    await tick();
    const request = http.expectOne(`/events/api/events/${id}`);
    if (found === null) {
      request.flush(
        { message: `Event not found: ${id}` },
        { status: 404, statusText: 'Not Found' },
      );
    } else {
      request.flush({ event: found });
    }
    await tick();
  }

  /** One node's children answered. Nothing distinguishes "caused nothing" from "no such event". */
  function answerChildren(parentId: string, children: readonly EventDto[]): void {
    http
      .expectOne(
        (request) =>
          request.url === '/events/api/events' && request.params.get('parentId') === parentId,
      )
      .flush({ events: children, nextCursor: null });
  }

  /** A whole breadth-first level at once, the way the walk issues it. */
  async function answerLevel(level: Record<string, readonly EventDto[]>): Promise<void> {
    await tick();
    for (const [parentId, children] of Object.entries(level)) {
      answerChildren(parentId, children);
    }
    await tick();
  }

  /** Only the events, in the order they are drawn. */
  function drawn(chain: Chain): readonly string[] {
    return chain.rows.filter((row) => row.kind === 'event').map((row) => row.event.id);
  }

  it('walks the live release train from its deepest leaf for two up and five down', async () => {
    // The five-node npm train of the plan's section 1.2, with its real ids and its real tie: one
    // SCMRelease became a BuildSuccessful and a SoftwareRelease at the same microsecond, and each of
    // those caused one more build.
    const tie = '2026-08-01T08:52:23.928965Z';
    const root = event('c5edabb5', { name: 'SCMRelease', occurredAt: '2026-08-01T08:51:49Z' });
    const build = event('99c733d8', { occurredAt: tie, parentId: 'c5edabb5' });
    const release = event('0bdbe98d', {
      name: 'SoftwareRelease',
      occurredAt: tie,
      parentId: 'c5edabb5',
    });
    const underBuild = event('049165ec', { parentId: '99c733d8' });
    const underRelease = event('a3528932', { parentId: '0bdbe98d' });

    const walk = walker.walk(underRelease);
    await answerGet('0bdbe98d', release);
    await answerGet('c5edabb5', root);
    await answerLevel({ c5edabb5: [build, release] });
    await answerLevel({ '99c733d8': [underBuild], '0bdbe98d': [underRelease] });
    await answerLevel({ '049165ec': [], a3528932: [] });
    const chain = await walk;

    // Two hops up and five nodes expanded: the walk costs 7, and the page's own fetch makes the
    // budget's 1 + U + D come to 8 — the measured cost of the biggest graph the platform has.
    expect(chain.requests).toBe(7);
    expect(chain.start).toEqual({ kind: 'root' });

    // Depth-first on the page, so a subtree reads as a subtree, and the fork's two siblings sit at
    // one depth under one parent. Their instants tie, so the id breaks it and the order is total.
    expect(drawn(chain)).toEqual(['c5edabb5', '99c733d8', '049165ec', '0bdbe98d', 'a3528932']);
    expect(chain.rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 2]);
    expect(chain.rows.filter((row) => row.kind === 'event' && row.current)).toHaveLength(1);
    expect(chain.rows.find((row) => row.kind === 'event' && row.current)?.depth).toBe(2);
  });

  it('costs one request for a root that caused nothing', async () => {
    const walk = walker.walk(event('a3528932'));
    await answerLevel({ a3528932: [] });
    const chain = await walk;

    // No hop upward — `parentId` is null and a root is known to be one without asking — and one
    // call down, which is the only way to learn that it caused nothing. The page's fetch makes 2.
    expect(chain.requests).toBe(1);
    expect(chain.start).toEqual({ kind: 'root' });
    expect(drawn(chain)).toEqual(['a3528932']);
  });

  it('reads a parent’s 404 as the chain’s start, never as an error', async () => {
    // The live fixture: 59934bf8 names 064158b0 as its cause, a migration deleted that row on
    // purpose, and it recorded this exact reading — the surviving child becomes a chain start.
    const orphan = event('59934bf8', { parentId: '064158b0' });

    const walk = walker.walk(orphan);
    await answerGet('064158b0', null);
    await answerLevel({ '59934bf8': [] });
    const chain = await walk;

    expect(chain.start).toEqual({ kind: 'dangling', parentId: '064158b0' });
    expect(drawn(chain)).toEqual(['59934bf8']);
    // The 404 was a request and is counted: pretending it was free would understate the budget on
    // exactly the row that needs the walk explained.
    expect(chain.requests).toBe(2);
  });

  it('stops on a cycle in both directions and draws where it looped', async () => {
    // Nothing server-side prevents `A → B → A`; a conditional trigger that fires sometimes is how
    // one would appear, and this graph is the platform's only runtime detector for it.
    const a = event('aaaaaaaa', { parentId: 'bbbbbbbb' });
    const b = event('bbbbbbbb', { parentId: 'aaaaaaaa' });

    const walk = walker.walk(a);
    await answerGet('bbbbbbbb', b);
    await answerLevel({ bbbbbbbb: [a] });
    await answerLevel({ aaaaaaaa: [b] });
    const chain = await walk;

    // One hop up and it is already a loop: the seen-set catches it by id, so the walk stops after
    // one request rather than after thirty-two.
    expect(chain.start).toEqual({ kind: 'cycle', parentId: 'aaaaaaaa' });
    expect(chain.requests).toBe(3);
    expect(drawn(chain)).toEqual(['bbbbbbbb', 'aaaaaaaa']);
    expect(chain.rows.at(-1)).toEqual({ kind: 'loop', depth: 2, id: 'bbbbbbbb' });
  });

  it('stops after thirty-two hops upward and says there is more above', async () => {
    const chainOf = Array.from({ length: UP_HOP_CAP + 4 }, (_, index) =>
      event(`up-${index}`, { parentId: `up-${index + 1}` }),
    );

    const walk = walker.walk(chainOf[0]);
    for (let hop = 1; hop <= UP_HOP_CAP; hop += 1) {
      await answerGet(`up-${hop}`, chainOf[hop]);
    }
    await answerLevel({ [`up-${UP_HOP_CAP}`]: [] });
    const chain = await walk;

    // Thirty-two requests up and not one more, and the start names what it did not reach: a walk
    // that stopped silently would draw a root that is not one.
    expect(chain.start).toEqual({ kind: 'capped', parentId: `up-${UP_HOP_CAP + 1}` });
    expect(chain.requests).toBe(UP_HOP_CAP + 1);
    expect(drawn(chain)[0]).toBe(`up-${UP_HOP_CAP}`);
  });

  it('stops at the depth cap and marks the branch it did not walk', async () => {
    const line = Array.from({ length: DOWN_DEPTH_CAP + 3 }, (_, index) =>
      event(`down-${index}`, index === 0 ? {} : { parentId: `down-${index - 1}` }),
    );

    const walk = walker.walk(line[0]);
    for (let depth = 0; depth < DOWN_DEPTH_CAP; depth += 1) {
      await answerLevel({ [`down-${depth}`]: [line[depth + 1]] });
    }
    const chain = await walk;

    // Eight levels expanded, nine events drawn, and the ninth carries a marker rather than looking
    // like a leaf. One call per level and nothing beyond the cap.
    expect(chain.requests).toBe(DOWN_DEPTH_CAP);
    expect(drawn(chain)).toHaveLength(DOWN_DEPTH_CAP + 1);
    expect(chain.rows.at(-1)).toEqual({ kind: 'bound', depth: DOWN_DEPTH_CAP + 1 });
    expect(chain.capped).toBe(false);
  });

  it('stops at two hundred events and reports it once, not two hundred times', async () => {
    const root = event('wide');
    const children = Array.from({ length: DOWN_NODE_CAP + 50 }, (_, index) =>
      event(`wide-${index.toString().padStart(3, '0')}`, { parentId: 'wide' }),
    );

    const walk = walker.walk(root);
    await answerLevel({ wide: children });
    const chain = await walk;

    // The graph stops at exactly the cap, and the walk stops with it — the frontier is never
    // expanded, so this costs one request and not two hundred.
    expect(drawn(chain)).toHaveLength(DOWN_NODE_CAP);
    expect(chain.requests).toBe(1);
    // One statement about the walk. A "stopped here" against each of 199 unexpanded nodes would
    // bury the tree under a report about itself.
    expect(chain.capped).toBe(true);
    expect(chain.rows.filter((row) => row.kind === 'bound')).toHaveLength(0);
  });

  it('rejects when a hop upward fails for any reason other than a missing event', async () => {
    const walk = walker.walk(event('child', { parentId: 'parent' }));
    http
      .expectOne('/events/api/events/parent')
      .flush({ message: 'boom' }, { status: 503, statusText: 'Service Unavailable' });

    // A 404 is the one status that means "this is where the chain starts". Everything else is the
    // service being unable to answer, and drawing half a graph as if it were whole would be the one
    // dishonest outcome available here.
    await expect(walk).rejects.toMatchObject({ status: 503 });
  });

  it('rejects when the walk downward fails', async () => {
    const walk = walker.walk(event('root'));
    await tick();
    http
      .expectOne((request) => request.url === '/events/api/events')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    await expect(walk).rejects.toMatchObject({ status: 500 });
  });
});
