# Phase 4 — Defend this

## The core design

1. **Why can't score submission be a single `POST /scores {gameId, score}`?**
   The server has nothing to validate against, so `999999999` is indistinguishable
   from a real result. ([ADR 0013](decisions/0013-two-phase-score-submission.md))

2. **What does `/plays/start` give the server that the client can't forge?**
   When the play began, which game, and which user — recorded server-side. Every
   plausibility check derives from that timestamp.

3. **What are the four checks on submit?**
   Token exists · belongs to this user · lasted ≥ 1000ms · implied points-per-second
   is within the game's ceiling.

4. **Why is `maxPlausibleScorePerSecond` per game rather than global?**
   A fast arcade shooter and a puzzle game have completely different legitimate
   scoring rates.

5. **Why does a REJECTED score return 201 instead of 400?**
   The request was valid and a play was recorded. `accepted: false` is the outcome,
   not a protocol error. 4xx would imply the client sent something malformed.

## The bug found in this phase

6. **Why read with `GET` before claiming with `GETDEL`?** ← *the real one*
   The first version consumed the token and checked ownership afterwards, so any
   failed attempt destroyed it. Verified: an attacker's rejected submission burned
   a stranger's token and the legitimate player lost their score. **Authorise
   before you perform a destructive action.**

7. **Doesn't the extra `GET` break single-use?**
   No. Two concurrent legitimate submissions can both pass the ownership check,
   but only one `GETDEL` returns a value; the other is correctly rejected.

8. **Why `GETDEL` rather than `GET` then `DEL`?**
   Atomicity. Separately, two concurrent submissions of the same token would both
   read a live value and both be counted.

## Idempotency

9. **How is idempotency different from the replay protection already provided by the token?**
   The token makes submission single-use, but an honest retry then gets a confusing
   `400 already-used` instead of the response it missed. Idempotency returns the
   original result. ([ADR 0014](decisions/0014-idempotency-keys.md))

10. **Why claim the idempotency key BEFORE running the work?**
    Caching only at the end leaves a window where two concurrent retries both find
    nothing cached and both execute — the duplicate it exists to prevent.

11. **Why delete the key when the operation throws?**
    Otherwise a transient failure is cached and becomes permanent for 24 hours.

## Honesty about the limits

12. **Can this be defeated?**
    Yes. An attacker can call `/plays/start`, wait a realistic interval, and submit
    a plausible fake. It raises cost, not impossibility. Unforgeable scoring needs
    server-authoritative gameplay — Phase 8.

13. **Why keep rejected plays?**
    A 40% rejection rate identifies a cheater; that pattern is invisible if only
    successes are stored. It is also the audit trail for disputes.

## Verified in this phase
- Instant submit → rejected, "34ms, below the 1000ms minimum"
- 2s play scoring 150 (72/sec against a ceiling of 100) → **accepted**
- Replaying a used token → 400
- Score of 999999999 → rejected, "488042947.3 points/second, above 100"
- Another user redeeming a token → 400 **and the token survives** (regression)
- Identical `Idempotency-Key` twice → identical body, same `playId`, one play stored
- 3 accepted + 2 rejected plays persisted; aggregation reports a 40% rejection rate
- Indexes: `{gameId, accepted, score:-1}`, `{userId, createdAt:-1}`, unique `nonce`
