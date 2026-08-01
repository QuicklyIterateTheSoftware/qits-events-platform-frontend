import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Something that loaded and holds nothing, said in a sentence.
 *
 * It exists so that "no event matches this filter" and "this event caused nothing" are drawn the
 * same way and are never drawn as blank space — an empty table that renders nothing is
 * indistinguishable from one that failed silently. The second sentence matters more here than
 * anywhere: a parent with no children answers 200 with an empty list, and so does an id that is not
 * in the log at all.
 */
@Component({
  selector: 'app-empty',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<p class="empty">{{ message() }}</p>`,
  styles: `
    .empty {
      margin: 0.15rem 0;
      color: #6b7280;
      font-style: italic;
    }
  `,
})
export class Empty {
  readonly message = input.required<string>();
}
