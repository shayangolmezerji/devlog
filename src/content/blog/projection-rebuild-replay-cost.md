---
title: "The projection rebuild and what replay costs"
description: "Measured fold times on the in-memory menu store, and the O(events x items) term the ADR left out."
date: 2026-09-23
tags: [event-sourcing, menu-events]
draft: false
---

The event log is the authority; the menu read model is derived from it and
disposable. `PostgresMenuReadModel` says so about itself in
`src/menu_events/projections/postgres.py`: "a bad projection is dropped and
recomputed rather than patched by hand." Recomputing means replaying the fold
over the log, so the question this post answers is what that replay costs. Not
in theory: run, with numbers.

## Two rebuild paths, one fold

The projector has two writers over the same `apply_event` fold.

`advance` folds only the events the log gained since the last run. From
`src/menu_events/projections/postgres.py`:

```python
def advance(self, stream_id: str) -> int:
    """Apply whatever the log gained since the last run. Returns the new version."""
    with self._locked(stream_id) as conn:
        checkpoint = self._checkpoint(conn, stream_id)
        self._touch_checkpoint(conn, stream_id, checkpoint)
        state = self._load(conn, stream_id, version=checkpoint)
        for envelope in self._store.read(stream_id, from_version=checkpoint):
            state = apply_event(state, envelope)
            self._write_item(conn, stream_id, state.items[envelope.event.item_id])
        self._touch_checkpoint(conn, stream_id, state.version)
        return state.version
```

`rebuild` throws the derived rows away and folds the whole stream again, in one
pass:

```python
def rebuild(self, stream_id: str) -> int:
    """Discard the rows and fold the entire stream again. Returns the version."""
    with self._locked(stream_id) as conn:
        checkpoint = self._checkpoint(conn, stream_id)
        self._touch_checkpoint(conn, stream_id, checkpoint)
        state = project(stream_id, self._store.read(stream_id))
        conn.execute(_DELETE_ITEMS_SQL, (stream_id,))
        for item in state.items.values():
            self._write_item(conn, stream_id, item)
        self._touch_checkpoint(conn, stream_id, state.version)
        return state.version
```

Steady state wants `advance`: it reads from the `checkpoint` the last run
published, so it folds only the new tail. `rebuild` is for when the checkpoint
cannot be trusted — a first run, a projection written before a change to
`apply_event`, a bug found in the derived rows. Both are PostgreSQL code paths
that have never run here, so measuring them needs a server this environment does
not have.

What *can* be measured is the fold itself, and that matters for a second reason.
The HTTP read does not use the checkpoint table at all. `read_menu` in
`src/menu_events/api.py` folds the whole stream on every request:

```python
store: EventStore = request.app.state.store
stream_id = menu_stream_id(menu_id)
envelopes = store.read(stream_id)
if not envelopes:
    raise MenuStreamNotFound(stream_id)
state = project(stream_id, envelopes)
```

So replay cost is not just a rebuild-time concern. `GET /menu/{id}` pays a full
fold per read. ADR 0001 flags exactly this as the thing to measure before adding
a cache: "the cost of the fold at the longest real stream ... is O(events) per
read." Here is what that O(events) turns out to be on one machine.

## The measurement

Machine, in one line: `Intel Core i7-7500U @ 2.70GHz`, `nproc` reports 4,
`free -g` reports 7 total, CPython 3.13.5, single process, `InMemoryEventStore`,
no database.

The script appends a chosen number of events to one stream (a fixed set of item
adds, then price churn cycling over those items), then times two things: a
cold rebuild — `project(stream_id, store.read(stream_id))` over the whole stream
— and an incremental apply of a 100-event tail on top of a state already folded
to the checkpoint, which is `advance`'s inner loop. Each figure is the best of
three runs after one warm pass, and the append loop that builds the stream is
never inside a timed region.

```python
import time
import uuid

from menu_events import InMemoryEventStore, menu_stream_id, project
from menu_events.domain.events import MenuItemAdded, PriceChanged
from menu_events.projections.menu import apply_event

TAIL, REPEATS, ITEMS = 100, 3, 50


def build_store(stream_id, n_events, *, items, actor="bench"):
    store = InMemoryEventStore()
    item_ids = [uuid.uuid4() for _ in range(items)]
    version = 0
    for item_id in item_ids:
        store.append(stream_id=stream_id, expected_version=version,
                     event=MenuItemAdded(item_id=item_id, actor=actor,
                                         name=f"item-{item_id.hex[:8]}",
                                         price_cents=500, category="bench"),
                     command_id=uuid.uuid4())
        version += 1
    while version < n_events:
        store.append(stream_id=stream_id, expected_version=version,
                     event=PriceChanged(item_id=item_ids[version % items],
                                        actor=actor, price_cents=500 + version),
                     command_id=uuid.uuid4())
        version += 1
    return store


def best_of(fn):
    fn()
    return min(_timed(fn) for _ in range(REPEATS))


def _timed(fn):
    start = time.perf_counter()
    fn()
    return time.perf_counter() - start


def cold_rebuild(store, stream_id):
    envelopes = store.read(stream_id)
    return best_of(lambda: project(stream_id, envelopes))


def incremental_tail(store, stream_id, *, checkpoint):
    base = project(stream_id, store.read(stream_id), through_version=checkpoint)
    tail = list(store.read(stream_id, from_version=checkpoint))

    def run():
        state = base
        for envelope in tail:
            state = apply_event(state, envelope)
        return state

    return best_of(run)


for n in (1_000, 5_000, 20_000):
    sid = menu_stream_id(uuid.uuid4())
    store = build_store(sid, n, items=ITEMS)
    cold = cold_rebuild(store, sid)
    warm = incremental_tail(store, sid, checkpoint=n - TAIL)
    print(f"N={n:>6}  cold={cold:.4f}s ({cold/n*1e6:5.1f} us/event)  "
          f"incremental(100)={warm*1e6:.1f}us")

for items in (10, 100, 500, 2_000):
    n = items + 500
    sid = menu_stream_id(uuid.uuid4())
    store = build_store(sid, n, items=items)
    cold = cold_rebuild(store, sid)
    warm = incremental_tail(store, sid, checkpoint=n - TAIL)
    print(f"items={items:>5}  cold={cold:.4f}s ({cold/n*1e6:5.1f} us/event)  "
          f"incremental(100)={warm*1e6:.1f}us")
```

Run it from the `menu-events` checkout (the package is installed editable in
`.venv`):

```
$ .venv/bin/python /tmp/replay_bench.py
N=  1000  cold=0.0171s ( 17.1 us/event)  incremental(100)=1491.8us
N=  5000  cold=0.0859s ( 17.2 us/event)  incremental(100)=1530.1us
N= 20000  cold=0.3982s ( 19.9 us/event)  incremental(100)=2089.9us
items=   10  cold=0.0047s (  9.3 us/event)  incremental(100)=1707.5us
items=  100  cold=0.0233s ( 38.9 us/event)  incremental(100)=3697.6us
items=  500  cold=0.1429s (142.9 us/event)  incremental(100)=26356.9us
items= 2000  cold=0.8134s (325.3 us/event)  incremental(100)=43210.6us
```

The block above is one run of each row. Repeating the script three more times on
the same box, which was not idle, moved the absolute figures by up to 1.7x on a
cold fold and 2.2x on an incremental tail. A cold event on the 500-item menu came
out at 143, 83, 113 and 129 microseconds across the four runs, and the 100-event
tail at 26.4, 11.8, 19.8 and 16.6 milliseconds. The shape held every time. Cost
per event rose with the item count in all four runs, and it stayed between 17 and
29 microseconds as the stream grew from 1,000 to 20,000 events at a fixed menu
size. What the table carries is the ordering and the slope. The digits are one
run on one machine.

## What the numbers say

Cold rebuild is linear in event count at a fixed menu size: the per-event cost
does not grow with the stream, landing between 17 and 29 microseconds per event
from 1,000 to 20,000 events at 50 items across the four runs, so a 20,000-event
stream folded in 0.37 to 0.57 seconds. That part matches the ADR.

The incremental figures are the reason `advance` exists. A 100-event tail costs
about 1.5 to 3.2 milliseconds regardless of whether the stream is 1,000 or
20,000 events long. `advance` does not get slower as history grows; `rebuild`
does. Steady-state catch-up is cheap, and a full recompute is the expensive
fallback.

Then the inconvenient finding, in the second block. The per-event cost of the
fold is not a constant; it grows with how many items are on the menu. In the run
above a cold event costs 9 microseconds at 10 items, 39 at 100, 143 at 500, 325
at 2,000. A
single 100-event incremental catch-up costs 1.7ms on a 10-item menu and 43ms on
a 2,000-item menu, even though exactly the same 100 events are applied. The fold
is O(events x items), not the O(events) the ADR writes.

The cause is visible in `apply_event` in `src/menu_events/projections/menu.py`:

```python
    items = dict(state.items)
    items[event.item_id] = item
    return MenuState(stream_id=state.stream_id, version=envelope.version, items=items)
```

Every event copies the entire item map and rebuilds a frozen `MenuState`, which
pydantic revalidates in full. Keeping the projection immutable and
replay-deterministic has a per-step price proportional to menu size. At the
scale ADR 0001 actually targets — "each with tens of items" — the item count is
effectively a constant, so the fold stays linear in events with a ~20 microsecond
slope and the design is fine. The complexity class is only larger than the ADR
claims, and it only bites once a single stream carries thousands of live items.
`GET /menu/{id}` folds per request, so that endpoint inherits the same term.

## Snapshot or not

The event log is never snapshotted. The read model is the snapshot: it stores
the version it folded to in `menu_projection`, and `advance` resumes from there.
A rebuild is the reset button, not the routine path. That removes the classic
"when do I write an event snapshot" question entirely, at the cost of accepting
that a rebuild is a full O(events x items) fold.

## What this measurement does not cover

This is the in-memory adapter, single process, CPython 3.13.5, no database. It
measures the pure-Python fold and nothing else. It says something about the
fold's complexity and its constant factor, and nothing about a production
PostgreSQL rebuild, which adds per-event row writes and an advisory lock around
the whole thing and runs on hardware I do not have here. Those Postgres code
paths have run since: 15 integration tests against PostgreSQL 16.15, including
`advance` and `rebuild` writing into a real `menu_item` table under an advisory
lock. What has not been measured is the same pair of numbers on that server, which
is the figure that would move if the per-event row writes dominated the fold. What
is claimed here is only the fold: measured, on the adapter that actually ran.
