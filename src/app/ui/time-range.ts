import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { formatInstant } from './format';

/**
 * A time floor: "last hour", "last 24 hours", "last 7 days", or an instant typed by hand.
 *
 * **It lives here and not in `@qits/ui-components`, on purpose.** The observability UI wants the
 * same control, and promoting it sounds obviously right — but every SPA pins the library at
 * `^0.0.4` while the library publishes calver, so the caret will never cross and a component added
 * to the library today reaches no application at all. So it is built locally, kept free of anything
 * events-specific, and recorded as a promotion candidate for the day the release-train fan-out
 * unfreezes the pin. Anything in this repository may use it; it imports nothing from `../api`.
 *
 * **A preset writes an absolute instant, not a relative phrase.** "Last hour" resolves the moment
 * it is pressed and what lands in the URL is `since=2026-08-01T11:02:00.000Z`. A URL saying
 * "lasthour" would mean a different window every time it was opened, and two people reading the
 * same link would be looking at different logs. The cost is that a preset cannot be shown as
 * *selected* afterwards — an instant does not remember which button produced it — so the control
 * states the floor it is holding in words instead of lighting a button up.
 *
 * The typed value is normalised through `Date` to a UTC instant, so `2026-08-01` and
 * `2026-08-01T00:00` and a full ISO string all land as the same canonical string. Anything
 * unparseable is refused with a hint and emits nothing: a filter that silently did not apply is
 * worse than one that says it could not.
 */
@Component({
  selector: 'app-time-range',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="range">
      <legend>Since</legend>
      <div class="presets">
        <button type="button" class="preset" (click)="clear()">Any time</button>
        <button type="button" class="preset" (click)="last(HOUR)">Last hour</button>
        <button type="button" class="preset" (click)="last(24 * HOUR)">Last 24 hours</button>
        <button type="button" class="preset" (click)="last(7 * 24 * HOUR)">Last 7 days</button>
      </div>
      <label class="custom" [attr.for]="inputId()">
        <span class="sr">Since, as an instant</span>
        <input
          [id]="inputId()"
          type="text"
          inputmode="text"
          placeholder="2026-08-01T00:00:00Z"
          [value]="since() ?? ''"
          [attr.aria-invalid]="rejected() ? 'true' : null"
          (change)="apply($event)"
        />
      </label>
      @if (rejected()) {
        <p class="hint" role="alert">Not a date this can read — the floor is unchanged.</p>
      } @else if (since()) {
        <p class="hint">Events from {{ floor() }} onwards.</p>
      } @else {
        <p class="hint">The whole log.</p>
      }
    </fieldset>
  `,
  styles: `
    .range {
      border: 1px solid #e5e7eb;
      border-radius: 0.375rem;
      padding: 0.4rem 0.75rem 0.6rem;
      margin: 0;
      min-width: 15rem;
    }
    legend {
      padding: 0 0.35rem;
      font-size: 0.78rem;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #6b7280;
      font-weight: 600;
    }
    .presets {
      display: flex;
      flex-wrap: wrap;
      gap: 0.35rem;
    }
    .preset {
      font: inherit;
      font-size: 0.85rem;
      padding: 0.15rem 0.5rem;
      border: 1px solid #d1d5db;
      border-radius: 0.25rem;
      background: #fff;
      color: #4338ca;
      cursor: pointer;
    }
    .preset:hover {
      background: #eef2ff;
    }
    .preset:focus-visible {
      outline: 2px solid #4f46e5;
      outline-offset: 1px;
    }
    .custom {
      display: block;
      margin-top: 0.4rem;
    }
    input {
      font: inherit;
      font-size: 0.85rem;
      width: 100%;
      box-sizing: border-box;
      padding: 0.2rem 0.4rem;
      border: 1px solid #d1d5db;
      border-radius: 0.25rem;
    }
    input[aria-invalid='true'] {
      border-color: #b91c1c;
    }
    .hint {
      margin: 0.3rem 0 0;
      font-size: 0.8rem;
      color: #6b7280;
    }
    .hint[role='alert'] {
      color: #b91c1c;
    }
    .sr {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class TimeRange {
  /** One hour, in milliseconds — the unit every preset is a multiple of. */
  protected readonly HOUR = 3_600_000;

  /** The floor in force, as an ISO instant, or null for "any time". */
  readonly since = input<string | null>(null);

  /** The element id the label points at, so two of these can share a page. */
  readonly inputId = input('time-range-since');

  /** A new floor, or null to remove it. Emitted only for a value this could read. */
  readonly sinceChange = output<string | null>();

  /** The last typed value could not be read as a date. Cleared by the next thing that can. */
  protected readonly rejected = signal(false);

  /** The floor in words: `1 Aug 2026 11:02:00Z`. */
  protected readonly floor = computed(() => formatInstant(this.since()));

  /** No floor at all. */
  protected clear(): void {
    this.rejected.set(false);
    this.sinceChange.emit(null);
  }

  /** A floor this many milliseconds back from now, resolved to an absolute instant on the spot. */
  protected last(ms: number): void {
    this.rejected.set(false);
    this.sinceChange.emit(new Date(Date.now() - ms).toISOString());
  }

  /** A typed instant, normalised to UTC. Empty removes the floor; unreadable changes nothing. */
  protected apply(event: Event): void {
    const raw = (event.target as HTMLInputElement).value.trim();
    if (raw.length === 0) {
      this.clear();
      return;
    }
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      this.rejected.set(true);
      return;
    }
    this.rejected.set(false);
    this.sinceChange.emit(parsed.toISOString());
  }
}
