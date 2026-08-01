/**
 * The small conversions the pages need, kept out of the templates so they can be asserted directly.
 *
 * **Every timestamp is rendered in UTC**, as in spa-ci, spa-cd and spa-artifacts: the service
 * stamps `Instant`s, and a browser-local rendering would make two people looking at the same
 * release train disagree about when it happened. On this screen that matters more than on the
 * others — a fork is recognised by its siblings sharing an instant to the microsecond, and a
 * timezone shift applied to only some rows would hide it.
 *
 * **Nothing here truncates a timestamp's precision away silently.** The log draws minutes and the
 * event page draws seconds; where the microseconds themselves are the evidence — two rows tying —
 * {@link exactInstant} prints the string the service sent, unparsed.
 */

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** What is drawn where there is nothing to draw — one em dash, everywhere. */
export const NONE = '—';

function parse(iso: string | null | undefined): Date | null {
  if (!iso) {
    return null;
  }
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

/** `31 Jul 14:02` — a table row's timestamp, no year. */
export function formatDayTime(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** `31 Jul 2026 14:02:11Z` — where the exact instant matters and the year is not obvious. */
export function formatInstant(iso: string | null): string {
  const date = parse(iso);
  if (!date) {
    return NONE;
  }
  return (
    `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`
  );
}

/**
 * The instant exactly as the service sent it, microseconds and all.
 *
 * `Date` truncates to milliseconds, and on this store that is not a rounding detail: the three
 * measured ties agree to six decimal places, so a rendering that stopped at three would show two
 * different instants as the same one — or, worse, make a genuine tie look like a coincidence.
 * Drawn where a fork is being read, and nowhere else.
 */
export function exactInstant(iso: string | null): string {
  return iso ?? NONE;
}

/** `10 events`, `1 event` — a count is never drawn without the noun it counts. */
export function plural(count: number, singular: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}

/**
 * The first seven characters of a sha, as git itself abbreviates. Shorter strings are left alone.
 *
 * Used on `commitSha` in a `BuildSuccessful` payload and on an event's own id, which is a UUID
 * rather than a sha — seven characters of one is still what every log line on this platform shows,
 * and the full value is on the event's own page.
 */
export function shortId(value: string): string {
  return value.length > 7 ? value.slice(0, 7) : value;
}
