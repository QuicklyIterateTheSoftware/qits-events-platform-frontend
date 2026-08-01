import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';

/**
 * The route table, asserted where it is cheapest to get wrong: the noun repeated in
 * `/events/events/:id`, and the `**` catch-all sitting *inside* the chrome rather than replacing
 * it.
 *
 * The pages themselves are placeholders today, so these cases are about addresses and not content.
 * They keep working as the pages land, which is the point of writing them now.
 */
describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
      ],
    });
  });

  it('puts the log at the base href itself', async () => {
    const harness = await RouterTestingHarness.create('/');
    expect(
      (harness.routeNativeElement as HTMLElement).querySelector('app-log-page'),
    ).not.toBeNull();
  });

  it('addresses one event under a repeated noun, and hands it the id', async () => {
    const harness = await RouterTestingHarness.create(
      '/events/c5edabb5-0621-4ff8-bf1b-29a3df2bb03c',
    );
    const page = (harness.routeNativeElement as HTMLElement).querySelector('app-event-page');
    expect(page).not.toBeNull();
    expect(page?.textContent).toContain('c5edabb5-0621-4ff8-bf1b-29a3df2bb03c');
  });

  it('draws an unknown URL as a 404 inside the chrome, because this segment is ours', async () => {
    const harness = await RouterTestingHarness.create('/no/such/page');
    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('app-not-found')).not.toBeNull();
    expect(layout.querySelectorAll('.qits-layout-link').length).toBeGreaterThan(0);
  });
});
