# 0014 — Idempotency keys on score submission

**Status:** accepted · Phase 4

## The problem
A client POSTs a score, the response is lost to a flaky network, and the client
retries. Without protection the score is recorded twice.

The client **cannot tell a lost response from a failed request**, so it must retry.
That makes this the server's problem to solve, not the client's.

Note this is a different problem from replay protection. The play token already
makes a submission single-use — but that means an honest retry gets a confusing
`400 already-used` instead of the result it missed. Idempotency turns that into the
original response.

## Decision
The client sends a unique `Idempotency-Key` header per logical operation. The first
request runs the work and its response is cached under that key for 24 hours;
retries return the cached response without re-running anything.

Keys are namespaced per user (`idem:{userId}:{key}`) so one client cannot read
another's cached response by guessing a key.

## Claim the key BEFORE doing the work
The marker is written with `SET NX` *before* the operation runs, not after.

Caching only at the end leaves a window in which two concurrent retries both find
nothing cached and both execute — the exact duplicate this exists to prevent.

- `SET NX` succeeds → this caller does the work, then overwrites the marker with
  the real response.
- `SET NX` fails and the value is `__in_progress__` → the original is still
  running; return **409 IDEMPOTENCY_IN_PROGRESS** so the client retries shortly.
- `SET NX` fails and a response is cached → return it.

On failure the key is **deleted**, so a retry genuinely retries. Caching an error
would make a transient failure permanent for 24 hours.

## The header is optional
Without it the caller simply gets no protection. That keeps the endpoint usable
from the `/docs` explorer and a terminal, and it is the client's own risk to take.

## Verified
Two identical submissions with the same `Idempotency-Key` returned byte-identical
bodies with the **same `playId`** — one play recorded. The same retry without the
header returns `400 already-used`, which is why the header exists.
