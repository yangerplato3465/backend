# 0015 — Redis sorted sets for leaderboards

**Status:** accepted · Phase 5

## Decision
Leaderboards are Redis sorted sets (ZSETs), one key per game per window:

```
lb:global:{gameId}                all-time,  no TTL
lb:daily:{gameId}:{YYYYMMDD}      TTL 48h
lb:weekly:{gameId}:{YYYY-Www}     TTL 14d
```

Member = userId, score = the player's best score.

## Why — measured, not assumed
Benchmarked at 200,000 players on this machine:

| Operation | Redis | MongoDB (indexed on score) |
|---|---|---|
| **Rank of one player** | **0.25 ms** | 23.15 ms — **93× slower** |
| Top 20 | 0.40 ms | 0.70 ms — comparable |

The nuance matters more than the headline. **Top-N is perfectly fine in MongoDB** —
it is an index seek, and Redis wins only marginally. Reaching for Redis to serve a
top-20 list would be cargo-culting.

**Rank is the operation that does not scale.** "You are #4,213" in MongoDB means
`countDocuments({score: {$gt: mine}})` — counting every better row, growing linearly
with the collection. A ZSET is a skip list that carries span information in its
nodes, so it computes rank in O(log N).

That single operation is the honest justification for Redis in this architecture.

## `scoreDirection` decides the flag AND the read
Sorted sets only sort ascending, so the game's direction changes both halves:

| Direction | Personal best | Read the board | Read a rank |
|---|---|---|---|
| `higher` (Tetris) | `ZADD GT` (keep max) | `ZREVRANGE` | `ZREVRANK` |
| `lower` (fewest moves, fastest time) | `ZADD LT` (keep min) | `ZRANGE` | `ZRANK` |

Using `GT` for a lower-is-better game would store each player's **worst** result and
rank the field upside down. Verified with `connect-four` (`scoreDirection: "lower"`,
scored as moves-to-win): fewest moves ranks #1, and a worse replay leaves the best
untouched.

## `GT`/`LT` instead of read-compare-write
"Only update if strictly better" is one atomic command. The alternative — read the
current score, compare, write if better — is a race: two concurrent submissions can
both read the old value and the later write can erase the better score.

`CH` makes ZADD report how many entries actually changed, which is how the API knows
whether to report `newPersonalBest: true`.

## TTLs replace a cleanup job
The key name encodes its period, so tomorrow's board is simply a different key that
appears on first write, and Redis deletes the old one when the TTL lapses. No
scheduled purge, no `WHERE createdAt BETWEEN ...` scan.

The grace period is deliberate (48h for a daily board) so "yesterday's winners"
stays readable after the window closes.

All buckets are computed in **UTC**. Server-local time would shift every boundary
when the deployment region changed, and two pods in different zones would disagree
about what day it is. Weeks use ISO-8601 — Monday start, week 1 contains the first
Thursday — because naive `dayOfYear / 7` makes boards jump around near New Year.

## One query for display names
Attaching names to a page uses a single `$in` query, not one lookup per row. A
100-row page would otherwise fire 100 round trips — the classic N+1, which would
make the 0.25 ms Redis read irrelevant.

## Offset pagination is correct here
ADR 0009 rejected offset pagination for lists, but leaderboards use it deliberately:
`ZREVRANGE` takes an index range with no skip-and-discard cost, and a leaderboard's
entire purpose is stable numbered ranks — which a cursor cannot express.
