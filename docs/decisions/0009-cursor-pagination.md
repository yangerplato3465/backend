# 0009 — Cursor pagination, and let the database enforce uniqueness

**Status:** accepted · Phase 2

## Cursor pagination, not `?page=N`
List endpoints take `?limit=&cursor=`, where the cursor is the `_id` of the last
item on the previous page.

Offset pagination (`skip`) has two problems:

1. **Correctness.** With `skip`, a row inserted while a user pages shifts everything
   down, so an item is skipped or shown twice. A cursor is a stable position in the
   sort order, so concurrent inserts cannot corrupt paging.
2. **Performance.** `skip(100000)` makes MongoDB walk and discard 100,000 documents.
   `_id < cursor` is an index seek — the same cost on page 1 and page 10,000. This
   matters directly for Phase 5 leaderboards.

ObjectIds are monotonically increasing, so `_id < cursor` sorted `_id: -1` means
"the next page of older items". The query fetches `limit + 1` rows: if the extra row
comes back there is another page. That avoids a `countDocuments()` per request,
which would be a collection scan.

## Let the unique index enforce uniqueness
`createGame` does **not** check whether the slug exists before inserting. It inserts
and lets the unique index reject duplicates; the error handler maps MongoDB's error
code `11000` to a 409.

A check-then-insert is a race: two concurrent requests can both find nothing and
both insert. Only the database can make that atomic. **Checking first is not merely
redundant — it is incorrect under concurrency**, and it costs an extra round trip.

Verified: a duplicate `POST /games` returns
`409 {"code":"DUPLICATE_KEY","message":"A record with that slug already exists"}`.

## Defend this
> "Why not just check if it exists first?"

Because between the check and the insert, another request can insert the same value.
The unique index is the only thing that can decide atomically. Handle the error
instead of trying to prevent it.
