import { NONE, exactInstant, formatDayTime, formatInstant, plural, shortId } from './format';

/** Small functions, asserted directly, because every one of them is drawn in a table cell. */
describe('format', () => {
  it('renders a row timestamp in UTC, day and minute', () => {
    expect(formatDayTime('2026-08-01T08:52:23.928965Z')).toBe('1 Aug 08:52');
  });

  it('renders the exact instant with year and seconds where it matters', () => {
    expect(formatInstant('2026-07-31T13:21:13Z')).toBe('31 Jul 2026 13:21:13Z');
  });

  it('draws an em dash rather than a broken date', () => {
    expect(formatDayTime(null)).toBe(NONE);
    expect(formatInstant('not a date')).toBe(NONE);
  });

  it('keeps the microseconds a fork is recognised by, unparsed', () => {
    // Two events of one release fork share this to six decimal places; `Date` would drop three.
    expect(exactInstant('2026-08-01T08:52:23.928965Z')).toBe('2026-08-01T08:52:23.928965Z');
    expect(exactInstant(null)).toBe(NONE);
  });

  it('never prints a count without its noun', () => {
    expect(plural(1, 'event')).toBe('1 event');
    expect(plural(137, 'event')).toBe('137 events');
  });

  it('abbreviates to seven characters, as git does, and leaves shorter values alone', () => {
    expect(shortId('c5edabb5-0621-4ff8-bf1b-29a3df2bb03c')).toBe('c5edabb');
    expect(shortId('abc')).toBe('abc');
  });
});
