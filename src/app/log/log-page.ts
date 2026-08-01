import { ChangeDetectionStrategy, Component } from '@angular/core';

/**
 * The log — **a placeholder, and it says so on screen.**
 *
 * This is the foundation's route target and nothing more. The table, the per-name summaries and
 * their generic fallback, the four filters as URL state, "load more", and the live tail all land
 * here in the workstreams that follow, against the client surface already in `src/app/api/`.
 *
 * The budget this page will have to keep, written here so the page that replaces this one inherits
 * it rather than rediscovers it: **`2 + 1 socket`, and the variable term is zero per row.** One
 * list request, one vocabulary request, one connection held for the page's life, and nothing that
 * fans out per row — everything a row draws arrives with the row. "This had a cause" is free,
 * because `parentId` is on the row; "this caused N" would be one request per row and is why the log
 * draws no fork marker at all.
 */
@Component({
  selector: 'app-log-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Events</h1>
    <p class="lede">
      The log is not built yet. This page is the route it will mount into; the API client and the
      live stream underneath it are in place.
    </p>
  `,
  styleUrls: ['../ui/page.css'],
  styles: `
    h1 {
      margin: 0;
      font-size: 1.4rem;
    }
  `,
})
export class LogPage {}
