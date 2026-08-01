import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { TimeRange } from './time-range';

/**
 * The time floor.
 *
 * The case worth keeping above all the others: a preset emits an **absolute instant**. A control
 * that wrote "last hour" into a URL would mean a different window every time the link was opened,
 * and two people reading the same address would be looking at different logs.
 */
describe('TimeRange', () => {
  let fixture: ComponentFixture<TimeRange>;
  let emitted: (string | null)[];

  beforeEach(() => {
    TestBed.configureTestingModule({});
    fixture = TestBed.createComponent(TimeRange);
    emitted = [];
    fixture.componentInstance.sinceChange.subscribe((value) => emitted.push(value));
    fixture.detectChanges();
  });

  function press(label: string): void {
    const button = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (candidate) => ((candidate as HTMLElement).textContent ?? '').trim() === label,
    ) as HTMLButtonElement | undefined;
    button?.click();
    fixture.detectChanges();
  }

  function type(value: string): void {
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  function text(): string {
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  it('resolves a preset to an absolute instant on the spot', () => {
    const before = Date.now();
    press('Last hour');
    const after = Date.now();

    expect(emitted).toHaveLength(1);
    const floor = Date.parse(emitted[0] ?? '');
    expect(floor).toBeGreaterThanOrEqual(before - 3_600_000);
    expect(floor).toBeLessThanOrEqual(after - 3_600_000);
  });

  it('removes the floor entirely for “any time”', () => {
    press('Any time');
    expect(emitted).toEqual([null]);
  });

  it('normalises a typed date to a UTC instant', () => {
    type('2026-08-01');
    expect(emitted).toEqual(['2026-08-01T00:00:00.000Z']);
  });

  it('refuses what it cannot read, and changes the floor by nothing', () => {
    type('some time yesterday');

    expect(emitted).toEqual([]);
    expect(text()).toContain('Not a date this can read');
  });

  it('states the floor it is holding, because a preset cannot be shown as selected', () => {
    fixture.componentRef.setInput('since', '2026-08-01T00:00:00Z');
    fixture.detectChanges();

    expect(text()).toContain('Events from 1 Aug 2026 00:00:00Z onwards');
  });

  it('says it is holding the whole log when there is no floor', () => {
    expect(text()).toContain('The whole log');
  });
});
