# 0005 — Pin MongoDB to 7.0.x locally

**Status:** accepted · Phase 1

## Decision
`docker-compose.yml` pins `mongo:7.0.40` rather than `mongo:8`.

## Why
MongoDB 8.0+ **refuses to start** on Linux kernel 6.19 and newer:

> MongoDB cannot start: Linux kernel versions 6.19 and newer has a known
> incompatibility with this version of MongoDB.

The root cause ([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)) is
TCMalloc violating the upstream rseq (restartable sequences) ABI, which crashes
MongoDB at startup. MongoDB added a hard version gate so it exits with a clear
message instead of crashing opaquely.

OrbStack's VM runs kernel **7.0.14**, so every MongoDB 8.x release is blocked here.

## What was tried
| Attempt | Result |
|---|---|
| `mongo:8` | Refuses to start (fatal, exit 1) |
| `mongo:8` + `GLIBC_TUNABLES=glibc.pthread.rseq=0` | Still refuses — the version gate runs *before* the tunable takes effect |
| `mongo:7.0.40` | **Starts normally**, WiredTiger opens, `ping` returns 1 |

## Consequences
None meaningful for this project. Everything used here — documents, indexes,
aggregation, transactions, change streams — behaves identically in 7.0 and 8.0.

This constraint is **local only**. Phase 12 uses MongoDB Atlas, which runs on
MongoDB's own kernels, so the deployed version is unaffected.

## Defend this
> "Why are you on an old MongoDB?"

Not a preference — the local container runtime's kernel is newer than MongoDB 8
supports, so MongoDB refuses to boot. The symptom is a startup crash, not data
corruption, so pinning 7.0 is safe. Production uses Atlas and is unaffected.
