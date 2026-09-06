# Inspecting MongoDB and Redis

Both services publish their ports to your Mac (`docker-compose.yml`), so host tools
connect directly — no `docker exec` needed.

| Service | From your Mac | From inside the API container |
|---|---|---|
| MongoDB | `mongodb://localhost:27017` | `mongodb://mongo:27017` |
| Redis | `redis://localhost:6379` | `redis://redis:6379` |

Different hostnames, same servers. Inside a container `localhost` means *that
container*, so service names are required there.

---

## MongoDB — `mongosh`

```bash
mongosh mongodb://localhost:27017/arcade_arena
```

Inside the shell:

```javascript
show dbs                       // all databases
show collections               // collections in the current db
db.smoke.find()                // read everything in a collection
db.smoke.find().pretty()
db.smoke.countDocuments()
db.smoke.findOne({ hello: "phase1" })

db.smoke.insertOne({ a: 1 })
db.smoke.updateOne({ a: 1 }, { $set: { b: 2 } })
db.smoke.deleteOne({ a: 1 })

db.smoke.getIndexes()          // indexes (this becomes important in Phase 2)
db.smoke.find({ a: 1 }).explain("executionStats")   // did it use an index?

use arcade_arena               // switch database
db.dropDatabase()              // wipe it and start over
```

One-liner without entering the shell:

```bash
mongosh mongodb://localhost:27017/arcade_arena --quiet --eval 'db.smoke.countDocuments()'
```

`explain("executionStats")` is worth learning early. Look at `totalDocsExamined` —
if it is much larger than `nReturned`, the query is scanning instead of using an index.

---

## Redis — `redis-cli`

```bash
redis-cli -u redis://localhost:6379
```

Inside:

```
PING                  # -> PONG
DBSIZE                # number of keys
KEYS *                # every key. Fine locally, NEVER in production (it blocks)
SCAN 0 COUNT 100      # the safe, incremental alternative to KEYS
TYPE <key>            # string / hash / zset / list / set
TTL <key>             # seconds until expiry, -1 = no expiry
DEL <key>
FLUSHDB               # wipe this database

GET <key>             # strings
HGETALL <key>         # hashes
ZREVRANGE <key> 0 -1 WITHSCORES   # sorted sets, high to low
INFO keyspace
MONITOR               # live stream of every command — great for learning, Ctrl-C to exit
```

`MONITOR` in a second terminal while hitting the API is the fastest way to see
exactly what the app does to Redis.

### Why Redis is in this project — try it

```bash
redis-cli -u redis://localhost:6379
```

```
ZADD lb:demo 4200 alice 3100 bob 9800 carol 1500 dave 7600 erin
ZREVRANGE lb:demo 0 2 WITHSCORES     # top 3
ZREVRANK  lb:demo bob                # bob's rank, 0-indexed

ZADD lb:demo GT CH 2000 bob          # worse score — GT keeps his best
ZSCORE lb:demo bob                   # still 3100
ZADD lb:demo GT CH 8500 bob          # better score — accepted
ZREVRANK lb:demo bob                 # now rank 1
```

`ZREVRANK` answers "what rank is this player?" in O(log N) no matter how many
players exist. The equivalent in MongoDB is counting every document with a higher
score. That single operation is the reason Redis is in this architecture, and `GT`
is why a player's personal best survives a worse replay.

Clean up: `DEL lb:demo`

---

## GUI clients

Neither is required, but both make browsing far easier than a terminal:

```bash
brew install --cask mongodb-compass
brew install --cask redisinsight
```

Connect them to `mongodb://localhost:27017` and `redis://localhost:6379`.

**OrbStack's own UI** is already installed — run `orb` or open OrbStack.app to see
containers, logs, resource usage, and shell into anything.

---

## Container-side access

If host tools are ever unavailable, run the client inside the container:

```bash
docker compose exec mongo mongosh arcade_arena
docker compose exec redis redis-cli
docker compose logs -f api        # follow API logs
docker compose exec api sh        # shell into the API container
```

---

## Resetting

```bash
docker compose down          # stop, KEEP data (named volumes survive)
docker compose down -v       # stop and DELETE all data
docker compose up -d         # start again
```

`-v` is the difference between pausing and wiping. Data lives in the `mongo-data`
and `redis-data` volumes, not in the containers.
