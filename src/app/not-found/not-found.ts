import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { injectScopedProject } from '../nav/scoped-project';

/**
 * A URL on this host that this app does not recognise.
 *
 * It renders a small page and stops there. There is nobody to hand the URL back to: qits-events is
 * served at the root of its own host, so every path the service does not claim for its own wire
 * routes is this router's.
 *
 * One caveat for whoever lands here from `/events/stream`: that is the websocket, not a page. It is
 * claimed by the service ahead of the SPA, and a plain `GET` on it is not this router's to answer.
 */
@Component({
  selector: 'app-not-found',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <h1>No such page here</h1>
    <p>This is the event log. It has the log itself and a page per event — and nothing else.</p>
    <p><a [routerLink]="scoped.commands()">Back to the log</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {
  /** Back to the log the reader came from — the project's, where the address named one. */
  protected readonly scoped = injectScopedProject();
}
