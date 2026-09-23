---
title: "Event sourcing a menu when the log is append-only and prices change"
description: "How the menu-events store refuses a stale price change and answers a retransmit without rewriting a single row."
date: 2026-09-23
tags: [event-sourcing, menu-events]
draft: false
---

A menu is edited by several people at once. A manager reprices an item, a
line cook marks it sold out, front-of-house restores it a minute later. A
table with one row per item handles that badly, for three reasons, and
`docs/adr/0001-event-sourcing-over-crud.md` in the `menu-events` repo names all
three: the row can only record the last change, so "who set this price and was
it a correction" becomes a reconstruction; undoing a mis-tap means editing a
stored row; and two writers who read the same row clobber each other with
last-write-wins.

`menu-events` keeps the history instead of the current row. Every accepted
change is an immutable event on an append-only log. The menu you read is a fold
over those events. Nothing rewrites a row, because there are no rows to
rewrite, only events that stay.

## The version rule

Every command carries `expected_menu_version`: the version of the stream the
writer looked at before deciding. The store appends only when that number
matches the head it is about to extend. The loser of a race is refused, and the
refusal carries the version the caller needs to re-read against.

That check lives in the store, not the handler. Here is `InMemoryEventStore.append`
verbatim from `src/menu_events/store/memory.py`:

```python
with self._lock:
    rows = self._rows.setdefault(stream_id, [])
    recorded = self._row_for_command(rows, command_id)
    if recorded is not None:
        return AppendResult(
            version=int(recorded["version"]),
            event_id=uuid.UUID(str(recorded["event_id"])),
            duplicated=True,
        )

    head = int(rows[-1]["version"]) if rows else 0
    if expected_version != head:
        raise ConcurrencyConflict(stream_id, expected_version, head)

    envelope = EventEnvelope(
        stream_id=stream_id,
        version=head + 1,
        event_id=event_id or uuid.uuid4(),
        command_id=command_id,
        recorded_at=self._clock(),
        event=event,
    )
    rows.append(to_row(envelope))
    return AppendResult(envelope.version, envelope.event_id)
```

The `ConcurrencyConflict` it raises is a plain exception that keeps both
numbers (`src/menu_events/domain/errors.py`):

```python
class ConcurrencyConflict(CommandRejected):
    def __init__(self, stream_id: str, expected: int, actual: int) -> None:
        super().__init__(
            f"stream {stream_id} is at version {actual}, command expected {expected}"
        )
        self.stream_id = stream_id
        self.expected = expected
        self.actual = actual
```

The handler does not paper over this. It projects the stream only up to
`expected_menu_version` before validating, so the state it checked against and
the version the append compares against are the same state. A caller cannot get
a write accepted by claiming a version it never looked at.

Run against the in-memory store, four writes and one stale write:

```python
import uuid
from menu_events import (
    AddMenuItem, ChangePrice, ConcurrencyConflict, InMemoryEventStore,
    MarkSoldOut, MenuCommandHandler, menu_stream_id, project,
)

menu_id = uuid.UUID("6f1c9f2e-0a1b-4c2d-9e3f-1a2b3c4d5e6f")
fries = uuid.UUID("11111111-1111-4111-8111-111111111111")
bread = uuid.UUID("22222222-2222-4222-8222-222222222222")

store = InMemoryEventStore()
handler = MenuCommandHandler(store)
stream_id = menu_stream_id(menu_id)

handler.handle(AddMenuItem(menu_id=menu_id, item_id=fries, command_id=uuid.uuid4(),
    expected_menu_version=0, actor="line-1", name="Duck fat fries",
    price_cents=900, category="sides"))
handler.handle(AddMenuItem(menu_id=menu_id, item_id=bread, command_id=uuid.uuid4(),
    expected_menu_version=1, actor="line-1", name="Sourdough",
    price_cents=400, category="breads"))
handler.handle(ChangePrice(menu_id=menu_id, item_id=fries, command_id=uuid.uuid4(),
    expected_menu_version=2, actor="manager", reason="potato cost up",
    price_cents=1150))
handler.handle(MarkSoldOut(menu_id=menu_id, item_id=bread, command_id=uuid.uuid4(),
    expected_menu_version=3, actor="line-1"))

state = project(stream_id, store.read(stream_id))
print(f"menu at version {state.version}:")
for item in state.on_menu:
    flag = "sold out" if item.sold_out else "available"
    print(f"  {item.category:<7} {item.name:<16} {item.price_cents/100:>6.2f}  {flag}")

# a terminal still holding version 1 tries to reprice the fries
try:
    handler.handle(ChangePrice(menu_id=menu_id, item_id=fries, command_id=uuid.uuid4(),
        expected_menu_version=1, actor="late-terminal", price_cents=500))
except ConcurrencyConflict as exc:
    print(f"refused: {exc}")
print(f"log length after the refused command: {len(store.read(stream_id))}")
```

Output, from `menu-events/.venv/bin/python`:

```
menu at version 4:
  breads  Sourdough          4.00  sold out
  sides   Duck fat fries    11.50  available
refused: stream menu/6f1c9f2e-0a1b-4c2d-9e3f-1a2b3c4d5e6f is at version 4, command expected 1
log length after the refused command: 4
```

The refused command wrote nothing. The log is still four events long, and the
next read still says version 4. That is the whole point of optimistic
concurrency: losing is explicit, so the caller re-reads and decides whether its
intent still holds instead of silently overwriting the manager's price.

## Retrying is not a second write

`command_id` is the idempotency key. The store looks it up before the version
check, because a client that timed out and resent carries the version from
*before* the write that already landed. Treating that retransmit as stale would
turn a network timeout into a failed command. The order in `append` above is the
mechanism: the duplicate check is the first thing inside the lock.

```python
import uuid
from menu_events import AddMenuItem, InMemoryEventStore, MenuCommandHandler, menu_stream_id

menu_id, item, cmd = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
store = InMemoryEventStore()
handler = MenuCommandHandler(store)

first = handler.handle(AddMenuItem(menu_id=menu_id, item_id=item, command_id=cmd,
    expected_menu_version=0, actor="line-1", name="Sourdough",
    price_cents=400, category="breads"))
retry = handler.handle(AddMenuItem(menu_id=menu_id, item_id=item, command_id=cmd,
    expected_menu_version=0, actor="line-1", name="Sourdough",
    price_cents=400, category="breads"))

print(f"first:  version={first.menu_version} applied={first.applied} event_id={first.event_id}")
print(f"retry:  version={retry.menu_version} applied={retry.applied} event_id={retry.event_id}")
print(f"log length after the retry: {len(store.read(menu_stream_id(menu_id)))}")
```

```
first:  version=1 applied=True event_id=dd051941-df82-46f5-a368-f9b0740107e4
retry:  version=1 applied=False event_id=dd051941-df82-46f5-a368-f9b0740107e4
log length after the retry: 1
```

Same `event_id`, `applied=False`, one event in the log. The `applied` flag is
how a caller tells a fresh write from a retransmit without comparing versions.

## What a correction is

A price edit and a correction of a price edit are the same kind of object: a
later event. `corrects` is a pointer from one event to the one it amends; both
stay in the log, and the fold simply ends at the later one. There is no undo
path, because undoing is just writing what should now be true.

The fold is `project` in `src/menu_events/projections/menu.py`, and it is pure
Python that reads no clock:

```
events (oldest first)                 fold, apply_event per event
  v1 menu_item_added  Sourdough 4.00    state.items[bread] = 4.00
  v2 price_changed    fries    11.50    state.items[fries] = 11.50
  v3 item_sold_out    bread             state.items[bread].sold_out = True
  v4 price_changed    fries    11.50    (corrects=v2; menu does not move,
                                         but the fact it was set does)
        |                                        |
        +------------ one stream ----------------+--> MenuState at version 4
```

`recorded_at` arrives on the envelope the store assigned, not from a clock read
inside the fold, so replaying reproduces the menu a customer saw at that point
rather than the menu as of now. That is why one `project()` serves both the
in-memory tests and the projector without a second implementation to keep
honest.

## Why there is no cache in front of this

The read endpoint folds the stream on every request. A tempting optimization is
to cache the folded menu. The design refuses it, and the reason is the same
version rule above: every read hands the caller the version it folded from, and
a writer is expected to claim that version. Serve the read from something that
can lag the log and two things break at once. A writer holding the current
version gets refused against a stale one it never saw, and a writer holding a
genuinely stale version gets refused for the wrong reason, so a conflict stops
being a reliable signal that a race was lost. Optimistic concurrency is only
worth having if the version a reader was handed is the version the store held at
that moment. `menu_projection` is the only cached copy the design keeps, and it
stores the version it folded to, so a consumer can tell a stale menu from a
fresh one instead of guessing.

## What is not proven

The whole portable core, the version rule and the idempotency rule and the fold,
run against `InMemoryEventStore`, and the same rules run again over HTTP through
`menu_events.api`:

```
$ cd menu-events && .venv/bin/python -m pytest -q
94 passed, 10 skipped in 1.53s
```

Those 10 skips are the entire PostgreSQL tier. There is no database in this
development environment, so `tests/integration/` skips wherever
`MENU_EVENTS_TEST_DSN` is unset, and a green run without a server proves nothing
about `store/postgres.py`: not the append-only trigger, not the grants, not the
advisory-lock version check, not the one-transaction atomicity of a write. The
Postgres adapter has never met a server.

That is written into the repo rather than hidden. ADR 0001 opens by separating
what executed from what was only read out of SQL, and the README says the same
in its own words: the unverified parts "are unverified until someone runs the
tier against a real server." A cache tier, and the fold cost at a real stream
length, are argued about in the ADR with no number attached, because a figure
for either would be a guess dressed as an argument. The measurement of the fold
is a separate post.
