import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideQitsNavigationLinks, type QitsNavLink } from '@qits/ui-components';
import { routes } from './app.routes';

/**
 * The route table, asserted where it is cheapest to get wrong: the noun repeated in
 * `/events/events/:id`, and the `**` catch-all sitting *inside* the chrome rather than replacing
 * it.
 *
 * These cases are about addresses and not content: each page's own spec asserts what it draws, and
 * this file asserts only that the URL reaches it and carries what it has to carry.
 */

/**
 * The navigation the chrome is handed, standing in for the gateway's `/main-navigation`. The
 * literal source rather than a fourth request through the testing backend: it fetches nothing, so
 * there is no navigation request left pending to keep the harness from settling, and a spec about
 * addresses does not have to know the navigation exists.
 */
const NAV: readonly QitsNavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Events', href: '/events/' },
];

describe('routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        provideHttpClient(),
        provideHttpClientTesting(),
        provideQitsNavigationLinks(NAV),
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

    // The id reaches the page as a request. The breadcrumb abbreviates it the way every log line on
    // this platform does, so the address is asserted where it is whole rather than where it is short.
    TestBed.inject(HttpTestingController).expectOne(
      '/events/api/events/c5edabb5-0621-4ff8-bf1b-29a3df2bb03c',
    );
  });

  it('draws an unknown URL as a 404 inside the chrome, because this segment is ours', async () => {
    const harness = await RouterTestingHarness.create('/no/such/page');
    const layout = harness.routeNativeElement as HTMLElement;
    expect(layout.querySelector('app-not-found')).not.toBeNull();
    // The chrome is still around it — rendering the links it was given, which here are this
    // fixture's rather than the platform's.
    expect(layout.querySelectorAll('.qits-layout-link')).toHaveLength(NAV.length);
  });
});
