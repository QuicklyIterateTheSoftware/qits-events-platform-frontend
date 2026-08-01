import type { EventCreatedFrame } from '../api/dto';
import { matchesFilters } from './frame-filter';

/**
 * The predicate a pushed frame goes through, against the clauses the server would have applied.
 *
 * Every case here is a row that must not appear on screen under a filter, or one that must. The
 * failure this file exists to stop is quiet: a tail that ignored `?since=` or `?q=` would show rows
 * a reload then removes, and the reader would have no way to tell which reading was the true one.
 */
describe('matchesFilters', () => {
  const NONE = { names: [], since: null, q: null };

  const frame = (over: Partial<EventCreatedFrame> = {}): EventCreatedFrame => ({
    id: 'a3528932-0000-0000-0000-000000000000',
    name: 'BuildSuccessful',
    occurredAt: '2026-08-01T08:52:29Z',
    payload: '{"branch":"main","repoId":"qits-spa-home"}',
    description: null,
    parentId: null,
    ...over,
  });

  it('lets everything through when no filter is in force', () => {
    expect(matchesFilters(frame(), NONE)).toBe(true);
  });

  it('keeps a name in the set and drops one outside it', () => {
    const names = { ...NONE, names: ['SCMRelease', 'SoftwareRelease'] };
    expect(matchesFilters(frame({ name: 'SCMRelease' }), names)).toBe(true);
    expect(matchesFilters(frame({ name: 'BuildSuccessful' }), names)).toBe(false);
  });

  it('reads an empty name set as every name, not as no name', () => {
    expect(matchesFilters(frame({ name: 'SomethingElseEntirely' }), NONE)).toBe(true);
  });

  it('keeps an event at or after the floor and drops one below it', () => {
    const since = { ...NONE, since: '2026-08-01T08:00:00.000Z' };
    expect(matchesFilters(frame({ occurredAt: '2026-08-01T08:52:29Z' }), since)).toBe(true);
    expect(matchesFilters(frame({ occurredAt: '2026-07-31T13:21:00Z' }), since)).toBe(false);
  });

  it('treats the floor as inclusive, as the server’s `>=` does', () => {
    const since = { ...NONE, since: '2026-08-01T08:52:29.000Z' };
    expect(matchesFilters(frame({ occurredAt: '2026-08-01T08:52:29Z' }), since)).toBe(true);
  });

  it('compares instants and not strings, so a coarser floor does not drop a finer row', () => {
    // `'2026-08-01T08:52:23Z' > '2026-08-01T08:52:23.928965Z'` as text — the row the store keeps is
    // the row a string comparison would have thrown away.
    const since = { ...NONE, since: '2026-08-01T08:52:23Z' };
    expect(matchesFilters(frame({ occurredAt: '2026-08-01T08:52:23.928965Z' }), since)).toBe(true);
  });

  it('matches a payload substring case-insensitively, under either repository key', () => {
    const q = { ...NONE, q: 'QITS-STT' };
    expect(matchesFilters(frame({ payload: '{"repoId":"qits-stt"}' }), q)).toBe(true);
    expect(matchesFilters(frame({ payload: '{"repository":"qits-stt"}' }), q)).toBe(true);
    expect(matchesFilters(frame({ payload: '{"packageName":"qits/qits-stt"}' }), q)).toBe(true);
    expect(matchesFilters(frame({ payload: '{"repoId":"qits-spa-home"}' }), q)).toBe(false);
  });

  it('matches the search as a literal substring, not as a wildcard the server escapes away', () => {
    expect(matchesFilters(frame({ payload: '{"note":"100% done"}' }), { ...NONE, q: '100%' })).toBe(
      true,
    );
    expect(matchesFilters(frame({ payload: '{"note":"anything"}' }), { ...NONE, q: '%' })).toBe(
      false,
    );
  });

  it('drops a null payload from a search, as `lower(null) like …` never matches', () => {
    expect(matchesFilters(frame({ payload: null }), { ...NONE, q: 'qits' })).toBe(false);
    expect(matchesFilters(frame({ payload: null }), NONE)).toBe(true);
  });

  it('reads a blank search as no search at all', () => {
    expect(matchesFilters(frame(), { ...NONE, q: '   ' })).toBe(true);
  });

  it('needs every clause, not one of them', () => {
    const both = { names: ['BuildSuccessful'], since: '2026-08-01T00:00:00Z', q: 'qits-spa-home' };
    expect(matchesFilters(frame(), both)).toBe(true);
    expect(matchesFilters(frame({ name: 'SCMRelease' }), both)).toBe(false);
    expect(matchesFilters(frame({ occurredAt: '2026-07-31T13:21:00Z' }), both)).toBe(false);
    expect(matchesFilters(frame({ payload: '{"repoId":"qits-spa-ci"}' }), both)).toBe(false);
  });

  it('leaves a floor it cannot read to the server, which refuses the request', () => {
    expect(matchesFilters(frame(), { ...NONE, since: 'last tuesday' })).toBe(true);
  });
});
