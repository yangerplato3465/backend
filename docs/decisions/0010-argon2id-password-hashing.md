# 0010 — Hash passwords with argon2id

**Status:** accepted · Phase 3

## Decision
`@node-rs/argon2` with argon2id at `memoryCost: 19456` (19 MiB), `timeCost: 2`,
`parallelism: 1` — the OWASP Password Storage Cheat Sheet baseline.

## Why hashing is slow on purpose
A password hash is designed to be **expensive**. If the database leaks, the only
thing standing between an attacker and every user's password is how many guesses
per second they can make. A fast hash (SHA-256) allows billions per second on a GPU.

`memoryCost` is the parameter that specifically defeats GPU and ASIC cracking: a
GPU has thousands of cores but nowhere near thousands of spare 19 MiB blocks, so
memory bandwidth becomes the bottleneck rather than raw compute.

## Why argon2id over bcrypt
- bcrypt **silently truncates at 72 bytes** — a longer passphrase is quietly cut.
- bcrypt is barely memory-hard, so it is far weaker against GPU attacks.
- Argon2id is the current recommendation and resists both GPU and side-channel attacks.

## Why `@node-rs/argon2` over `argon2`
The `argon2` package is a native C++ addon that frequently fails to build on Alpine
(musl). `@node-rs/argon2` is Rust with prebuilt musl binaries. Verified: it installs
and runs in the `node:22-alpine` image with no build toolchain.

## Notes
- Argon2 encodes its parameters inside the hash string, so raising the cost later
  does **not** invalidate existing passwords — old hashes verify with their own
  parameters.
- `verifyPassword` returns `false` instead of throwing on a malformed hash, so a
  corrupted record behaves like a wrong password rather than a 500 that reveals it.
- Password policy is **length only** (min 10). Composition rules push people toward
  `Password1!` and are discouraged by NIST SP 800-63B. The max length of 200 exists
  because hashing cost scales with input — an unbounded password is a cheap DoS.

## Verified
Stored value is `$argon2id$v=19$m=19456,t=2,p=1$...`, and the plaintext appears
nowhere in the document.
