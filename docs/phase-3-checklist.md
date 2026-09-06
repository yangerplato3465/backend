# Phase 3 — Defend this

## Passwords

1. **Why is password hashing deliberately slow, and what does `memoryCost` do?**
   If the database leaks, the only defence is guesses-per-second. `memoryCost`
   specifically defeats GPUs — thousands of cores, but not thousands of spare
   19 MiB blocks. ([ADR 0010](decisions/0010-argon2id-password-hashing.md))

2. **Why argon2id rather than bcrypt?**
   bcrypt silently truncates at 72 bytes and is barely memory-hard.

3. **Why is there no "must contain a symbol" rule?**
   Composition rules produce `Password1!`. NIST SP 800-63B discourages them; length
   is what resists guessing. The 200-char cap exists because hashing cost scales
   with input — unbounded input is a cheap DoS.

## Tokens — the core of this phase

4. **Why two different tokens instead of one?**
   Stateless = fast (no DB round trip per request, which is what lets Phase 11 scale
   horizontally) but unrevocable. Stateful = revocable but costs a lookup. Using
   both gets a fast hot path plus real revocation.
   ([ADR 0011](decisions/0011-token-strategy.md))

5. **Why is the refresh token opaque instead of a JWT?**
   The server looks it up anyway, so encoding claims buys nothing — and an opaque
   string leaks nothing if it lands in a log.

6. **What is reuse detection, and why revoke the whole family?**
   Tokens are single-use, so seeing one twice means it was captured. The server
   cannot tell the attacker from the victim, so the safe move is to kill every
   session from that login and force a real re-login.

7. **Why `GETDEL` instead of `GET` then `DEL`?**
   Atomicity. Two concurrent refreshes with the same token would both pass a
   `GET`, and both would be issued new tokens.

8. **A user is promoted to admin. Why does their existing token still get 403?**
   Roles are read from the token, not the database — that is what makes a request
   cost zero DB round trips. Verified live. The bound on staleness is the 15-minute
   access-token lifetime; `/auth/refresh` re-reads the user from MongoDB.

## Not leaking information

9. **Why do "wrong password" and "unknown email" return the identical response?**
   Otherwise the login form is a membership oracle that tells an attacker which
   emails have accounts. ([ADR 0012](decisions/0012-no-account-enumeration.md))

10. **Why does login hash a dummy password when the user doesn't exist?** ← *subtle*
    Same message is not enough — returning in 1ms instead of 50ms leaks the same
    fact through timing. And the dummy hash is generated at runtime, because an
    invalid hard-coded one would fail parsing instantly and reintroduce the gap.

11. **Why is `passwordHash` marked `select: false`?**
    Defence in depth — forgetting to strip it in one serializer no longer leaks it.

## Verified in this phase
- Register → 201 with token pair; duplicate email → 409; weak password → 400
- `/auth/me` with token → 200; without → 401
- Rotation chain token1 → token2 → token3 all succeed
- Replaying burned token1 → **401 `TOKEN_REUSE_DETECTED`**, and the victim's live
  token3 dies with it (whole family revoked)
- Wrong password and unknown email → byte-identical 401 responses
- `POST /games`: no token → 401 · player → 403 · admin → 201
- Promoting to admin in Mongo left the old token at 403 until re-login
- Stored hash is `$argon2id$v=19$m=19456,t=2,p=1$...`, no plaintext anywhere
- `GET /users/:id` leaks neither `passwordHash` nor `email`
