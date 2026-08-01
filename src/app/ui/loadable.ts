import { HttpErrorResponse } from '@angular/common/http';

/**
 * What one page — or one panel of a page — knows about the thing it is showing.
 *
 * `idle` is deliberately distinct from `loading`: it is *not asked*, not *asked and empty*. On this
 * app that distinction earns its keep on the chain walk, where a branch bounded by the depth cap is
 * idle forever and says so, rather than spinning on a request nobody is going to make.
 *
 * Every panel holds its own, which is what lets the name vocabulary fail to a small inline retry —
 * against today's server it 404s, because the route lands with the paging workstream — while the
 * log beside it stays standing.
 *
 * Copied from spa-artifacts rather than shared, like `Async` and `Empty` below it: there is no
 * place to put it yet — @qits/ui-components carries presentational components, not application
 * types.
 */
export type Loadable<T> =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: T }
  | { readonly kind: 'error'; readonly status: number; readonly message: string };

/** Never expanded, never requested. */
export const IDLE: Loadable<never> = { kind: 'idle' };

/** Requested, nothing back yet. */
export const LOADING: Loadable<never> = { kind: 'loading' };

/** Arrived. */
export function ready<T>(value: T): Loadable<T> {
  return { kind: 'ready', value };
}

/** Did not arrive, and why — the status is kept because a 404 is a different screen from a 503. */
export function failed(error: unknown): Loadable<never> {
  return { kind: 'error', status: statusOf(error), message: describeError(error) };
}

/** The HTTP status, or 0 for anything that never reached a server. */
export function statusOf(error: unknown): number {
  return error instanceof HttpErrorResponse ? error.status : 0;
}

/**
 * The shortest true sentence about a failure. The services answer errors in a `{"message": …}`
 * envelope, so that message is preferred when there is one; a status of 0 means the request never
 * got an answer at all, which reads as "unreachable" rather than as an HTTP code that does not
 * exist.
 */
export function describeError(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    if (error.status === 0) {
      return 'the service is unreachable';
    }
    const message = serverMessage(error.error);
    return message ? `${error.status} ${message}` : `${error.status}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** The `message` field of an error body, when the body is one. */
function serverMessage(body: unknown): string | null {
  if (typeof body === 'object' && body !== null && 'message' in body) {
    const message = (body as { message: unknown }).message;
    return typeof message === 'string' ? message : null;
  }
  return null;
}
