import { NONE, shortId } from '../ui/format';

/**
 * What one row of the log says about an event, beyond its name and its time.
 *
 * **A table of three, plus a fallback that is the actual feature.** Three names are produced by
 * services today — `BuildSuccessful` and `SoftwareRelease` from qits-ci, `SCMRelease` from
 * qits-workspaces — and their payload keys are fixed and disjoint. A table of three is honest when
 * the vocabulary is three. What keeps it from being brittle is that an unknown name still renders
 * something useful: new names are born in a Java service and in no SPA's release cycle, so a fourth
 * event type must be legible the day it first fires, with no frontend deploy.
 *
 * **The repository is under two different keys.** Builds carry `repoId`, both release events carry
 * `repository`, and there is no single key that means "which repository". That is the whole reason
 * the payload search is spelled `q` and labelled a payload search rather than a repository filter.
 * The row draws the repository in its own column because a log of 127 `BuildSuccessful` rows that
 * does not say which repository is a wall of one word.
 *
 * Everything here reads only what arrived with the row. Nothing in this file may ever issue a
 * request or consult another event — the log's budget is flat and its variable term is zero.
 *
 * This is not the payload renderer. The event page pretty-prints the whole payload; this is one
 * line of gist for a table cell, and the two are deliberately different jobs.
 */

/** The three names the table below knows by heart. Everything else takes the fallback. */
export const SUMMARISED_NAMES: readonly string[] = [
  'BuildSuccessful',
  'SCMRelease',
  'SoftwareRelease',
];

/** How many `key=value` pairs an unknown name's fallback shows. */
const FALLBACK_PAIRS = 3;

/** The two spellings the platform has for "which repository", newest-used first. */
const REPOSITORY_KEYS = ['repository', 'repoId'] as const;

/**
 * Everything a summary needs. A fetched row is one and so is a pushed frame — the live tail's frame
 * lacks `createdAt`/`updatedAt`, and neither is drawn here.
 */
export interface SummarisedEvent {
  readonly name: string;
  readonly payload: string | null;
  readonly description: string | null;
}

/** The two cells a row fills from its payload. */
export interface RowGist {
  /** The repository this event is about, or null when the payload names none. */
  readonly repository: string | null;
  /** One line of gist. Never empty — an em dash where there is nothing to say. */
  readonly summary: string;
}

/** A parsed payload object, or null for absent, unparseable, or "valid JSON that is not an object". */
type Payload = Readonly<Record<string, unknown>>;

/**
 * The payload as an object, or null.
 *
 * `payload` is a string on the wire and the server never looks inside it, so it may be anything a
 * person typed on the hand-recorded `POST` path. A parse failure is a normal case here, not an
 * error: the row says the payload is not JSON and stays a row.
 */
function parsePayload(payload: string | null): Payload | null {
  if (!payload) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Payload)
      : null;
  } catch {
    return null;
  }
}

/** A payload value as one short string. Strings pass through; anything else is drawn as JSON. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** The value at `key`, when there is one worth drawing. */
function at(payload: Payload, key: string): string | null {
  const value = payload[key];
  if (value === undefined || value === null) {
    return null;
  }
  const drawn = text(value);
  return drawn.length > 0 ? drawn : null;
}

/** The parts that are actually there, joined; the separator every row on this platform uses. */
function join(parts: readonly (string | null)[]): string {
  const present = parts.filter((part): part is string => part !== null && part.length > 0);
  return present.length > 0 ? present.join(' · ') : NONE;
}

/**
 * One row's repository and gist.
 *
 * The known names get the bespoke line their keys deserve. Everything else — a probe, a name a
 * service grows next month — gets the first three `key=value` pairs of its payload in canonical
 * order, which says what the event carried without pretending to know what it means.
 */
export function rowGist(event: SummarisedEvent): RowGist {
  const payload = parsePayload(event.payload);
  if (payload === null) {
    return { repository: null, summary: unparsed(event) };
  }
  switch (event.name) {
    case 'BuildSuccessful':
      return {
        repository: at(payload, 'repoId'),
        summary: join([at(payload, 'branch'), sha(payload)]),
      };
    case 'SCMRelease':
      return {
        repository: at(payload, 'repository'),
        summary: join([at(payload, 'version'), at(payload, 'branch')]),
      };
    case 'SoftwareRelease':
      return {
        repository: at(payload, 'repository'),
        summary: join([at(payload, 'version'), packageOf(payload)]),
      };
    default:
      return fallback(payload);
  }
}

/** `9f96484` — git's own abbreviation, on the one key that holds a sha. */
function sha(payload: Payload): string | null {
  const value = at(payload, 'commitSha');
  return value === null ? null : shortId(value);
}

/** `npm qits/qits-stt` — the type first, because it is what tells two same-named packages apart. */
function packageOf(payload: Payload): string | null {
  const parts = [at(payload, 'packageType'), at(payload, 'packageName')].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(' ') : null;
}

/**
 * A name this build has never heard of.
 *
 * Keys are sorted before they are shown. Bus payloads arrive canonical already — the publisher
 * sorts them — but the hand-recorded path canonicalises nothing, and a stable order costs one call.
 * The key drawn in the repository column is left out of the pairs so the row does not say the same
 * thing twice.
 */
function fallback(payload: Payload): RowGist {
  const key = REPOSITORY_KEYS.find((candidate) => at(payload, candidate) !== null) ?? null;
  const repository = key === null ? null : at(payload, key);
  const pairs = Object.keys(payload)
    .sort()
    .filter((candidate) => candidate !== key)
    .slice(0, FALLBACK_PAIRS)
    .map((candidate) => `${candidate}=${text(payload[candidate])}`);
  return { repository, summary: pairs.length > 0 ? pairs.join(' · ') : NONE };
}

/**
 * There is no object to read: the payload is null, empty, or not JSON at all.
 *
 * `description` is null on every row the platform writes and exists for the hand-recorded path —
 * which is the same path that produces payloads like these — so it is the honest thing to fall back
 * to before giving up. A payload that is present and unparseable says so, because "not JSON" is
 * information and a blank cell is not.
 */
function unparsed(event: SummarisedEvent): string {
  if (event.description) {
    return event.description;
  }
  return event.payload ? 'payload is not JSON' : NONE;
}
