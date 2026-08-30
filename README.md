# qits-events-platform-frontend

The event log's frontend: the read-only view of what has happened on this platform and what caused
what. Served by qits-events itself at the root of `events.<env>.<domain>` through Quinoa. No forms,
no writes at all.

**Both screens are built.** The log tails live, and the event page draws one event whole with the
causation it belongs to.

## The screens

- **`/`** (and `/<projectSlug>/`) — the log. Reverse-chronological, filterable by name, by time floor and by payload
  search, with a live tail behind a switch. Budget: **2 requests and nothing per row**, plus one
  socket and one request per connect once the tail is on.
  Everything a row draws arrives with the row; "this had a cause" is free because `parentId` is on
  it, and "this caused N" is deliberately not drawn, because it would be one request per row.

  Every filter is a query parameter and every filter is server-side — `?name=`, `?since=`, `?q=` —
  so the view is bookmarkable and the back button undoes a filter. Nothing is ever filtered out of
  rows already fetched: against today's server that means a filter appears not to work rather than
  quietly lying about how much the store holds. `?cursor=` is where the reader got to, written by
  "load more" over the address rather than pushed onto it; reopening such an address resumes at that
  cursor in **one** request, so the window then starts partway down the log and the page says so.

- **`/events/<id>`** (and `/<projectSlug>/events/<id>`) — one event, its payload, and the whole causation component it belongs
  to: walked up to the root by `parentId` and drawn down from there, with the arrived-at event
  marked. Budget: **`1 + U + D`** — 2 requests for a root with no children, 8 for the largest graph
  this platform has produced. The number is printed above the tree, so it can be checked against a
  network panel rather than taken on trust.

  The payload is drawn whole: parsed, pretty-printed at two spaces and re-sorted by key, which is
  the canonical reading of the bytes the publisher sent. It is never assumed to be JSON — a payload
  that does not parse is shown as it arrived and said to be what it is, and an absent one draws an
  empty state. Nothing is truncated; the largest payload on the live store is 220 bytes.

  Every row of the tree links to its own event page, and the log's cause column lands here.

The event page **names its noun**, and that is a decision. A bare `/<id>` reads shorter but swallows
every future top-level route, making the 404 unreachable and the choice irreversible once a link is
shared. Every sibling names its noun, and the segment matches the API path it mirrors.

## The project in the address

This app is **project scoped**: every page is reachable twice, once at the root and once under a
project slug — `/qits/` is the same log as `/`, and `/qits/events/<id>` the same event page as
`/events/<id>`. The literal routes are matched first, so `/events/<id>` stays this app's own page and
never reads as a project called `events`.

The scope is read from the address by `@qits/ui-components` (`provideQitsScope('project')`), never
from a route parameter, so one component serves both forms. It is drawn in the page header and
changes nothing else: qits-events holds one log for the whole platform, and a project narrows it in
no query this service offers. Picking a project in the chrome navigates — the URL is the only place
the scope is kept.

## What the service gives this app, and what it refuses

`GET /events/api/events` (the log, and `?parentId=` for one event's children), `GET
/events/api/events/{id}`, `GET /events/api/events/names`, and the `/events/stream` websocket. The
paging and filter parameters — `limit`, `cursor`, `name`, `since`, `q` — and the vocabulary route are
landing in parallel with this repository; the client sends them, treats a missing `nextCursor` as
"no more", and therefore renders correctly against the server running today, which ignores what it
does not know and answers the whole log.

**Every route envelopes its answer**, `GET .../events/{id}` included: the body is `{"event": …}` and
not the event. It is the one envelope that could plausibly have been absent, and reading past it
costs no error at all — a cast cannot see the difference, so the caller gets an object whose every
field is `undefined`. `src/app/api/events-api.ts` unwraps all three, and the spec flushes the real
shape so a client that stops unwrapping fails there rather than in a browser.

**There is no chain route, and there will not be one.** No `/chain`, no depth parameter, no graph
endpoint — the service says so in three places. A chain-walking client bounds its own depth and
remembers the ids it has visited, and `src/app/event/chain.ts` is that client: 32 hops up, depth 8
and 200 nodes down, an id-seen set on both walks, and a row saying where the walk stopped rather
than a silent truncation. Nothing server-side prevents a cycle either, so a loop is caught by id and
drawn where it closes.

A depth bound is a fact about one branch and is drawn beside it; the node cap is a fact about the
walk and is said once under the table. Reporting the second per node would bury a two-hundred-event
tree under a report about itself.

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
The list the page holds is typed as the frame rather than as the fetched row, so that day is a build
failure rather than a silence.

**The tail is off until the reader switches it on.** Its refetch-on-every-connect would otherwise
make the front door three requests where the design says two — and one of the three would be healing
a gap a few milliseconds wide. Behind the switch, the same request buys the reader everything the
page missed while it sat open, and the marker beside the switch says which of five things is true:
off, connecting, live, reconnecting, or paused.

**Paused** is the one corner worth naming. An address carrying `?cursor=` shows a window with the
cursor as its ceiling, and an event created a moment ago is above that ceiling — so the tail holds
its frames rather than drawing a row the window does not contain, and says so. "Back to the newest"
is the way out.

A frame goes through the same filters as the request. `?name=` is the socket's own subscribe set;
`?since=` and `?q=` have no spelling on the socket, so `src/app/log/frame-filter.ts` asks the frame
what the server's `where` clause would have asked — exactly, because the frame carries the payload
and the instant. **Nothing already fetched is ever filtered**, which is the client-side filter this
design rejects and this is not it.

## Layout

    src/app/api/     the wire shapes, one injectable over HttpClient, and the socket's own seam
    src/app/ui/      Loadable, Async, Empty, the shared page stylesheet, the formatters, TimeRange
    src/app/log/     the log page, its name filter and its per-name row summaries
    src/app/event/   one event and its chain

`src/app/ui/time-range.ts` is the "last hour / last 24h / custom" control, and it is **local on
purpose**: the observability UI wants the same thing, but every SPA pins `@qits/ui-components` at
`^0.0.4` while the library publishes calver, so a component added there today reaches no application
at all. It is a promotion candidate, not a local fork of something shared. A preset writes an
absolute instant rather than a phrase, so a shared link means one window rather than a different one
each time it is opened.

`src/app/log/event-summary.ts` gives each known event name a bespoke one-line gist —
`BuildSuccessful`, `SCMRelease`, `SoftwareRelease` — and anything else the first three `key=value`
pairs of its payload. **The fallback is the feature.** New names are born in a Java service and in no
SPA's release cycle, so a fourth event type has to be legible the day it first fires. The repository
gets its own column because it is written under `repoId` on builds and `repository` on releases, and
a log of 127 identical names that does not say which repository is a wall of one word.

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
`/events/stream`, plus `/main-navigation` and `/projects/api`, to an edge on `localhost:8080`,
because `ng serve` puts no edge in front. In a deployment every call is a same-origin path behind the
real one. These reads carry no credential in
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
edge at `:8080`, and it begins with a hard reload — every SPA here serves `index.html` with
`immutable, max-age=86400`, so a returning browser gets the stale page after every deploy.

## Building

```bash
ng build
```

The bundle lands in `dist/`. It is not deployed from here: qits-events-platform-service carries this
repository as a git submodule at `service/src/main/webui` — Quinoa's ui-dir — and builds it into the
service image at its root, so advancing that gitlink is what ships a change.
