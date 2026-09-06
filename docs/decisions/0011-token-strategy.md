# 0011 — Stateless access tokens, revocable refresh tokens in Redis

**Status:** accepted · Phase 3

## Decision
Two different tokens with two different jobs:

| | Access token | Refresh token |
|---|---|---|
| Format | JWT (signed, self-describing) | Opaque random 256-bit string |
| Stored server-side? | **No** | **Yes — Redis** |
| Lifetime | 15 minutes | 30 days |
| Revocable? | **No** | **Yes** |
| Used on | Every API request | Only `/auth/refresh` |

## Why two tokens
This is the central trade-off of token auth:

- A **stateless** token is fast — verifying a signature costs zero database round
  trips, which is what lets the API scale horizontally in Phase 11. But it cannot
  be revoked, because the server keeps no record of it.
- A **stateful** token is revocable, but costs a lookup on every request.

Using both gets most of each: ordinary requests are stateless and fast, while the
15-minute expiry bounds how long a stolen access token is useful. Revocation
happens at refresh time, which is rare.

Refresh tokens are **opaque, not JWTs**: the server looks them up regardless, so
there is nothing to gain from encoding claims, and an opaque string cannot leak
information if it ends up in a log or a proxy trace.

## Rotation and reuse detection
Every refresh **burns** the old token and issues a new one, and all tokens from one
login share a `familyId`.

Because a token is single-use, seeing the same one twice means it was captured —
the legitimate client and an attacker now both hold it, and the server cannot tell
which is which. The safe response is to revoke the **entire family**, forcing a real
re-login.

Rotation without reuse detection is much weaker: a stolen token would simply keep
working alongside the victim's.

```
refresh:token:{tokenId}   -> {userId, familyId}   live token
refresh:used:{tokenId}    -> familyId             already rotated (replay tripwire)
refresh:family:{familyId} -> SET of tokenIds      everything from one login
```

`GETDEL` is used to read-and-burn atomically. A `GET` followed by a `DEL` would let
two concurrent refreshes both succeed.

## Verified end to end
1. Login → token1. Refresh(token1) → token2. Refresh(token2) → token3. ✅
2. Attacker replays token1 → **401 `TOKEN_REUSE_DETECTED`** ✅
3. Victim's *current* token3 is now dead too → **401** ✅ (family revoked)
4. `used:` markers deliberately survive revocation, so replays keep being detected.

## The trade-off this creates, stated plainly
Roles live in the access token, so **a role change does not take effect until the
token expires**. Verified: promoting a user to admin in MongoDB left their existing
token still returning 403, and a new login was required.

That is the accepted cost of statelessness, and it is why access tokens are 15
minutes rather than hours. `/auth/refresh` re-reads the user from MongoDB, so
changes propagate within one refresh cycle at worst.

## Defend this
> "Why not just check the database on every request?"

That reintroduces a round trip on the hot path, which is what the design is buying
away. The compromise is a short access-token lifetime plus a revocable refresh
token, so the window of a stale permission is bounded and small.
