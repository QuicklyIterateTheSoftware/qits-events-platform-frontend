import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { EventsApi } from './events-api';

/**
 * The paths, the parameters and the envelopes, asserted once here so the pages' specs can be about
 * rendering.
 *
 * These are same-origin absolute paths on purpose — the SPA is served at `/events/` by the very
 * service it reads from, behind the same gateway, and these reads carry no credential at all.
 *
 * **The backend is growing this contract in parallel, so this file is where the contract is
 * pinned.** Everything below the first two cases describes the server that is landing; the first
 * two describe the one running today, which ignores every parameter it does not know and answers no
 * `nextCursor`. Both must render, and the day paging ships nothing here changes.
 */
describe('EventsApi', () => {
  let api: EventsApi;
  let http: HttpTestingController;

  const event = {
    id: 'c5edabb5-0621-4ff8-bf1b-29a3df2bb03c',
    name: 'SCMRelease',
    occurredAt: '2026-08-01T08:51:49Z',
    payload: '{"branch":"main","repository":"qits-spa-ui-components","version":"2026.801.85149"}',
    description: null,
    parentId: null,
    createdAt: '2026-08-01T08:51:49.1Z',
    updatedAt: '2026-08-01T08:51:49.1Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(EventsApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for the bare log when no filter is set, and sends no empty parameters', async () => {
    const page = api.list();
    const request = http.expectOne('/events/api/events');
    expect(request.request.params.keys()).toHaveLength(0);
    request.flush({ events: [event] });
    await expect(page).resolves.toMatchObject({ events: [{ id: event.id }] });
  });

  it('reads a missing nextCursor as the end of the log, which is what today’s server answers', async () => {
    const page = api.list({ limit: 200 });
    http.expectOne((request) => request.url === '/events/api/events').flush({ events: [] });
    await expect(page).resolves.toEqual({ events: [], nextCursor: null });
  });

  it('carries limit, cursor, name, since and q, with the names comma-joined', async () => {
    const page = api.list({
      limit: 200,
      cursor: '2026-08-01T08:52:23.928965Z,0bdbe98d-0000-0000-0000-000000000000',
      name: ['SCMRelease', 'SoftwareRelease'],
      since: '2026-08-01T00:00:00Z',
      q: 'qits-stt',
    });
    const request = http.expectOne((candidate) => candidate.url === '/events/api/events');
    expect(request.request.params.get('limit')).toBe('200');
    expect(request.request.params.get('cursor')).toBe(
      '2026-08-01T08:52:23.928965Z,0bdbe98d-0000-0000-0000-000000000000',
    );
    expect(request.request.params.get('name')).toBe('SCMRelease,SoftwareRelease');
    expect(request.request.params.get('since')).toBe('2026-08-01T00:00:00Z');
    expect(request.request.params.get('q')).toBe('qits-stt');
    request.flush({ events: [], nextCursor: null });
    await expect(page).resolves.toEqual({ events: [], nextCursor: null });
  });

  it('leaves an empty name list and a blank search out of the request entirely', async () => {
    const page = api.list({ name: [], q: '', since: null, cursor: null });
    const request = http.expectOne('/events/api/events');
    expect(request.request.params.keys()).toHaveLength(0);
    request.flush({ events: [] });
    await expect(page).resolves.toMatchObject({ events: [] });
  });

  it('returns the composite cursor the next page is asked with', async () => {
    const page = api.list({ limit: 2 });
    http
      .expectOne((request) => request.url === '/events/api/events')
      .flush({
        events: [event],
        nextCursor: '2026-08-01T08:51:49Z,c5edabb5-0621-4ff8-bf1b-29a3df2bb03c',
      });
    await expect(page).resolves.toMatchObject({
      nextCursor: '2026-08-01T08:51:49Z,c5edabb5-0621-4ff8-bf1b-29a3df2bb03c',
    });
  });

  it('unwraps one event from its envelope, its own timestamps included', async () => {
    const one = api.get(event.id);
    // The body is `{"event": …}`, not the event: measured on the live service and written that way
    // in `EventController.get`. Flushing the bare event here would let a client that never unwraps
    // pass this spec and return an object with every field undefined against the real one.
    http.expectOne(`/events/api/events/${event.id}`).flush({ event });
    await expect(one).resolves.toMatchObject({ id: event.id, createdAt: event.createdAt });
  });

  it('rejects a missing event with the 404, because a deleted cause is data and not damage', async () => {
    const one = api.get('064158b0-837f-40aa-aa3c-d287d34f929e');
    http
      .expectOne('/events/api/events/064158b0-837f-40aa-aa3c-d287d34f929e')
      .flush({ message: 'no such event' }, { status: 404, statusText: 'Not Found' });
    await expect(one).rejects.toMatchObject({ status: 404 });
  });

  it('asks for children on the list route with parentId, and unwraps them', async () => {
    const children = api.children(event.id);
    const request = http.expectOne((candidate) => candidate.url === '/events/api/events');
    expect(request.request.params.get('parentId')).toBe(event.id);
    expect(request.request.params.has('limit')).toBe(false);
    request.flush({ events: [{ ...event, id: '0bdbe98d-0000-0000-0000-000000000000' }] });
    await expect(children).resolves.toMatchObject([{ id: '0bdbe98d-0000-0000-0000-000000000000' }]);
  });

  it('gives an unknown parent’s 200-and-empty back as an empty list, never as an error', async () => {
    const children = api.children('not-a-uuid');
    http.expectOne((request) => request.url === '/events/api/events').flush({ events: [] });
    await expect(children).resolves.toEqual([]);
  });

  it('reads the vocabulary from the literal route beside /{id}', async () => {
    const names = api.names();
    http
      .expectOne('/events/api/events/names')
      .flush({ names: ['BuildSuccessful', 'SCMRelease', 'SoftwareRelease'] });
    await expect(names).resolves.toEqual(['BuildSuccessful', 'SCMRelease', 'SoftwareRelease']);
  });

  it('rejects the vocabulary against a server that has no such route yet', async () => {
    const names = api.names();
    http
      .expectOne('/events/api/events/names')
      .flush({ message: 'no such event' }, { status: 404, statusText: 'Not Found' });
    await expect(names).rejects.toBeInstanceOf(HttpErrorResponse);
  });
});
