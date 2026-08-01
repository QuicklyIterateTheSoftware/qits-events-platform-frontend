import {
  compareNewestFirst,
  insertNewestFirst,
  mergeNewestFirst,
  sortNewestFirst,
} from './event-order';

/**
 * The order and the two list operations, on the shapes the live store actually holds.
 *
 * The fixtures are the measured fork: `SoftwareRelease 0bdbe98d` and `BuildSuccessful 99c733d8`
 * share `2026-08-01T08:52:23.928965Z` by construction, because a release's children carry the run's
 * finish instant. Every case below that mentions a tie is that pair.
 */
describe('event order', () => {
  const later = { id: 'c5edabb5', occurredAt: '2026-08-01T08:51:49Z' };
  const tieA = { id: '0bdbe98d', occurredAt: '2026-08-01T08:52:23.928965Z' };
  const tieB = { id: '99c733d8', occurredAt: '2026-08-01T08:52:23.928965Z' };

  it('puts the newer event first', () => {
    expect(compareNewestFirst(tieA, later)).toBeLessThan(0);
    expect(compareNewestFirst(later, tieA)).toBeGreaterThan(0);
  });

  it('breaks a tie by id, so two calls cannot disagree about the order of a fork', () => {
    expect(compareNewestFirst(tieB, tieA)).toBeLessThan(0);
    expect(sortNewestFirst([tieA, tieB, later])).toEqual([tieB, tieA, later]);
    expect(sortNewestFirst([later, tieA, tieB])).toEqual([tieB, tieA, later]);
  });

  it('leaves the caller’s array alone', () => {
    const rows = [later, tieB];
    sortNewestFirst(rows);
    expect(rows).toEqual([later, tieB]);
  });

  it('inserts a pushed frame by its occurredAt rather than at the top', () => {
    const rendered = [tieB, tieA, later];
    const late = { id: '3fb1b96a', occurredAt: '2026-08-01T08:52:00Z' };
    expect(insertNewestFirst(rendered, late)).toEqual([tieB, tieA, late, later]);
  });

  it('inserts a genuinely new event at the top when it belongs there', () => {
    const rendered = [tieA, later];
    const fresh = { id: 'ffffffff', occurredAt: '2026-08-01T09:00:00Z' };
    expect(insertNewestFirst(rendered, fresh)[0]).toBe(fresh);
  });

  it('appends an event older than everything rendered', () => {
    const rendered = [tieA, later];
    const old = { id: 'aaaaaaaa', occurredAt: '2026-07-31T13:21:00Z' };
    expect(insertNewestFirst(rendered, old)).toEqual([tieA, later, old]);
  });

  it('places a frame that ties with a rendered row on the tie’s own rule', () => {
    expect(insertNewestFirst([tieA, later], tieB)).toEqual([tieB, tieA, later]);
  });

  it('drops a frame whose id is already rendered, and keeps the rendered copy', () => {
    const rendered = [{ ...tieA, payload: 'fetched' }, later];
    const merged = insertNewestFirst(rendered, { ...tieA, payload: 'pushed' });
    expect(merged).toBe(rendered);
    expect(merged[0]).toMatchObject({ payload: 'fetched' });
  });

  it('merges a refetched page over rows pushed while it was in flight, preferring the page', () => {
    const fetched = [{ ...tieA, payload: 'fetched' }, later];
    const pushed = [{ ...tieA, payload: 'pushed' }, tieB];
    expect(mergeNewestFirst(fetched, pushed)).toEqual([
      tieB,
      { ...tieA, payload: 'fetched' },
      later,
    ]);
  });
});
