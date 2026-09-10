# 0013 — Two-phase score submission with server-issued play tokens

**Status:** accepted · Phase 4

## The problem
The obvious design is one endpoint:

```
POST /scores  {gameId, score}
```

That cannot be secured. The server has nothing to check the score against, so
`{"score": 999999999}` is indistinguishable from a real result.

## Decision
Split it, so the server holds a fact the client cannot forge:

```
POST /plays/start   -> {playToken}   server records WHO, WHICH GAME, and WHEN
POST /plays/submit  {playToken, score}
```

`/plays/submit` then enforces four things:

| Check | Prevents |
|---|---|
| Token exists in Redis | Fabricated submissions |
| Token belongs to this user | Redeeming someone else's play |
| `durationMs >= 1000` | Start-and-submit-instantly |
| `score / seconds <= game.maxPlausibleScorePerSecond` | Impossible scores |

`maxPlausibleScorePerSecond` has been on the game model since Phase 2 for exactly
this. It is per game because a fast arcade shooter and a puzzle game have wildly
different legitimate rates.

## Read before claiming — a bug that was found and fixed
The first implementation called `GETDEL` immediately and checked ownership
*afterwards*. That consumed the token before deciding whether the caller was
entitled to it, so **any** failed attempt destroyed it.

Verified: an attacker submitting a stranger's token received a 400, and the
legitimate player's next submission then failed with "already used" — their score
was gone. Seeing a token was enough to burn it.

The fix reads with a non-destructive `GET`, verifies ownership, and only then
claims with `GETDEL`. The `GET` does not weaken single-use: two concurrent
legitimate submissions can both pass the ownership check, but only one `GETDEL`
returns a value.

**General lesson: validate authorisation before performing a destructive action,
not after.**

## Rejected plays are stored
A rejected submission is written with `accepted: false` and a reason, not discarded.

Discarding would throw away the most valuable signal available — a user with a 40%
rejection rate is a cheater, and that pattern is invisible if only successes are
kept. It is also the audit trail for "why wasn't my score counted?".

The response is **201, not 4xx**, when a score is rejected: the request was valid
and something was recorded. `accepted: false` is the outcome, not a protocol error.

## What this does NOT do
This makes cheating expensive, not impossible. An attacker can still call
`/plays/start`, wait a realistic interval, and submit a plausible fake. Defeating
that requires server-authoritative gameplay, which is what Phase 8 does with
Connect Four.

This is the correct level for score-attack games, and knowing where the line sits
is more useful than pretending there isn't one.

## Verified
| Scenario | Result |
|---|---|
| Submit instantly | rejected — "34ms, below the 1000ms minimum" |
| 2s play, 150 pts (72/sec, ceiling 100) | **accepted** |
| Replay the same token | 400 already-used |
| 2s play, 999999999 pts | rejected — "488042947.3 points/second, above 100" |
| Attacker redeems another user's token | 400, **and the token survives** |
