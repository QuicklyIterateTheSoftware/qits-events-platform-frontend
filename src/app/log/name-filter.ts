import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { Async } from '../ui/async';
import type { Loadable } from '../ui/loadable';

/**
 * Which event names the log shows: a checkbox each, fed by the store's own vocabulary.
 *
 * **The vocabulary is a request, and it is allowed to fail on its own.** `GET …/events/names` is
 * landing with the paging workstream, so against today's server it answers the id route's 404. That
 * renders here as "vocabulary unavailable" beside a retry, and the log next to it stays standing —
 * which is the whole reason each panel holds its own `Loadable`.
 *
 * **A selected name is drawn whether the vocabulary knows it or not.** The set arrives from the
 * URL, so it may name something the store has never held, or something the failed vocabulary cannot
 * confirm. Either way the box is there and it is checked, because a filter a person cannot see is a
 * filter they cannot turn off.
 *
 * Nothing here filters anything. The set goes into the query parameter, from there into the
 * request, and — when the live tail lands — into the socket's subscribe frame, so the filter means
 * one thing historically and live.
 */
@Component({
  selector: 'app-name-filter',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [Async],
  template: `
    <fieldset class="names">
      <legend>Name</legend>
      <app-async
        [state]="vocabulary()"
        loadingLabel="Loading the event names"
        errorLabel="Vocabulary unavailable"
        (retry)="retry.emit()"
      />
      @if (options().length > 0) {
        <div class="options">
          @for (name of options(); track name) {
            <label class="option">
              <input type="checkbox" [checked]="isSelected(name)" (change)="toggle(name)" />
              <span>{{ name }}</span>
            </label>
          }
        </div>
      } @else if (vocabulary().kind === 'ready') {
        <p class="hint">The log holds no events at all.</p>
      }
      @if (selected().length > 0) {
        <button type="button" class="clear" (click)="selectedChange.emit([])">
          Clear the name filter
        </button>
      }
    </fieldset>
  `,
  styles: `
    .names {
      border: 1px solid #e5e7eb;
      border-radius: 0.375rem;
      padding: 0.4rem 0.75rem 0.6rem;
      margin: 0;
      min-width: 13rem;
    }
    legend {
      padding: 0 0.35rem;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 600;
    }
    .options {
      display: flex;
      flex-wrap: wrap;
      gap: 0.15rem 0.9rem;
    }
    .option {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.9rem;
    }
    .hint {
      margin: 0.3rem 0 0;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .clear {
      margin-top: 0.35rem;
      padding: 0;
      border: 0;
      background: none;
      font: inherit;
      font-size: 0.8rem;
      color: #4338ca;
      cursor: pointer;
    }
    .clear:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
  `,
})
export class NameFilter {
  /** Every distinct name in the log, once it is known. */
  readonly vocabulary = input.required<Loadable<readonly string[]>>();

  /** The names in force, from the URL. An empty list is "every name". */
  readonly selected = input.required<readonly string[]>();

  /** A new set, for the caller to write into the URL. */
  readonly selectedChange = output<readonly string[]>();

  /** Ask for the vocabulary again. */
  readonly retry = output<void>();

  /** The vocabulary and whatever the URL selected, sorted, without repeats. */
  protected readonly options = computed(() => {
    const state = this.vocabulary();
    const known = state.kind === 'ready' ? state.value : [];
    return [...new Set([...known, ...this.selected()])].sort();
  });

  protected isSelected(name: string): boolean {
    return this.selected().includes(name);
  }

  protected toggle(name: string): void {
    const next = this.selected().filter((candidate) => candidate !== name);
    this.selectedChange.emit(
      next.length === this.selected().length ? [...next, name].sort() : next,
    );
  }
}
