# 0016 — Redis is a derived index, MongoDB is the source of truth

**Status:** accepted · Phase 5

## Decision
Every byte in Redis can be reconstructed from MongoDB. `pnpm rebuild:leaderboards`
rebuilds all boards from the `plays` collection.

## Why this matters
It converts "what happens when Redis dies?" from a shrug into a command.

Redis is memory-first. Even with AOF enabled, a container restart, an eviction under
`maxmemory`, or a misfired `FLUSHALL` can lose data. If leaderboards were the only
record of scores, that would be permanent data loss.

Because MongoDB stores every play — accepted and rejected — Redis holds nothing
irreplaceable. That is what makes it safe to treat Redis as fast and disposable, and
it is what lets Phase 11 scale or restart pods without ceremony.

It is also how a scoring-rule change is applied to history: change the rule, re-run
the script, and the boards reflect it.

## Verified by destroying it
1. Captured both leaderboards via the API.
2. `FLUSHALL` — all 53 keys gone; the API returned 0 entries.
3. `pnpm rebuild:leaderboards`.
4. Compared: **byte-identical** for both `blockfall` (5 entries) and `connect-four`
   (3 entries), including ordering and the lower-is-better direction.

## The rebuild is transactional per key
Each board is rebuilt as `MULTI: DEL key; ZADD ...; EXPIRE` in one transaction. A
`DEL` followed by a separate `ZADD` would leave a window in which readers see an
empty leaderboard.

## Write ordering
`submitPlay` persists to MongoDB **first**, then writes to Redis. The source of
truth is therefore never behind the derived index. If the Redis write fails, the
board is briefly stale and the rebuild script fixes it — the failure mode is
"temporarily wrong", never "lost".

## Defend this
> "Your Redis just got flushed in production. What now?"

Run the rebuild script. MongoDB has every play, so the boards are recomputed from
the source of truth. Nothing is lost, because Redis never held anything that only
existed there.
