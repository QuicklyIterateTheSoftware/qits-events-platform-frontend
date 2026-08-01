import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

/** What the marker is saying, in the order the reader meets them. */
export type TailState = 'off' | 'connecting' | 'live' | 'stale' | 'windowed';

/** One quiet sentence per state. Never a spinner, never an alert — this is a footnote, not a fault. */
const LABELS: Readonly<Record<TailState, string>> = {
  off: 'Off — the log is the snapshot it was fetched as',
  connecting: 'Connecting…',
  live: 'Live — new events arrive as they happen',
  stale: 'Reconnecting — what is on screen may be a little behind',
  windowed: 'Paused — new events arrive at the head of the log, and this window is further down',
};

/**
 * The live tail's switch, and the quiet marker beside it.
 *
 * **It draws and it emits, and it knows nothing about a socket.** The page owns the stream, the
 * refetch and the inserts; this is the one place a reader can see what the tail is doing, which is
 * the whole of its job. The shape is `workspace-events.ts:69`'s: a disconnected tail means the page
 * is briefly behind, not that it is wrong, so the marker is a line of small grey text and never an
 * error box.
 *
 * **Off is a state with a sentence, not a blank.** A log that has quietly stopped following the
 * store looks exactly like a log where nothing has happened, and the difference matters more here
 * than anywhere: this is a page a person leaves open. Every state says which of the two it is.
 *
 * `windowed` is the honest answer to a real corner: an address carrying `?cursor=` shows a window
 * with the cursor as its ceiling, and an event created a moment ago is above that ceiling. Inserting
 * it would put a row on screen that the window does not contain. So the tail holds its frames and
 * says why, and "Back to the newest" above the table is the way out.
 *
 * One `role="status"` on one element that never leaves the DOM, so a screen reader hears each change
 * once — four separate live regions would announce a reconnect twice, once for the leaving state and
 * once for the arriving one.
 */
@Component({
  selector: 'app-live-tail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tail">
      <label class="switch">
        <input type="checkbox" [checked]="on()" (change)="toggled.emit(!on())" />
        <span>Live tail</span>
      </label>
      <span class="mark" [attr.data-state]="state()" role="status">{{ label() }}</span>
    </div>
  `,
  styles: `
    .tail {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.1rem;
    }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      font-size: 0.9rem;
      white-space: nowrap;
    }
    .mark {
      font-size: 0.78rem;
      color: #6b7280;
      font-style: italic;
      text-align: right;
    }
    .mark[data-state='live'] {
      color: #047857;
      font-style: normal;
    }
    .mark[data-state='stale'] {
      color: #b45309;
    }
  `,
})
export class LiveTail {
  /** Whether the reader has the tail switched on. */
  readonly on = input.required<boolean>();

  /** Whether the socket is up. Only meaningful while {@link on} is true. */
  readonly connected = input.required<boolean>();

  /** Whether the log is showing a window an address's cursor bounds above. */
  readonly windowed = input(false);

  /** Whether the socket has been up at least once, which tells a first connect from a reconnect. */
  readonly everConnected = input(false);

  /** The switch, flipped. The page decides what that costs. */
  readonly toggled = output<boolean>();

  protected readonly state = computed<TailState>(() => {
    if (!this.on()) {
      return 'off';
    }
    if (!this.connected()) {
      return this.everConnected() ? 'stale' : 'connecting';
    }
    return this.windowed() ? 'windowed' : 'live';
  });

  protected readonly label = computed(() => LABELS[this.state()]);
}
