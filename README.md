# qits-spa-events

The event log's frontend: the read-only view of what has happened on this platform and what caused
what. Served by qits-events itself at `/events/` through Quinoa. No forms, no writes at all.

**The pages are not built yet.** This repository currently holds the foundation the pages mount
into — the API client, the live stream's transport, the shared UI plumbing, the routes, and two
honest placeholders. `/events/` and `/events/events/<id>` both answer today and both say so.

## The screens, as they will be

- **`/events/`** — the log. Reverse-chronological, filterable by name, by time floor and by payload
  search, with a live tail. Budget: **2 requests and one socket, and nothing per row.** Everything a
  row draws arrives with the row; "this had a cause" is free because `parentId` is on it, and "this
  caused N" is deliberately not drawn, because it would be one request per row.
- **`/events/events/<id>`** — one event, its payload, and the whole causation component it belongs
  to: walked up to the root by `parentId` and drawn down from there, with the arrived-at event
  marked. Budget: **`1 + U + D`** — 2 requests for a root with no children, 8 for the largest graph
  this platform has produced.

The event page **repeats the noun**, and that is a decision. `/events/<id>` reads better and
swallows every future top-level route, making the 404 unreachable and the choice irreversible once a
link is shared. Every sibling repeats its noun, and the segment matches the API path it mirrors.

## What the service gives this app, and what it refuses

`GET /events/api/events` (the log, and `?parentId=` for one event's children), `GET
/events/api/events/{id}`, `GET /events/api/events/names`, and the `/events/stream` websocket. The
paging and filter parameters — `limit`, `cursor`, `name`, `since`, `q` — and the vocabulary route are
landing in parallel with this repository; the client sends them, treats a missing `nextCursor` as
"no more", and therefore renders correctly against the server running today, which ignores what it
does not know and answers the whole log.

**There is no chain route, and there will not be one.** No `/chain`, no depth parameter, no graph
endpoint — the service says so in three places. A chain-walking client bounds its own depth and
remembers the ids it has visited, and this one will: 32 hops up, depth 8 and 200 nodes down, an
id-seen set on both walks, and a drawn "bounded here" node rather than a silent truncation. Nothing
server-side prevents a cycle either.

Two answers that look like errors and are not:

- A `parentId` that resolves to **404** is a chain start whose cause was deleted on purpose. There
  is a live row with one today.
- `?parentId=` on an id that is not in the log answers **200 with an empty list**, never 404. So
  "caused nothing" and "no such event" are the same response, and nothing may read one as the other.

## The order is `(occurredAt, id)`, and the id half is load-bearing

A release fork's children carry the run's finish instant **by construction**, so events tie: 4 of 137
rows on the live store, and the ties are exactly the rows a release train is read for. Ordering by
time alone is not a total order — two calls may disagree — and a scalar `before=<time>` cursor splits
a fork across a page boundary and either drops a sibling or repeats it. `src/app/api/event-order.ts`
holds the comparison, and it compares the timestamp as a string: the store's instants carry
microseconds and `Date` truncates to milliseconds.

## The live tail pushes rows

The stream is at-most-once and live-only — no replay, no offset, no resume token — and the frame
**is** the event rather than a hint, so a subscriber inserts it and issues no request. Three rules
follow, and all three are in `src/app/api/event-stream.ts`:

- **Refetch on every connect, including every reconnect.** The gap a disconnected window left is
  unknowable. This is not a resume protocol and must not be mistaken for one.
- **Insert by `occurredAt`, never prepend.** It is the caller's time and may be in the past — one row
  on the live store disagrees with its own `createdAt` by eight minutes.
- **Deduplicate by id.** A refetch and a frame overlap by construction.

Opening the socket is **not** subscribing: a connection that has sent no `{"subscribe": [...]}` frame
receives nothing at all, so the subscribe goes out on every open. The set is replaced wholesale by
each frame, which makes a filter change one `send` rather than a reconnect.

The frame lacks `createdAt`/`updatedAt`, which are two fields the log does not draw. **If the log
ever draws one, the push path becomes lossy and this decision must be revisited in the same commit.**

## Layout

    src/app/api/     the wire shapes, one injectable over HttpClient, and the socket's own seam
    src/app/ui/      Loadable, Async, Empty, the shared page stylesheet, the formatters
    src/app/log/     the log page
    src/app/event/   one event and its chain

`src/app/api/` holds hand-written interfaces mirroring the service's wire shapes. Nothing is
generated: the platform generates documents rather than clients.

Both transports have an injectable seam — `QITS_API_BASE` for paths and `WEB_SOCKET_FACTORY` for the
socket — because the behaviour most worth testing here is only reachable by driving `onopen`,
`onmessage` and `onclose` by hand.

## Development server

```bash
ng serve
```

Then open `http://localhost:4200/`. `proxy.conf.json` forwards `/events/api` and — with `ws: true` —
`/events/stream` to a gateway on `localhost:8080`, because `ng serve` puts no gateway in front. In a
deployment every call is a same-origin path behind the real one. These reads carry no credential in
either case: this service authenticates nothing by design, and the socket upgrade was measured
answering `101` with none.

## Running the checks

```bash
npm run lint && npm test && npm run build
```

Unit tests are Vitest on jsdom through `@angular/build:unit-test`. There is no vitest config file and
there should not be one. `HttpTestingController` for every request, `RouterTestingHarness` for the
routes, and a hand-driven fake socket for the tail.

There is no E2E framework on this platform. A browser pass is a scripted manual one, through the real
gateway at `:8080`, and it begins with a hard reload — every SPA here serves `index.html` with
`immutable, max-age=86400`, so a returning browser gets the stale page after every deploy.

## Building

```bash
ng build
```

The bundle lands in `dist/`. It is not deployed from here: qits-events carries this repository as a
git submodule at `service/src/main/webui` — Quinoa's ui-dir — and builds it into the service image at
`/events/`, so advancing that gitlink is what ships a change.
