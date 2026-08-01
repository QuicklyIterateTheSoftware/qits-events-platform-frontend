/**
 * An event's payload, as the event page draws it whole.
 *
 * **This is not the log's gist.** `event-summary.ts` reads two or three keys out of a payload to
 * fill two table cells; this renders the payload itself, entire, with nothing chosen and nothing
 * left out. The two are deliberately different jobs and neither is a special case of the other.
 *
 * **The payload is a string and this is the one place that admits it.** The service stores whatever
 * the publisher sent, byte for byte, and documents the column as never queried by content — so it
 * arrives as JSON *text* and may not be JSON at all: the hand-recorded `POST` path accepts any
 * string a person types. Every outcome below is a normal one and none of them is an error.
 *
 * **Keys are re-sorted even though bus payloads arrive sorted.** The publisher canonicalises —
 * sorted keys, no insignificant whitespace — and the server neither checks nor changes that. The
 * hand-recorded path canonicalises nothing, so a sort here costs one traversal and makes the two
 * paths render alike. It is the canonical reading of the same bytes, not a rewrite of them.
 *
 * **Nulls are kept.** Canonical JSON omits them on the way out, so a null that survived to here was
 * typed by a person and is the only thing on the screen that says the key was named and left empty.
 * Dropping it would hide exactly the payload this renderer exists to show honestly.
 *
 * **Nothing is truncated.** Measured payload sizes on the live store: 38 bytes at the smallest, 192
 * in the middle, 220 at the largest. A "show more" on 220 bytes is ceremony.
 */

/** Two-space indent, as the plan spells it and as every canonical dump on this platform reads. */
const INDENT = 2;

/**
 * What there is to draw.
 *
 * - `none` — the payload is null or empty. `payload` is nullable in the schema and permanently so,
 *   and an event recorded by hand is honestly nothing but a name and a time.
 * - `json` — it parsed; `text` is the pretty, key-sorted form.
 * - `raw` — it did not parse; `text` is the string exactly as it arrived. The page says so and
 *   shows it, because "not JSON" is information and a blank block is not.
 */
export type RenderedPayload =
  | { readonly kind: 'none' }
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'raw'; readonly text: string };

/**
 * The same value with every object's keys in sorted order.
 *
 * **Arrays keep their order.** An object's key order carries no meaning and a canonical form has to
 * fix one; an array's order *is* the value, and sorting it would change what the event said.
 */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === 'object' && value !== null) {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * One payload, ready to draw.
 *
 * A payload of `"null"` — four characters that parse to JSON's null — is `json` and draws as
 * `null`, which is not the same thing as the column being empty. The distinction is small and it is
 * the difference between "the publisher sent null" and "nobody sent anything".
 */
export function renderPayload(payload: string | null): RenderedPayload {
  if (payload === null || payload.trim().length === 0) {
    return { kind: 'none' };
  }
  try {
    const parsed: unknown = JSON.parse(payload);
    return { kind: 'json', text: JSON.stringify(sortKeys(parsed), null, INDENT) };
  } catch {
    return { kind: 'raw', text: payload };
  }
}
