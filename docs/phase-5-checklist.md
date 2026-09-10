# Phase 5 — Defend this

## The justification for Redis

1. **Why Redis for leaderboards instead of a MongoDB query?** ← *the headline*
   Measured at 200k players: rank lookup is **0.25 ms in Redis vs 23.15 ms in
   MongoDB — 93× faster**. A ZSET is a skip list carrying span information, so rank
   is O(log N); MongoDB must count every better score.
   ([ADR 0015](decisions/0015-redis-sorted-set-leaderboards.md))

2. **What is the nuance most people get wrong here?** ← *say this and you sound senior*
   **Top-N is fine in MongoDB** — 0.40 ms vs 0.70 ms, an index seek either way.
   Only *rank* fails to scale. Adding Redis to serve a top-20 list would be
   cargo-culting; adding it to serve rank is justified.

3. **What exactly is stored?**
   Member = userId, score = that player's best. One key per game per window.

## Correctness details

4. **`connect-four` is lower-is-better. What changes?**
   Sorted sets only sort ascending, so BOTH halves flip: `ZADD LT` to keep the
   minimum, and `ZRANGE`/`ZRANK` to read. Using `GT` would store each player's
   *worst* result and rank the field upside down.

5. **Why `ZADD GT` rather than read, compare, then write?**
   One atomic command. Read-compare-write is a race — two concurrent submissions
   can both read the old value and the later write erases the better score.

6. **What does `CH` do?**
   Makes ZADD report how many entries actually changed, which is how the API
   answers `newPersonalBest`.

7. **How do daily boards get cleaned up?**
   They don't — the key name encodes the date and the TTL deletes it. Tomorrow's
   board is a different key that appears on first write. No purge job, no range scan.

8. **Why UTC, and why ISO-8601 weeks?**
   Local time shifts every boundary when the deploy region changes, and two pods in
   different zones would disagree about the date. Naive `dayOfYear/7` makes boards
   jump around near New Year.

9. **Why is offset pagination fine here when ADR 0009 rejected it for lists?**
   `ZREVRANGE` takes an index range with no skip-and-discard cost, and a
   leaderboard's whole point is stable numbered ranks — which a cursor cannot express.

10. **Why one `$in` query for display names?**
    A 100-row page with a lookup per row is 100 round trips — the N+1 that would
    make a 0.25 ms Redis read pointless.

## The invariant

11. **Redis gets flushed in production. What do you do?** ← *the one to rehearse*
    Run `pnpm rebuild:leaderboards`. MongoDB stores every play, so boards are
    recomputed from the source of truth. Nothing is lost, because Redis never held
    anything that existed only there.
    ([ADR 0016](decisions/0016-redis-as-derived-index.md))

12. **Why does the rebuild wrap each board in MULTI?**
    `DEL` then a separate `ZADD` leaves a window where readers see an empty board.

13. **Why write to MongoDB before Redis on submit?**
    So the source of truth is never behind the derived index. A failed Redis write
    means "temporarily stale", never "lost".

## Verified in this phase
- 5-player board ranks correctly with display names joined
- `ZADD GT`: a worse replay kept Ada at 140 (`newPersonalBest: false`); a better one
  moved her to 148 (`true`)
- `connect-four` (lower-is-better): fewest moves ranks #1; Grace's 30-move replay
  left her best at 7
- A player with no score returns `rank: null`, not an error
- TTLs: global `-1`, daily ~48h, weekly ~14d
- **FLUSHALL then rebuild → byte-identical boards** for both games
- Benchmark at 200k players: rank 0.25 ms vs 23.15 ms; top-20 0.40 ms vs 0.70 ms
