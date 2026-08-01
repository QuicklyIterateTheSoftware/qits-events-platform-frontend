import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/**
 * A URL under `/events/` that this app does not recognise.
 *
 * It renders a small page and stops there. It deliberately does **not** copy spa-home's behaviour
 * of handing the URL back to the gateway: that is the landing page's job, and it is correct only
 * because spa-home is mounted at the root, where an unknown first segment is another micro
 * frontend. Here the segment is already ours, so there is nobody to hand it to.
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
    <p><a routerLink="/">Back to the log</a></p>
  `,
  styles: `
    h1 {
      font-size: 1.25rem;
      margin: 0 0 0.5rem;
    }
  `,
})
export class NotFound {}
