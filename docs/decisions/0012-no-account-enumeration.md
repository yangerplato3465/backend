# 0012 — Never reveal whether an account exists

**Status:** accepted · Phase 3

## Decision
Login returns the identical response — status, code, and message — whether the
email is unknown or the password is wrong, and takes the same amount of time.

## Why
"No account with that email" turns the login form into a **membership oracle**. An
attacker feeds in a list of emails and learns which people have accounts. That is
valuable on its own (a leaked list of users of a site), and it halves the work of
credential stuffing: they now know which accounts are worth attacking.

## The part that is easy to miss: timing
Returning the same *message* is not enough. The obvious implementation is:

```ts
const user = await findUser(email);
if (!user) return unauthorized();          // returns in ~1ms
const ok = await verifyPassword(...);      // takes ~50ms — argon2 is slow ON PURPOSE
```

The unknown-email path returns ~50× faster, and that difference is measurable over
the network. The timing leaks exactly what the message was written to hide.

So the login path **always** performs a verification. When no user is found it
verifies against a throwaway hash, making both paths cost the same.

That dummy hash is **generated at runtime**, not hard-coded. A hand-written constant
that is not a valid argon2 string would fail parsing almost instantly — restoring
the very timing difference it exists to remove. This was caught and fixed during
implementation.

## Where this deliberately does NOT apply
`POST /auth/register` returns **409 Conflict** on a duplicate email, which does
reveal that the address is taken. That is unavoidable: the user must be told they
already have an account. Registration is rate-limited in Phase 6 to make bulk
probing impractical.

Logout returns **204** whether or not the token existed — idempotent, and it avoids
confirming whether a captured token was still valid.

## Verified
Wrong password and unknown email both return
`401 {"code":"INVALID_CREDENTIALS","message":"Invalid email or password"}` — byte
for byte identical apart from the request id.
