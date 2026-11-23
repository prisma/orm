# Checklist — prisma/prisma client functional (suites 0–l)

Source: prisma/prisma@a6d01554528e016bea1467a072776b0e2b94dcba — packages/client/tests/functional/

Protocol: each line is one source test. `[ ]` = not yet dispositioned. The Opus reviewer sub-agent checks `[x]` ONLY when satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes.

### packages/client/tests/functional/0-legacy-ports/aggregate-raw/tests.ts

- [x] `group` — aggregateRaw with $group/$sort pipeline returns grouped age counts [providers: mongodb-only] → ports/prisma/functional/legacy-aggregate-raw/legacy-aggregate-raw.test.ts
- [x] `match` — aggregateRaw with $match/$project pipeline filters and projects fields [providers: mongodb-only] → ports/prisma/functional/legacy-aggregate-raw/legacy-aggregate-raw.test.ts

### packages/client/tests/functional/0-legacy-ports/aggregations/tests.ts

- [x] `min` — aggregate _min of age [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `max` — aggregate _max of age [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `sum` — aggregate _sum of age [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `count inline boolean` — aggregate _count with boolean true [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `count with _all` — aggregate _count with _all: true [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `avg` — aggregate _avg of age [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `multiple aggregations` — aggregate combining _min/_max/_sum/_count/_avg [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `multiple aggregations with where` — combined aggregations with a where filter [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `invalid min` — aggregate _min on non-existent field rejects with error snapshot [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `invalid max` — aggregate _max on non-existent field rejects with error snapshot [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `invalid sum` — aggregate _sum on non-numeric field rejects with error snapshot [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `invalid count` — aggregate _count on non-existent field rejects with error snapshot [providers: all] → test.fails: ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts
- [x] `invalid avg` — aggregate _avg on non-numeric field rejects with error snapshot [providers: all] → ports/prisma/functional/legacy-aggregations/legacy-aggregations.test.ts

### packages/client/tests/functional/0-legacy-ports/atomic-increment-decrement/tests.ts

- [x] `atomic increment` — update with increment on credit and age [providers: all] → non-ported
- [x] `atomic decrement` — update with decrement on credit and age [providers: all] → non-ported
- [x] `atomic increment with negative value` — increment by negative values decrements [providers: all] → non-ported
- [x] `atomic decrement with negative` — decrement by negative values increments [providers: all] → non-ported

### packages/client/tests/functional/0-legacy-ports/batch-find-unique/tests.ts

- [x] `findUnique batching` — concurrent findUnique calls compact into one batched query; asserts per-provider SQL snapshot and results [providers: all] → non-ported

### packages/client/tests/functional/0-legacy-ports/execute-raw/tests.ts

- [ ] `update via executeRawUnsafe` — $executeRawUnsafe UPDATE returns affected count [providers: exclude:mongodb] → non-ported (not yet ported)
- [ ] `update via queryRawUnsafe with values` — $executeRawUnsafe with positional params returns affected count [providers: exclude:mongodb] → non-ported (not yet ported)
- [ ] `update via executeRaw` — tagged-template $executeRaw UPDATE returns affected count [providers: exclude:mongodb] → non-ported (not yet ported)
- [ ] `update via executeRaw using Prisma.join` — $executeRaw with Prisma.join in IN clause [providers: exclude:mongodb] → non-ported (not yet ported)
- [ ] `update via executeRaw using Prisma.join and Prisma.sql` — $executeRaw(Prisma.sql`...`) with Prisma.join [providers: exclude:mongodb] → non-ported (not yet ported)

### packages/client/tests/functional/0-legacy-ports/find-raw/tests.ts

- [x] `all` — findRaw with empty query returns all documents [providers: mongodb-only] → non-ported
- [x] `filtered` — findRaw with filter returns matching documents [providers: mongodb-only] → non-ported
- [x] `projection` — findRaw with projection option excludes _id [providers: mongodb-only] → non-ported

### packages/client/tests/functional/0-legacy-ports/json/tests.ts

- [x] `create required json` — create resource with nested required JSON value [providers: exclude:sqlserver] → ports/prisma/functional/legacy-json/legacy-json.test.ts
- [x] `select required json` — findMany selecting requiredJson field [providers: exclude:sqlserver] → ports/prisma/functional/legacy-json/legacy-json.test.ts
- [x] `select required json with where path` — filter by JSON path equals (mysql/sqlite string path, postgres/cockroach array path) (testIf: mysql/postgresql/cockroachdb/sqlite only) [providers: exclude:sqlserver] → non-ported
- [x] `select required json with where equals` — filter JSON by whole-value equals [providers: exclude:sqlserver] → ports/prisma/functional/legacy-json/legacy-json.test.ts
- [x] `select required json with where not equals` — filter JSON by not-equals returns none [providers: exclude:sqlserver] → ports/prisma/functional/legacy-json/legacy-json.test.ts
- [x] `update required json with where equals` — update requiredJson to empty object [providers: exclude:sqlserver] → ports/prisma/functional/legacy-json/legacy-json.test.ts

### packages/client/tests/functional/0-legacy-ports/malformed-id/tests.ts

- [x] `should throw Malformed ObjectID error: in 2 different fields` — create with invalid id and ids rejects with error snapshot [providers: mongodb-only] → non-ported
- [x] `should throw Malformed ObjectID error for: _id` — create with invalid ids array element rejects [providers: mongodb-only] → ports/prisma/functional/legacy-malformed-id/legacy-malformed-id.test.ts
- [x] `should throw Malformed ObjectID error for: ids String[] @db.ObjectId` — create with invalid id rejects [providers: mongodb-only] → non-ported

### packages/client/tests/functional/0-legacy-ports/optional-relation-filters/tests.ts

- [x] `filter existing optional relation with \`isNot: null\`` — findMany where relation isNot null (testIf: non-mongodb) [providers: all] → ports/prisma/functional/legacy-optional-relation-filters/legacy-optional-relation-filters.test.ts
- [x] `filter empty optional relation with ` — findMany where relation is null (testIf: non-mongodb) [providers: all] → ports/prisma/functional/legacy-optional-relation-filters/legacy-optional-relation-filters.test.ts
- [x] `filter empty optional relation with \`null\`` — findMany where relation equals null (testIf: non-mongodb) [providers: all] → ports/prisma/functional/legacy-optional-relation-filters/legacy-optional-relation-filters.test.ts
- [x] `filter empty optional relation` — findMany where relation null returns single user (testIf: non-mongodb) [providers: all] → ports/prisma/functional/legacy-optional-relation-filters/legacy-optional-relation-filters.test.ts
- [x] `filter existing optional relation with empty field` — findMany where relation field is null (testIf: non-mongodb) [providers: all] → ports/prisma/functional/legacy-optional-relation-filters/legacy-optional-relation-filters.test.ts
- [x] `filter existing optional relation with existing field` — findMany where relation field not null (testIf: non-mongodb) [providers: all] → ports/prisma/functional/legacy-optional-relation-filters/legacy-optional-relation-filters.test.ts

### packages/client/tests/functional/0-legacy-ports/query-raw/tests.ts

- [ ] `select 1 via queryRaw` — tagged $queryRaw SELECT 1, per-provider/driver result [providers: exclude:mongodb] → non-ported (not yet ported)
- [x] `select 1 via queryRawUnsafe` — $queryRawUnsafe SELECT 1 as number, per-provider result [providers: exclude:mongodb] → non-ported
- [ ] `select with alias via queryRaw` — tagged $queryRaw SELECT 1 as number [providers: exclude:mongodb] → non-ported (not yet ported)
- [x] `select values via queryRawUnsafe` — $queryRawUnsafe SELECT 1, per-provider/driver result [providers: exclude:mongodb] → non-ported
- [x] `select * via queryRawUnsafe` — $queryRawUnsafe SELECT * with inline range filter [providers: exclude:mongodb] → non-ported
- [x] `select * via queryRawUnsafe with values` — $queryRawUnsafe SELECT * with positional params [providers: exclude:mongodb] → non-ported
- [ ] `select * via queryRaw` — tagged $queryRaw SELECT * with range filter [providers: exclude:mongodb] → non-ported (not yet ported)
- [ ] `select fields via queryRaw using Prisma.join` — $queryRaw with Prisma.join for columns and IN values [providers: exclude:mongodb] → non-ported (needs re-examination)
- [ ] `select fields via queryRaw using Prisma.join and Prisma.sql` — $queryRaw(Prisma.sql`...`) with Prisma.join [providers: exclude:mongodb] → non-ported (needs re-examination)

### packages/client/tests/functional/0-legacy-ports/run-command-raw/tests.ts

- [x] `aggregate` — $runCommandRaw aggregate command returns cursor firstBatch [providers: mongodb-only] → non-ported

### packages/client/tests/functional/accelerate-bad-url-errors/tests.ts

- [x] `url starts with invalid://` — data proxy rejects non-prisma:// URL with protocol error (testIf: dataProxy only) [providers: all] → non-ported
- [x] `url starts with prisma:// but is invalid` — data proxy rejects prisma:// without valid API key (testIf: dataProxy only) [providers: all] → non-ported
- [x] `url starts with prisma:// with nothing else` — data proxy rejects bare prisma:// with API key error (testIf: dataProxy only) [providers: all] → non-ported

### packages/client/tests/functional/batch-transaction/tests.ts

- [x] `Batch transactions should behave correctly > runs a batch that requires serial execution` — $transaction array with create then findUnique resolves in order [providers: all] → non-ported
- [x] `Batch transactions should behave correctly > reverts a batch that fails half-way through` — $transaction rolls back on unique-constraint failure [providers: all] → non-ported
- [x] `Batch transactions should behave correctly > commits a successful batch` — $transaction of three creates commits all [providers: all] → non-ported

### packages/client/tests/functional/batch-transaction-isolation-level/tests.ts

- [x] `ReadUncommitted` — batch $transaction emits SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED (testIf: non-JS-drivers and non-cockroach) [providers: postgres,mysql,sqlserver,cockroachdb] → non-ported
- [x] `ReadCommitted` — batch $transaction emits SET TRANSACTION ISOLATION LEVEL READ COMMITTED (testIf: non-JS-drivers) [providers: postgres,mysql,sqlserver,cockroachdb] → non-ported
- [x] `RepeatableRead` — batch $transaction emits SET TRANSACTION ISOLATION LEVEL REPEATABLE READ (testIf: non-JS-drivers and non-cockroach) [providers: postgres,mysql,sqlserver,cockroachdb] → non-ported
- [x] `Serializable` — batch $transaction emits SET TRANSACTION ISOLATION LEVEL SERIALIZABLE (testIf: non-JS-drivers) [providers: postgres,mysql,sqlserver,cockroachdb] → non-ported
- [x] `default value generates no SET TRANSACTION ISOLATION LEVEL statements (unless running MSSQL)` — no isolation-level SQL emitted by default except MSSQL [providers: postgres,mysql,sqlserver,cockroachdb] → non-ported
- [x] `invalid level generates run- and compile- time error` — invalid isolationLevel rejects with error snapshot [providers: postgres,mysql,sqlserver,cockroachdb] → non-ported

### packages/client/tests/functional/batching/tests.ts

- [x] `batches findUnique` — concurrent findUnique compacts to single query [providers: all] → non-ported
- [x] `batches findUnique (issue 27363)` — concurrent findUnique with nested posts select batches correctly [providers: all] → non-ported
- [x] `batches findUnique with re-ordered selection` — findUnique with differently-ordered selects still batches [providers: all] → non-ported
- [x] `batches repeated findUnique for the same row correctly` — duplicate findUnique for same id batches to one query [providers: all] → non-ported
- [x] `batches findUniqueOrThrow` — concurrent findUniqueOrThrow batches to one query [providers: all] → non-ported
- [x] `batches findUniqueOrThrow with an error` — batched findUniqueOrThrow returns per-item settled results with one rejection [providers: all] → non-ported
- [x] `does not batch different models` — findUnique on different models not batched [providers: all] → non-ported
- [x] `does not batch different where` — findUnique with different where fields not batched [providers: all] → non-ported
- [x] `does not batch different select` — findUnique with different selects not batched [providers: all] → non-ported
- [x] `interactive transactions: batches findUnique for a single model` — findUnique+relation calls inside interactive tx sent as one engine batch (testIf: postgresql only) [providers: all] → non-ported
- [x] `interactive transactions: batches findUnique for multiple models` — findUnique posts and comments inside interactive tx sent as two engine batches (testIf: postgresql only) [providers: all] → non-ported

### packages/client/tests/functional/batching-bigint/tests.ts

- [x] `findUnique bigint with Promise.all` — batched findUnique by bigint id via Promise.all [providers: all] → ports/prisma/functional/batching-bigint/batching-bigint.test.ts
- [x] `findUnique bigint with $transaction([...])` — batched findUnique by bigint id via $transaction array [providers: all] → non-ported
- [x] `findFirst bigint with Promise.all` — batched findFirst by bigint via Promise.all [providers: all] → ports/prisma/functional/batching-bigint/batching-bigint.test.ts
- [x] `findFirst bigint with $transaction([...])` — batched findFirst by bigint via $transaction array [providers: all] → non-ported

### packages/client/tests/functional/batching-bytes/tests.ts

- [x] `findUnique bytes with Promise.all` — batched findUnique by bytes id via Promise.all [providers: exclude:sqlserver] → ports/prisma/functional/batching-bytes/batching-bytes.test.ts
- [x] `findUnique bytes with $transaction([...])` — batched findUnique by bytes id via $transaction array [providers: exclude:sqlserver] → non-ported
- [x] `findFirst bytes with Promise.all` — batched findFirst by bytes via Promise.all [providers: exclude:sqlserver] → ports/prisma/functional/batching-bytes/batching-bytes.test.ts
- [x] `findFirst bytes with $transaction([...])` — batched findFirst by bytes via $transaction array [providers: exclude:sqlserver] → non-ported

### packages/client/tests/functional/batching-compound/tests.ts

- [x] `batches findUnique with a compound ID` — concurrent findUnique by compound key compacts to one query [providers: all] → non-ported
- [x] `batches repeated findUnique with a compound ID with same row correctly` — duplicate compound-key findUnique batches to one query [providers: all] → non-ported
- [x] `batches findUniqueOrThrow with a compound ID with an error` — batched compound-key findUniqueOrThrow returns settled results with one rejection [providers: all] → non-ported

### packages/client/tests/functional/batching-relation/tests.ts

- [x] `batches findUnique that includes a relation` — concurrent findUnique with include batches (2 queries unless relationJoins) [providers: all] → non-ported
- [x] `does not batch findFirst that includes a relation` — concurrent findFirst with include not batched (4 queries unless relationJoins) [providers: all] → non-ported
- [x] `batches findUniqueOrThrow that includes a relation with an error` — batched findUniqueOrThrow with include returns settled results with one rejection [providers: all] → non-ported

### packages/client/tests/functional/blog-update/tests.ts

- [x] `should create a user and update that field on that user` — create then update user email [providers: all] → ports/prisma/functional/blog-update/blog-update.test.ts
- [x] `should create a user and post and connect them together` — update user to connect an existing post [providers: all] → ports/prisma/functional/blog-update/blog-update.test.ts
- [x] `should create a user and post and disconnect them` — update user to disconnect a created post [providers: all] → ports/prisma/functional/blog-update/blog-update.test.ts
- [x] `should create a user with posts and a profile and update itself and nested connections setting fields to null` — nested update setting many fields/relations to null (skipTestIf: postgres+driverAdapter+relationJoins) [providers: all] → ports/prisma/functional/blog-update/blog-update.test.ts

### packages/client/tests/functional/bytes-upsert/tests.ts

- [x] `bytes upsert should work correctly` — repeated upsert by bytes id is idempotent and record persists [providers: exclude:sqlserver] → test.fails: ports/prisma/functional/bytes-upsert/bytes-upsert.test.ts

### packages/client/tests/functional/chunking-query/tests.ts

- [x] `issues #8832 / #9326 success cases > should succeed when "in" has MAX ids` — findMany with in-filter at MAX bind values (describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `issues #8832 / #9326 success cases > should succeed when "include" involves MAX records` — findMany include at MAX records (describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `issues #8832 / #9326 success cases > should succeed when "in" has EXCESS ids` — findMany in-filter above bind limit chunks successfully (describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `issues #8832 / #9326 success cases > should succeed when "include" involves EXCESS records` — findMany include above bind limit succeeds (describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `issues #8832 / #9326 success cases > should succeed when "in" has EXCESS ids and a "skip" filter` — in-filter above bind limit with skip (test.skip; describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `issues #8832 / #9326 success cases > should succeed when raw query has MAX ids` — raw query with MAX ids succeeds (describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `issues #8832 / #9326 success cases > should fail when raw query has EXCESS ids` — raw query above bind limit throws (testIf: non-JS-drivers and non-sqlite; describeIf: not relationJoins) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported
- [x] `chunking logic does not trigger with 2 IN filters > Selecting MAX ids at once in two inclusive disjunct filters succeeds` — two OR'd in-filters at MAX total succeed (describeIf: non-sqlite) [providers: postgres,cockroachdb,mysql,sqlite] → ports/prisma/functional/chunking-query/chunking-query.test.ts
- [x] `chunking logic does not trigger with 2 IN filters > Selecting EXCESS ids at once in two inclusive disjunct filters results in error` — two OR'd in-filters above limit throw (provider/adapter-specific messages) (describeIf: non-sqlite) [providers: postgres,cockroachdb,mysql,sqlite] → non-ported

### packages/client/tests/functional/composites/list/aggregate.ts

- [x] `simple` — aggregate with _count and orderBy by contents _count returns { _count: 1 } [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/list/count.ts

- [x] `simple` — count with orderBy by contents _count returns 1 [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/list/create.ts

- [x] `set` — create with contents set as list returns snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-create/composites-list-create.test.ts
- [x] `set shorthand` — create with contents shorthand (no set) returns snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-create/composites-list-create.test.ts
- [x] `set null` — create with contents.set null rejects with `set` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-create/composites-list-create.test.ts
- [x] `set null shorthand` — create with contents null rejects with `contents` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-create/composites-list-create.test.ts
- [x] `set nested list` — create with nested upvotes list returns snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-create/composites-list-create.test.ts

### packages/client/tests/functional/composites/list/createMany.ts

- [x] `set` — createMany with contents set returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-createMany/composites-list-createMany.test.ts
- [x] `set shorthand` — createMany with contents shorthand returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-createMany/composites-list-createMany.test.ts
- [x] `set null` — createMany with contents.set null rejects with `set` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-createMany/composites-list-createMany.test.ts
- [x] `set null shorthand` — createMany with contents null rejects with `contents` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-createMany/composites-list-createMany.test.ts
- [x] `set nested list` — createMany with nested upvotes list returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-createMany/composites-list-createMany.test.ts

### packages/client/tests/functional/composites/list/delete.ts

- [x] `delete` — delete by id then count is 0 [providers: mongodb-only] → test/ports/prisma/functional/composites-list-delete/composites-list-delete.test.ts

### packages/client/tests/functional/composites/list/deleteMany.ts

- [x] `delete` — deleteMany by id then count is 0 [providers: mongodb-only] → test/ports/prisma/functional/composites-list-deleteMany/composites-list-deleteMany.test.ts

### packages/client/tests/functional/composites/list/findFirst.ts

- [x] `simple` — findFirst by id returns full snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-findFirst/composites-list-findFirst.test.ts
- [x] `select` — findFirst with nested select of contents.text [providers: mongodb-only] → non-ported
- [x] `orderBy` — findFirst with orderBy by contents _count [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/list/findMany.ts

- [x] `simple` — findMany by id returns one record snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-findMany/composites-list-findMany.test.ts
- [x] `select` — findMany with nested select of contents.text [providers: mongodb-only] → non-ported
- [x] `orderBy` — findMany ordered by contents _count desc [providers: mongodb-only] → non-ported
- [x] `filter equals` — findMany filtering contents equals whole list [providers: mongodb-only] → test/ports/prisma/functional/composites-list-findMany/composites-list-findMany.test.ts
- [x] `filter equals shorthand` — findMany filtering contents equals shorthand [providers: mongodb-only] → test/ports/prisma/functional/composites-list-findMany/composites-list-findMany.test.ts
- [x] `filter every` — findMany with contents every upvotes every vote true [providers: mongodb-only] → non-ported
- [x] `filter some` — findMany with contents some upvotes some vote false [providers: mongodb-only] → non-ported
- [x] `filter empty` — findMany with contents some upvotes isEmpty [providers: mongodb-only] → non-ported
- [x] `filter none` — findMany with contents none upvotes isEmpty [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/list/update.ts

- [x] `set` — update contents set replaces list [providers: mongodb-only] → test/ports/prisma/functional/composites-list-update/composites-list-update.test.ts
- [x] `set shorthand` — update contents shorthand replaces list [providers: mongodb-only] → test/ports/prisma/functional/composites-list-update/composites-list-update.test.ts
- [x] `set null` — update contents.set null rejects with `set` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-update/composites-list-update.test.ts
- [x] `set null shorthand` — update contents null rejects with `contents` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-update/composites-list-update.test.ts
- [x] `set nested list` — update contents set with nested upvotes list [providers: mongodb-only] → test/ports/prisma/functional/composites-list-update/composites-list-update.test.ts
- [x] `push` — update contents push appends item [providers: mongodb-only] → test/ports/prisma/functional/composites-list-update/composites-list-update.test.ts
- [x] `updateMany` — update contents updateMany with where filter [providers: mongodb-only] → non-ported
- [x] `deleteMany` — update contents deleteMany with where filter [providers: mongodb-only] → non-ported
- [x] `unset` — update contents unset rejects with Unknown argument `unset` [providers: mongodb-only] → non-ported
- [x] `upsert set` — update contents upsert rejects with Unknown argument `upsert` [providers: mongodb-only] → non-ported
- [x] `upsert update` — update contents upsert (update variant) rejects with Unknown argument `upsert` [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/list/updateMany.ts

- [x] `set` — updateMany contents set returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-updateMany/composites-list-updateMany.test.ts
- [x] `set shorthand` — updateMany contents shorthand returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-updateMany/composites-list-updateMany.test.ts
- [x] `set null` — updateMany contents.set null rejects with `set` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-updateMany/composites-list-updateMany.test.ts
- [x] `set null shorthand` — updateMany contents null rejects with `contents` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-updateMany/composites-list-updateMany.test.ts
- [x] `set nested list` — updateMany contents set nested upvotes returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-updateMany/composites-list-updateMany.test.ts
- [x] `push` — updateMany contents push returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-list-updateMany/composites-list-updateMany.test.ts
- [x] `updateMany` — updateMany contents updateMany returns { count: 1 } [providers: mongodb-only] → non-ported
- [x] `deleteMany` — updateMany contents deleteMany returns { count: 1 } [providers: mongodb-only] → non-ported
- [x] `unset` — updateMany contents unset rejects with Unknown argument `unset` [providers: mongodb-only] → non-ported
- [x] `upsert set` — updateMany contents upsert rejects with Unknown argument `upsert` [providers: mongodb-only] → non-ported
- [x] `upsert update` — updateMany contents upsert (update variant) rejects with Unknown argument `upsert` [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/list/upsert-create.ts

- [x] `set` — upsert (create path) contents set returns snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-create/composites-list-upsert-create.test.ts
- [x] `set shorthand` — upsert (create path) contents shorthand returns snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-create/composites-list-upsert-create.test.ts
- [x] `set null` — upsert (create path) contents.set null rejects with `set` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-upsert-create/composites-list-upsert-create.test.ts
- [x] `set null shorthand` — upsert (create path) contents null rejects with `contents` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-upsert-create/composites-list-upsert-create.test.ts
- [x] `set nested list` — upsert (create path) contents set nested upvotes returns snapshot [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-create/composites-list-upsert-create.test.ts

### packages/client/tests/functional/composites/list/upsert-update.ts

- [x] `set` — upsert (update path) contents set replaces list [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-update/composites-list-upsert-update.test.ts
- [x] `set shorthand` — upsert (update path) contents shorthand replaces list [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-update/composites-list-upsert-update.test.ts
- [x] `set null` — upsert (update path) contents.set null rejects with `set` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-upsert-update/composites-list-upsert-update.test.ts
- [x] `set null shorthand` — upsert (update path) contents null rejects with `contents` must not be null [providers: mongodb-only] → test.fails: test/ports/prisma/functional/composites-list-upsert-update/composites-list-upsert-update.test.ts
- [x] `set nested list` — upsert (update path) contents set nested upvotes [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-update/composites-list-upsert-update.test.ts
- [x] `push` — upsert (update path) contents push appends item [providers: mongodb-only] → test/ports/prisma/functional/composites-list-upsert-update/composites-list-upsert-update.test.ts
- [x] `updateMany` — upsert (update path) contents updateMany with where [providers: mongodb-only] → non-ported
- [x] `deleteMany` — upsert (update path) contents deleteMany with where [providers: mongodb-only] → non-ported
- [x] `unset` — upsert (update path) contents unset rejects with Unknown argument `unset` [providers: mongodb-only] → non-ported
- [x] `upsert set` — upsert (update path) contents upsert rejects with Unknown argument `upsert` [providers: mongodb-only] → non-ported
- [x] `upsert update` — upsert (update path) contents upsert (update variant) rejects with Unknown argument `upsert` [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/object/aggregate.ts

- [x] `aggregate` — aggregate with _count and orderBy by content.upvotes _count returns { _count: 1 } [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-aggregate/composites-object-aggregate.md): no read-side aggregate() and no nested-composite _count orderBy in mongo ORM

### packages/client/tests/functional/composites/object/count.ts

- [x] `count` — count with orderBy by content.upvotes _count returns 1 [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-count/composites-object-count.md): no read-side count() and no nested-composite _count orderBy in mongo ORM

### packages/client/tests/functional/composites/object/create.ts

- [x] `set` — create with content set returns snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-create/composites-object-create.test.ts
- [x] `set shorthand` — create with content shorthand returns snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-create/composites-object-create.test.ts
- [x] `set null` — create content.set null: required rejects, optional returns null (branches on contentProperty) [providers: mongodb-only] → ports/prisma/functional/composites-object-create/composites-object-create.test.ts (optional variant ported; required-variant runtime throw is enforced at compile time — content is non-nullable, so `null` is a type error)
- [x] `set null shorthand` — create content null: required rejects, optional returns null (branches on contentProperty) [providers: mongodb-only] → ports/prisma/functional/composites-object-create/composites-object-create.test.ts (optional variant ported; required-variant runtime throw is enforced at compile time)
- [x] `set nested list` — create with content set nested upvotes list [providers: mongodb-only] → ports/prisma/functional/composites-object-create/composites-object-create.test.ts

### packages/client/tests/functional/composites/object/createMany.ts

- [x] `set` — createMany with content set returns { count: 1 } [providers: mongodb-only] → ports/prisma/functional/composites-object-createMany/composites-object-createMany.test.ts (createCount → 1)
- [x] `set shorthand` — createMany with content shorthand returns { count: 1 } [providers: mongodb-only] → ports/prisma/functional/composites-object-createMany/composites-object-createMany.test.ts
- [x] `set null` — createMany content.set null: required rejects, optional { count: 1 } (branches on contentProperty) [providers: mongodb-only] → ports/prisma/functional/composites-object-createMany/composites-object-createMany.test.ts (optional variant ported passing; required-variant is it.fails — type-rejects null but mongo does not throw at runtime, failing.md)
- [x] `set null shorthand` — createMany content null: required rejects, optional { count: 1 } (branches on contentProperty) [providers: mongodb-only] → ports/prisma/functional/composites-object-createMany/composites-object-createMany.test.ts (optional variant ported passing; required-variant is it.fails, failing.md)
- [x] `set nested list` — createMany with content set nested upvotes returns { count: 1 } [providers: mongodb-only] → ports/prisma/functional/composites-object-createMany/composites-object-createMany.test.ts

### packages/client/tests/functional/composites/object/delete.ts

- [x] `delete` — delete by id then count is 0 [providers: mongodb-only] → ports/prisma/functional/composites-object-delete/composites-object-delete.test.ts (post-condition verified via .first() === null; prisma-next has no read-side count())

### packages/client/tests/functional/composites/object/deleteMany.ts

- [x] `delete` — deleteMany by id then count is 0 [providers: mongodb-only] → ports/prisma/functional/composites-object-deleteMany/composites-object-deleteMany.test.ts (.deleteCount() === 1; absence verified via .first() === null)

### packages/client/tests/functional/composites/object/findFirst.ts

- [x] `simple` — findFirst by id returns full snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-findFirst/composites-object-findFirst.test.ts (country seeded null to match upstream's omitted→null read)
- [x] `select` — findFirst with nested select of content.text [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findFirst/composites-object-findFirst.md): mongo ORM select() is top-level only
- [x] `orderBy` — findFirst with orderBy by content.upvotes _count [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findFirst/composites-object-findFirst.md): no nested-composite _count orderBy
- [x] `filter isSet` — findFirst with country isSet true returns null [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findFirst/composites-object-findFirst.md): no isSet operator in mongo where

### packages/client/tests/functional/composites/object/findMany.ts

- [x] `simple` — findMany by id returns one record snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-findMany/composites-object-findMany.test.ts (country seeded null to match upstream's omitted→null read)
- [x] `select` — findMany with nested select of content.text [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findMany/composites-object-findMany.md): mongo ORM select() is top-level only
- [x] `orderBy` — findMany ordered by content.upvotes _count desc [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findMany/composites-object-findMany.md): no nested-composite _count orderBy
- [x] `filter equals` — findMany filtering content equals whole object [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findMany/composites-object-findMany.md): no { equals } operator wrapper (bare-value shorthand is the supported mechanism, ported below)
- [x] `filter equals shorthand` — findMany filtering content equals shorthand [providers: mongodb-only] → ports/prisma/functional/composites-object-findMany/composites-object-findMany.test.ts (where({ content }) compiles to $eq on the embedded document)
- [x] `filter is` — findMany with content is (OR of text) [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findMany/composites-object-findMany.md): no `is` composite-relation operator
- [x] `filter isNot` — findMany with content isNot text [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findMany/composites-object-findMany.md): no `isNot` composite-relation operator
- [x] `filter isSet` — findMany with country isSet true [providers: mongodb-only] → non-ported (ports/prisma/non-ported/functional/composites-object-findMany/composites-object-findMany.md): no isSet operator in mongo where

### packages/client/tests/functional/composites/object/update.ts

- [x] `set` — update content set replaces object [providers: mongodb-only] → test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts
- [x] `set shorthand` — update content shorthand replaces object [providers: mongodb-only] → test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts
- [x] `set null` — update content.set null: optional returns null, required rejects (branches on contentProperty) [providers: mongodb-only] → test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts (optional passing; required variant is test.fails: test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts)
- [x] `set null shorthand` — update content null: optional returns null, required rejects (branches on contentProperty) [providers: mongodb-only] → test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts (optional passing; required variant is test.fails: test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts)
- [x] `set nested list` — update content set with nested upvotes list [providers: mongodb-only] → test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts
- [x] `optional > update` — describeIf optional: update content via upsert.update text [providers: mongodb-only] → non-ported
- [x] `optional > update push nested list` — describeIf optional: upsert.update pushes upvote [providers: mongodb-only] → non-ported
- [x] `optional > update set nested list` — describeIf optional: upsert.update sets upvotes [providers: mongodb-only] → non-ported
- [x] `required > update` — describeIf required: update content.update text [providers: mongodb-only] → non-ported
- [x] `required > update push nested list` — describeIf required: content.update pushes upvote [providers: mongodb-only] → non-ported
- [x] `required > update set nested list` — describeIf required: content.update sets upvotes [providers: mongodb-only] → non-ported
- [x] `unset` — update content unset: optional returns null, required rejects Unknown argument `unset` [providers: mongodb-only] → optional: test.fails: test/ports/prisma/functional/composites-object-update/composites-object-update.test.ts ($unset drops key, not null); required: non-ported
- [x] `upsert set` — update content upsert.set: optional returns snapshot, required rejects Unknown argument `upsert` [providers: mongodb-only] → non-ported
- [x] `upsert update` — update content upsert.update: optional returns snapshot, required rejects Unknown argument `upsert` [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/object/updateMany.ts

- [x] `set` — updateMany content set returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts
- [x] `set shorthand` — updateMany content shorthand returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts
- [x] `set null` — updateMany content.set null: optional { count: 1 }, required rejects (branches on contentProperty) [providers: mongodb-only] → test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts (optional passing; required variant is test.fails: test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts)
- [x] `set null shorthand` — updateMany content null: optional { count: 1 }, required rejects (branches on contentProperty) [providers: mongodb-only] → test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts (optional passing; required variant is test.fails: test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts)
- [x] `set nested list` — updateMany content set nested upvotes returns { count: 1 } [providers: mongodb-only] → test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts
- [x] `optional > update` — describeIf optional: updateMany via upsert.update returns { count: 1 } [providers: mongodb-only] → non-ported
- [x] `optional > update push nested list` — describeIf optional: upsert.update pushes upvote { count: 1 } [providers: mongodb-only] → non-ported
- [x] `optional > update set nested list` — describeIf optional: upsert.update sets upvotes { count: 1 } [providers: mongodb-only] → non-ported
- [x] `required > update` — describeIf required: content.update text returns { count: 1 } [providers: mongodb-only] → non-ported
- [x] `required > update push nested list` — describeIf required: content.update pushes upvote { count: 1 } [providers: mongodb-only] → non-ported
- [x] `required > update set nested list` — describeIf required: content.update sets upvotes { count: 1 } [providers: mongodb-only] → non-ported
- [x] `unset` — updateMany content unset: optional { count: 1 }, required rejects Unknown argument `unset` [providers: mongodb-only] → optional: test/ports/prisma/functional/composites-object-updateMany/composites-object-updateMany.test.ts (updateAndCount returns count regardless); required: non-ported
- [x] `upsert set` — updateMany content upsert.set: optional { count: 1 }, required rejects Unknown argument `upsert` [providers: mongodb-only] → non-ported
- [x] `upsert update` — updateMany content upsert.update: optional { count: 1 }, required rejects Unknown argument `upsert` [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/object/upsert-create.ts

- [x] `set` — upsert (create path) content set returns snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-upsert-create/composites-object-upsert-create.test.ts (toMatchObject + _id instanceof ObjectId — create-port pattern)
- [x] `set shorthand` — upsert (create path) content shorthand returns snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-upsert-create/composites-object-upsert-create.test.ts
- [x] `set null` — upsert (create) content.set null: optional returns null, required rejects (branches on contentProperty) [providers: mongodb-only] → ports/prisma/functional/composites-object-upsert-create/composites-object-upsert-create.test.ts (optional variant ported passing; required-variant is it.fails — type-rejects null but mongo does not throw, failing.md)
- [x] `set null shorthand` — upsert (create) content null: optional returns null, required rejects (branches on contentProperty) [providers: mongodb-only] → ports/prisma/functional/composites-object-upsert-create/composites-object-upsert-create.test.ts (optional variant ported passing; required-variant is it.fails, failing.md)
- [x] `set nested list` — upsert (create path) content set nested upvotes returns snapshot [providers: mongodb-only] → ports/prisma/functional/composites-object-upsert-create/composites-object-upsert-create.test.ts

### packages/client/tests/functional/composites/object/upsert-update.ts

- [x] `set` — upsert (update path) content set replaces object [providers: mongodb-only] → test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts
- [x] `set shorthand` — upsert (update path) content shorthand replaces object [providers: mongodb-only] → test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts
- [x] `set null` — upsert (update) content.set null: optional returns null, required rejects (branches on contentProperty) [providers: mongodb-only] → test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts (optional passing; required variant is test.fails: test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts)
- [x] `set null shorthand` — upsert (update) content null: optional returns null, required rejects (branches on contentProperty) [providers: mongodb-only] → test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts (optional passing; required variant is test.fails: test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts)
- [x] `set nested list` — upsert (update path) content set nested upvotes [providers: mongodb-only] → test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts
- [x] `optional > update` — describeIf optional: upsert.update content via upsert.update text [providers: mongodb-only] → non-ported
- [x] `optional > update push nested list` — describeIf optional: upsert.update pushes upvote [providers: mongodb-only] → non-ported
- [x] `optional > update set nested list` — describeIf optional: upsert.update sets upvotes [providers: mongodb-only] → non-ported
- [x] `required > update` — describeIf required: content.update text [providers: mongodb-only] → non-ported
- [x] `required > update push nested list` — describeIf required: content.update pushes upvote [providers: mongodb-only] → non-ported
- [x] `required > update set nested list` — describeIf required: content.update sets upvotes [providers: mongodb-only] → non-ported
- [x] `unset` — upsert (update) content unset: optional returns null, required rejects Unknown argument `unset` [providers: mongodb-only] → optional: test.fails: test/ports/prisma/functional/composites-object-upsert-update/composites-object-upsert-update.test.ts ($unset drops key, not null); required: non-ported
- [x] `upsert set` — upsert (update) content upsert.set: optional returns snapshot, required rejects Unknown argument `upsert` [providers: mongodb-only] → non-ported
- [x] `upsert update` — upsert (update) content upsert.update: optional returns snapshot, required rejects Unknown argument `upsert` [providers: mongodb-only] → non-ported

### packages/client/tests/functional/composites/recursive/tests.ts

- [x] `can create recursive model` — test.failing: create recursive linkedList with nested next chain (expected to fail) [providers: mongodb-only] → non-ported (self-referential composite type; contract emitter stack-overflows during schema resolution — schema not emittable)

### packages/client/tests/functional/composites/selection/tests.ts

- [x] `composites are selected by default` — findFirstOrThrow selects composites by default; type + runtime checks [providers: mongodb-only] → test/ports/prisma/functional/composites-selection/composites-selection.test.ts
- [x] `composites can be selected explicitly` — findFirstOrThrow with select profile true; type + runtime checks [providers: mongodb-only] → test/ports/prisma/functional/composites-selection/composites-selection.test.ts
- [x] `composites can be selected explicitly on multiple nesting levels` — nested select of favoriteThings and name.firstName [providers: mongodb-only] → non-ported
- [x] `composites are included on default types` — expectTypeOf on User/Profile default types include composites [providers: mongodb-only] → test/ports/prisma/functional/composites-selection/composites-selection.test.ts

### packages/client/tests/functional/create-default-date/test.ts

- [x] `correctly creates a field with default date` — creating a record with no args populates a default date field as a Date [providers: sqlite,postgres,mysql,sqlserver] → ports/prisma/functional/create-default-date/create-default-date.test.ts

### packages/client/tests/functional/dataproxy-engine/version/tests.ts

- [x] `check versions on \`_engine\`` — (data-proxy only) engine exposes stubbed client/engine version and hash before and after $connect [providers: all] → non-ported

### packages/client/tests/functional/decimal/list/tests.ts

- [x] `with decimal instances` — create record with a decimal list from numeric values [providers: postgres,cockroachdb] → ports/prisma/functional/decimal-list/decimal-list.test.ts
- [x] `with numbers` — create record with a decimal list from numbers [providers: postgres,cockroachdb] → ports/prisma/functional/decimal-list/decimal-list.test.ts
- [x] `create with strings` — create record with a decimal list from string values [providers: postgres,cockroachdb] → ports/prisma/functional/decimal-list/decimal-list.test.ts

### packages/client/tests/functional/decimal/precision/tests.ts

- [x] `decimals should not lose precision when written to db` — property test (fast-check) that decimals round-trip through the db without precision loss [providers: postgres,mysql,cockroachdb,sqlserver] → ports/prisma/functional/decimal-precision/decimal-precision.test.ts

### packages/client/tests/functional/decimal/scalar/tests.ts

- [x] `possible inputs > decimal as Decimal.js instance` — findFirst matching a Decimal.js instance returns the stored decimal [providers: exclude:mongodb] → non-ported
- [x] `possible inputs > decimal as string` — findFirst matching a string value returns the stored decimal [providers: exclude:mongodb] → ports/prisma/functional/decimal-scalar/decimal-scalar.test.ts
- [x] `possible inputs > decimal as number` — findFirst with numeric gt/lt filter returns the stored decimal [providers: exclude:mongodb] → ports/prisma/functional/decimal-scalar/decimal-scalar.test.ts
- [x] `possible inputs > decimal as decimal.js-like object` — findFirst matching a decimal.js-like object returns the stored decimal [providers: exclude:mongodb] → non-ported

### packages/client/tests/functional/default-selection/tests.ts

- [x] `includes scalars` — default selection includes scalar fields (id, value, otherId) [providers: all] → ports/prisma/functional/default-selection/default-selection.test.ts
- [x] `does not include relations` — default selection excludes relation fields [providers: all] → ports/prisma/functional/default-selection/default-selection.test.ts
- [x] `includes enums` — (non-sqlite/sqlserver) default selection includes enum field [providers: all] → ports/prisma/functional/default-selection/default-selection.test.ts
- [x] `includes lists` — (postgres/cockroach/mongo) default selection includes list field [providers: all] → ports/prisma/functional/default-selection/default-selection.test.ts
- [x] `includes enum lists` — (postgres/cockroach/mongo) default selection includes enum-list field [providers: all] → ports/prisma/functional/default-selection/default-selection.test.ts
- [x] `includes composites` — (mongo only) default selection includes composite field [providers: all] → ports/prisma/functional/default-selection/default-selection.mongo.test.ts

### packages/client/tests/functional/distinct/tests.ts

- [x] `distinct on firstName` — findMany distinct on firstName returns 2 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on firstName and lastName` — findMany distinct on firstName+lastName returns 3 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on id` — findMany distinct on id returns all 4 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on id and firstName` — findMany distinct on id+firstName returns 4 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on id and lastName` — findMany distinct on id+lastName returns 4 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on firstName and id` — findMany distinct on firstName+id returns 4 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on firstName and firstName` — findMany distinct on duplicated firstName returns 2 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on id and firstName and lastName` — findMany distinct on three fields returns 4 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on id shortcut` — findMany distinct with string shortcut 'id' returns 4 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts
- [x] `distinct on id and firstName shortcut` — findMany distinct with string shortcut 'firstName' returns 2 rows [providers: all] → ports/prisma/functional/distinct/distinct.test.ts

### packages/client/tests/functional/driver-adapters/error-forwarding/tests.ts

- [x] `correctly forwards error for queryRaw` — adapter queryRaw error surfaces on findFirst [providers: sqlite,postgres,mysql] → test.fails: ports/prisma/functional/driver-adapters-error-forwarding/driver-adapters-error-forwarding.test.ts
- [x] `correctly forwards error for executeRaw` — adapter executeRaw error surfaces on $executeRaw [providers: sqlite,postgres,mysql] → non-ported
- [x] `correctly forwards error for implicit transactions` — adapter startTransaction error surfaces on nested create [providers: sqlite,postgres,mysql] → ports/prisma/functional/driver-adapters-error-forwarding/driver-adapters-error-forwarding.test.ts
- [x] `correctly forwards error for batch transactions` — adapter startTransaction error surfaces on $transaction array [providers: sqlite,postgres,mysql] → non-ported
- [x] `correctly forwards error for itx` — adapter startTransaction error surfaces on interactive $transaction [providers: sqlite,postgres,mysql] → ports/prisma/functional/driver-adapters-error-forwarding/driver-adapters-error-forwarding.test.ts

### packages/client/tests/functional/driver-adapters/team-orm-687-bytes/tests.ts

- [x] `Bytes encoding is preserved` — Bytes/Uint8Array values round-trip unchanged through create and findMany [providers: sqlite,postgres,mysql] → ports/prisma/functional/driver-adapters-team-orm-687-bytes/driver-adapters-team-orm-687-bytes.test.ts

### packages/client/tests/functional/driver-adapters/validate-active-provider/tests.ts

- [x] `@prisma/adapter-pg cannot be used with \`provider = "mysql"\`` — (js_pg+mysql only) mismatched pg adapter throws PrismaClientInitializationError [providers: postgres,mysql,sqlite] → ports/prisma/functional/driver-adapters-validate-active-provider/driver-adapters-validate-active-provider.test.ts
- [x] `@prisma/adapter-planetscale cannot be used with \`provider = "sqlite"\`` — (js_planetscale+sqlite only) mismatched planetscale adapter throws PrismaClientInitializationError [providers: postgres,mysql,sqlite] → non-ported
- [x] `@prisma/adapter-d1 cannot be used with \`provider = "postgresql"\`` — (js_d1+postgres only) mismatched d1 adapter throws PrismaClientInitializationError [providers: postgres,mysql,sqlite] → ports/prisma/functional/driver-adapters-validate-active-provider/driver-adapters-validate-active-provider.test.ts

### packages/client/tests/functional/enum-array/tests.ts

- [x] `can create data with an enum array` — create record with an enum array field [providers: postgres,mongodb,cockroachdb] → ports/prisma/functional/enum-array/enum-array.test.ts
- [x] `can retrieve data with an enum array` — create then findFirstOrThrow returns the enum array with correct type [providers: postgres,mongodb,cockroachdb] → ports/prisma/functional/enum-array/enum-array.test.ts
- [x] `can retrieve data with an enum array with a raw query and a custom parser` — (js_pg + client runtime only) createManyAndReturn + $queryRaw with custom userDefinedTypeParser parses enum arrays [providers: postgres,mongodb,cockroachdb] → non-ported

### packages/client/tests/functional/enums/tests.ts

- [x] `can create data with an enum value` — create record with an enum scalar value [providers: postgres,mysql,mongodb,cockroachdb,sqlite] → ports/prisma/functional/enums/enums.test.ts
- [x] `can retrieve data with an enum value` — create then findFirstOrThrow filtering by enum returns correct typed value [providers: postgres,mysql,mongodb,cockroachdb,sqlite] → ports/prisma/functional/enums/enums.test.ts
- [x] `the enum type can be assigned its own values` — enum type accepts its own literal values with correct static type [providers: postgres,mysql,mongodb,cockroachdb,sqlite] → ports/prisma/functional/enums/enums.test.ts
- [x] `fails at runtime when an invalid entry is entered manually in SQLite` — (sqlite only) raw-inserted invalid enum value errors on read [providers: postgres,mysql,mongodb,cockroachdb,sqlite] → non-ported
- [x] `fails at runtime when an invalid entry is entered manually in Mongo` — (mongo only) runCommandRaw-inserted invalid enum value errors on read [providers: postgres,mysql,mongodb,cockroachdb,sqlite] → test.fails: ports/prisma/functional/enums/enums.test.ts

### packages/client/tests/functional/extended-where/aggregate.ts

- [x] `aggregate with cursor 1 unique (PK)` — aggregate _count with cursor on PK id [providers: all] → non-ported
- [x] `aggregate with cursor 2 uniques (PK & non-PK)` — aggregate _count with cursor on id + title [providers: all] → non-ported
- [x] `update with where 1 unique (non-PK)` — aggregate _count with cursor on non-PK title [providers: all] → non-ported

### packages/client/tests/functional/extended-where/create.ts

- [x] `create with connect 1 unique (PK)` — create profile connecting user by PK id [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `create with connect 2 uniques (PK & non-PK)` — create profile connecting user by id + referralId [providers: all] → non-ported
- [x] `create with connect 1 unique (non-PK)` — create profile connecting user by non-PK referralId [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/delete.ts

- [x] `delete with where 2 uniques (PK & non-PK)` — delete post by id + title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `delete with where 1 unique (non-PK)` — delete post by non-PK title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `delete with where 1 unique (PK)` — delete user by PK id [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/findFirst.ts

- [x] `findFirst with cursor 1 unique (PK)` — findFirst with cursor on PK id [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findFirst with cursor 2 uniques (PK & non-PK)` — findFirst with cursor on id + title [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findFirst with cursor 1 unique (non-PK)` — findFirst with cursor on non-PK title [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/findFirstOrThrow.ts

- [x] `findFirstOrThrow with cursor 1 unique (PK)` — findFirstOrThrow with cursor on PK id [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findFirstOrThrow with cursor 2 uniques (PK & non-PK)` — findFirstOrThrow with cursor on id + title [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findFirstOrThrow with cursor 1 unique (non-PK)` — findFirstOrThrow with cursor on non-PK title [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/findMany.ts

- [x] `findMany with cursor 1 unique (PK)` — findMany with cursor on PK id [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findMany with cursor 2 uniques (PK & non-PK)` — findMany with cursor on id + title [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findMany with cursor 1 unique (non-PK)` — findMany with cursor on non-PK title [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/findUnique.ts

- [x] `findUnique with where 1 unique (PK)` — findUnique user by PK id [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findUnique with where 2 uniques (PK & non-PK)` — findUnique post by id + title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findUnique with where 1 unique (non-PK)` — findUnique post by non-PK title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findUnique with nested where on optional 1:1 not found` — nested where on payment relation yields null [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findUnique with nested where on optional 1:1 found` — nested where on payment relation matches ccn [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/findUniqueOrThrow.ts

- [x] `findUniqueOrThrow with where 1 unique (PK)` — findUniqueOrThrow user by PK id [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `findUniqueOrThrow with where 2 uniques (PK & non-PK)` — findUniqueOrThrow post by id + title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `finUniqueOrThrow with where 1 unique (non-PK)` — findUniqueOrThrow post by non-PK title (sic title) [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/update.ts

- [x] `update with where 1 unique (PK)` — update user by PK id [providers: all] → test.fails: ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `update with where 2 uniques (PK & non-PK)` — update post by id + title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `update with where 1 unique (non-PK)` — update post by non-PK title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/upsert.ts

- [x] `upsert with where 1 unique (PK)` — upsert user by PK id [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `upsert with where 2 uniques (PK & non-PK)` — upsert post by id + title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts
- [x] `upsert with where 1 unique (non-PK)` — upsert post by non-PK title [providers: all] → ports/prisma/functional/extended-where/extended-where.test.ts

### packages/client/tests/functional/extended-where/validation.ts

- [x] `where and no keys provided` — delete with empty where rejects with inline snapshot error [providers: all] → non-ported
- [x] `where and missing unique keys` — delete with where lacking unique key rejects with inline snapshot [providers: all] → non-ported
- [x] `AtLeast type with optional object` — type-level AtLeast on optional object with one required key [providers: all] → non-ported
- [x] `AtLeast type with optional object and no keys` — type-level AtLeast with never required key [providers: all] → non-ported

### packages/client/tests/functional/extensions/client.ts

- [x] `allows to extend client` — client extension method is callable on extended client [providers: all] → non-ported
- [x] `forwards arguments to an extension method` — args passed through to client ext method [providers: all] → non-ported
- [x] `forwards return value from  an extension method` — ext method return value propagates [providers: all] → non-ported
- [x] `allows single extension to have multiple extension methods` — one client ext with two methods [providers: all] → non-ported
- [x] `allows extension methods to call each other` — method invokes sibling via getExtensionContext [providers: all] → non-ported
- [x] `allows to have multiple client extensions with their own methods` — chained $extends each add a method [providers: all] → non-ported
- [x] `in case of name conflict, later extension wins` — override precedence for client methods [providers: all] → non-ported
- [x] `allows to override builtin methods` — override $transaction/$queryRaw [providers: all] → non-ported
- [x] `allows to call builtin methods from extensions` — $myTransaction calls this.$transaction [providers: all] → non-ported
- [x] `allows extension to call other extensions` — chained ext calls prior ext via context [providers: all] → non-ported
- [x] `can access models` — client ext can call ctx.user.findMany [providers: all] → non-ported
- [x] `empty extension does nothing` — empty $extends leave prior behavior intact [providers: all] → non-ported
- [x] `accepts property definition` — non-function property on client extension [providers: all] → non-ported
- [x] `error in extension method` — sync throw surfaces error [providers: all] → non-ported
- [x] `error in async extension method` — rejected promise surfaces error [providers: all] → non-ported
- [x] `error in extension method with no name` — throw without extension name [providers: all] → non-ported
- [x] `custom method re-using input to augment` — Exact/Args/Result type utils augment $executeRaw; gated @ts-test-if MONGODB [providers: all] → non-ported
- [x] `raw queries can override their default output types` — type-only: $transaction raw output type overrides; gated @ts-test-if by provider [providers: all] → non-ported
- [x] `an extension can also reference a previous one via parent` — $parent.someMethod on chained client ext [providers: all] → non-ported

### packages/client/tests/functional/extensions/defineExtension.ts

- [x] `client - callback` — defineExtension client via callback and default namespace [providers: all] → non-ported
- [x] `client - object` — defineExtension client via object and default namespace [providers: all] → non-ported
- [x] `model - callback` — defineExtension model via callback and default [providers: all] → non-ported
- [x] `model - object` — defineExtension model via object and default [providers: all] → non-ported
- [x] `result - callback` — defineExtension result via callback, computed field present [providers: all] → non-ported
- [x] `result - object` — defineExtension result via object, computed field present [providers: all] → non-ported
- [x] `chained` — chaining model/client/result defineExtensions incl. via default [providers: all] → non-ported
- [x] `invalid` — negative type checks for invalid extension shapes (@ts-expect-error) [providers: all] → non-ported
- [x] `generic model - callback via default` — generic model method type utils via default [providers: all] → non-ported
- [x] `generic model - object via default` — generic model method type utils via default object [providers: all] → non-ported
- [x] `generic client - object via default` — generic client method type utils via default [providers: all] → non-ported
- [x] `generic client - generic type utilities` — type-only: Result type utils equal real op results; several @ts-test-if provider gates [providers: all] → non-ported

### packages/client/tests/functional/extensions/extends.ts

- [x] `extended extension functions normally` — extended client lacks $on, findMany works [providers: all] → non-ported
- [x] `does not recompute extensions property on every access` — _extensions cached [providers: all] → non-ported

### packages/client/tests/functional/extensions/itx.ts

- [x] `client is extended in itx` — result ext fullName available inside $transaction tx [providers: all] → non-ported
- [x] `extended client in itx can rollback via normal call` — duplicate create rolls back interactive tx [providers: all] → non-ported
- [x] `extended client in itx works via normal call` — create commits in interactive tx [providers: all] → non-ported
- [x] `extended client in itx can rollback via custom call` — createAlt model ext rolls back [providers: all] → non-ported
- [x] `extended client in itx works via custom call` — createAlt model ext commits [providers: all] → non-ported
- [x] `itx works with extended client + queryRawUnsafe` — testIf(provider!==MONGODB): tx.$queryRawUnsafe inside itx [providers: all] → non-ported
- [x] `client component is available within itx callback` — client helper callable on tx [providers: all] → non-ported
- [x] `methods from itx client denylist are optional within client extensions` — ctx connect/disconnect/transaction/extends presence in vs out of itx [providers: all] → non-ported
- [x] `isolation level is properly reflected in extended client` — type-only: isolationLevel option on itx; @ts-test-if non-MONGODB [providers: all] → non-ported

### packages/client/tests/functional/extensions/model.ts

- [x] `extend specific model` — user ext method exists, post does not [providers: all] → non-ported
- [x] `chain $on with $extends` — $on then $extends, ext method works [providers: all] → non-ported
- [x] `extend all models` — $allModels ext method on user and post [providers: all] → non-ported
- [x] `pass arguments to ext method` — args forwarded to model ext method [providers: all] → non-ported
- [x] `return value to ext method` — return value from model ext method [providers: all] → non-ported
- [x] `specific model extension has precedence over $allModels` — specific over generic [providers: all] → non-ported
- [x] `last extension takes precedence over earlier ones` — later chained ext wins [providers: all] → non-ported
- [x] `allows to override built-in methods` — override findFirst on model [providers: all] → non-ported
- [x] `non-conflicting extensions can co-exist` — two model exts both callable [providers: all] → non-ported
- [x] `extension methods can call each other` — model ext calls sibling via this [providers: all] → non-ported
- [x] `extension methods can call model methods` — ctx.findMany from ext method [providers: all] → non-ported
- [x] `extension methods can call methods of other extensions` — cross-ext call via context [providers: all] → non-ported
- [x] `empty extension does nothing` — empty $extends preserve prior model ext [providers: all] → non-ported
- [x] `only accepts methods` — non-method model property (TODO ts-expect-error) [providers: all] → non-ported
- [x] `error in extension methods` — sync throw in model ext [providers: all] → non-ported
- [x] `error in async methods` — rejected promise in model ext [providers: all] → non-ported
- [x] `error in async PrismaPromise methods` — invalid findUnique input error snapshot, branches on relationJoins [providers: all] → non-ported
- [x] `batching of PrismaPromise returning custom model methods` — testIf(non-MONGODB & non-win32): batched custom method query log [providers: all] → non-ported
- [x] `batching of PrismaPromise returning custom model methods and query` — testIf(non-MONGODB & non-win32): batching with query ext + $allOperations [providers: all] → non-ported
- [x] `error in extension methods without name` — throw in unnamed model ext [providers: all] → non-ported
- [x] `custom method re-using input types to augment them via intersection` — Exact/Args intersection typing [providers: all] → non-ported
- [x] `custom method re-using input types to augment them via mapped type` — Nullable mapped-type input [providers: all] → non-ported
- [x] `custom method re-using output to augment it via intersection` — Result & {extra} output typing [providers: all] → non-ported
- [x] `custom method re-using payload output types` — Payload type util scalars/objects [providers: all] → non-ported
- [x] `custom method that uses exact for narrowing inputs` — Exact narrows literal input, negative cases [providers: all] → non-ported
- [x] `custom method that uses exact for narrowing generic inputs` — Exact with generic Input<T> [providers: all] → non-ported
- [x] `getExtension context on specific model and non-generic this` — ctx.name/$name for specific model [providers: all] → non-ported
- [x] `getExtension context on generic model and non-generic this` — ctx typing for $allModels non-generic this [providers: all] → non-ported
- [x] `getExtension context on specific model and generic this` — ctx typing specific model generic this [providers: all] → non-ported
- [x] `getExtension context on generic model and generic this` — ctx typing $allModels generic this [providers: all] → non-ported
- [x] `one specific user extension along a generic $allModels model extension` — specific + generic coexist, post lacks user-only method [providers: all] → non-ported
- [x] `does not allow to pass invalid properties` — invalid findFirst arg rejects (@ts-expect-error) [providers: all] → non-ported
- [x] `input type should be able to be passed to method accepting same input types` — UserUpsertArgs reuse on extended client [providers: all] → non-ported
- [x] `an extension can also reference a previous one via parent on a specific model` — $parent.user.findFirst on specific model [providers: all] → non-ported
- [x] `an extension can also reference a previous one via parent on $allModels` — $parent['user'].findFirst on $allModels [providers: all] → non-ported

### packages/client/tests/functional/extensions/pdp.ts

- [x] `_runtimeDataModel is available on the client instance and provides model info` — client._runtimeDataModel exposes model metadata [providers: all] → non-ported
- [x] `Prisma-Engine-Hash headers is present when sending a request` — testIf(TEST_DATA_PROXY set): engine-hash header via custom fetch [providers: all] → non-ported
- [x] `changing http headers via custom fetch` — testIf(TEST_DATA_PROXY set): custom fetch adds header [providers: all] → non-ported
- [x] `confirm that custom fetch cascades like a middleware` — testIf(TEST_DATA_PROXY set): chained customDataProxyFetch order [providers: all] → non-ported
- [x] `allows to override customDataProxyFetch for the whole batch` — testIf(TEST_DATA_PROXY set): $__internalBatch fetch override, cacheInfo [providers: all] → non-ported
- [x] `an overridden method can call its parent and the itx is respected` — testIf(TEST_DATA_PROXY set): $parent findFirst inside itx rollback [providers: all] → non-ported
- [x] `an overridden method can call its parent and the itx with a query extension is respected` — testIf(TEST_DATA_PROXY set): model+query ext $parent in itx rollback [providers: all] → non-ported
- [x] `customDataProxyFetch for batches stacks` — testIf(TEST_DATA_PROXY set): stacked $__internalBatch fetch order [providers: all] → non-ported

### packages/client/tests/functional/extensions/query.ts

- [x] `extending a specific model query` — user/post findFirst query ext with typed args/operation/model [providers: all] → non-ported
- [x] `top to bottom execution order` — chained query exts run top-to-bottom [providers: all] → non-ported
- [x] `args mutation isolation` — per-ext args mutation isolated, original unchanged [providers: all] → non-ported
- [x] `args mutation accumulation` — where mutations accumulate across exts [providers: all] → non-ported
- [x] `query result override with a simple call` — return override skips query, no emitter [providers: all] → non-ported
- [x] `query result override with extra extension after` — override short-circuits later ext [providers: all] → non-ported
- [x] `query result override with extra extension before` — earlier ext runs then override [providers: all] → non-ported
- [x] `query result mutation with a simple call` — mutate result id post-query [providers: all] → non-ported
- [x] `query result mutation with multiple calls` — two exts mutate id and email [providers: all] → non-ported
- [x] `query result mutations with batch transactions` — testIf(non-MONGODB & non-win32): result mutation in batch tx, query log [providers: all] → non-ported
- [x] `transforming a simple query into a batch transaction` — testIf(non-MONGODB & non-win32): ext wraps query in $transaction [providers: all] → non-ported
- [x] `hijacking a batch transaction into another one with a simple call` — testIf(non-MONGODB, non-win32, non-PLANETSCALE, non-D1): nested batch tx single call [providers: all] → non-ported
- [x] `hijacking a batch transaction into another one with multiple calls` — testIf(non-MONGODB, non-win32, non-PLANETSCALE, non-D1): nested batch tx multiple exts [providers: all] → non-ported
- [x] `extending with $allModels and a specific query` — $allModels.findFirst typed model union [providers: all] → non-ported
- [x] `extending with $allModels and $allOperations` — $allModels.$allOperations operation union [providers: all] → non-ported
- [x] `extending with specific model and $allOperations` — post.$allOperations model literal [providers: all] → non-ported
- [x] `errors in callback` — rejected query ext callback surfaces [providers: all] → non-ported
- [x] `errors in with no extension name` — rejected callback without ext name [providers: all] → non-ported
- [x] `empty args becomes an empty object` — undefined args normalized to {} [providers: all] → non-ported
- [x] `passing incorrect argument errors` — type-only: passing result back to query errors (@ts-expect-error) [providers: all] → non-ported
- [x] `result extensions are applied after query extension` — result ext computes over query-ext output [providers: all] → non-ported
- [x] `top-level raw queries interception` — testIf(non-SQLITE): intercept $queryRaw/$executeRaw(Unsafe)/$runCommandRaw; @ts-test-if provider branches [providers: all] → non-ported
- [x] `extending with $allModels.$allOperations and a top-level query` — testIf(non-MONGODB): raw + model ops intercepted [providers: all] → non-ported
- [x] `extending with $allModels and another $allModels` — two $allModels.findFirst exts both run [providers: all] → non-ported
- [x] `extending with top-level $allOperations` — top-level $allOperations intercepts model op [providers: all] → non-ported
- [x] `unions can be properly discriminated` — type-only: model/operation discrimination narrowing (@ts-expect-error) [providers: all] → non-ported
- [x] `arg types and return types are correct` — type-only: per-operation arg/return typing incl. $allOperations & raw; many @ts-test-if provider gates [providers: all] → non-ported

### packages/client/tests/functional/extensions/result.ts

- [x] `findFirst` — computed fullName on findFirst [providers: all] → non-ported
- [x] `findFirst using $allModels` — $allModels computed field on findFirst [providers: all] → non-ported
- [x] `findUnique` — computed fullName on findUnique [providers: all] → non-ported
- [x] `findMany` — computed fullName on findMany [providers: all] → non-ported
- [x] `create` — computed fullName on create result [providers: all] → non-ported
- [x] `update` — computed fullName on update result [providers: all] → non-ported
- [x] `upsert - update` — computed fullName on upsert update path [providers: all] → non-ported
- [x] `upsert - create` — computed fullName on upsert create path [providers: all] → non-ported
- [x] `when using select` — computed field with explicit select, needs hidden [providers: all] → non-ported
- [x] `when using select and $allModels` — $allModels computed field with select [providers: all] → non-ported
- [x] `relationships: with include` — computed field on included relation [providers: all] → non-ported
- [x] `relationships: with select` — computed field on selected relation [providers: all] → non-ported
- [x] `relationships: with deep select` — computed field via deep select [providers: all] → non-ported
- [x] `relationships: mixed include and select` — computed field mixed include/select [providers: all] → non-ported
- [x] `nested reads: include applies result extensions to nested models` — postLabel on nested posts via include [providers: all] → non-ported
- [x] `nested reads: select applies result extensions to nested models` — postLabel on nested posts via select [providers: all] → non-ported
- [x] `nested writes (create): include applies result extensions to nested models` — postLabel on created nested posts include [providers: all] → non-ported
- [x] `nested writes (create): select applies result extensions to nested models` — postLabel on created nested posts select [providers: all] → non-ported
- [x] `nested writes (update): include applies result extensions to nested models` — postLabel on updated nested posts include [providers: all] → non-ported
- [x] `nested writes (update): select applies result extensions to nested models` — postLabel on updated nested posts select [providers: all] → non-ported
- [x] `fluent reads apply result extensions to nested models` — postLabel via fluent .posts() [providers: all] → non-ported
- [x] `fluent writes (create) apply result extensions to nested models` — postLabel via fluent create.posts() [providers: all] → non-ported
- [x] `fluent writes (update) apply result extensions to nested models` — postLabel via fluent update.posts() [providers: all] → non-ported
- [x] `dependencies between computed fields` — loudName depends on fullName [providers: all] → non-ported
- [x] `shadowing dependency` — computed firstName shadows scalar [providers: all] → non-ported
- [x] `shadowing dependency multiple times` — chained shadowing of firstName [providers: all] → non-ported
- [x] `empty extension does nothing` — empty result exts keep fullName [providers: all] → non-ported
- [x] `with null result` — findUnique null result stays null [providers: all] → non-ported
- [x] `error in computed field` — throw in compute surfaces on access [providers: all] → non-ported
- [x] `error in computed field with no name` — throw in unnamed compute [providers: all] → non-ported
- [x] `nested includes should include scalars and relations` — deep nested include type check [providers: all] → non-ported
- [x] `when any type is passed as an input default selection type is returned` — type-only: any input yields default User type [providers: all] → non-ported
- [x] `when args have both include and select and one of them is optional, result includes both` — type-only: spread include typing parity [providers: all] → non-ported

### packages/client/tests/functional/extensions/tx.ts

- [x] `extended client in tx can rollback via normal call` — batch tx rollback with result ext [providers: all] → non-ported
- [x] `extended client in tx works via normal call` — batch tx commit with result ext [providers: all] → non-ported
- [x] `extended client in tx can rollback via custom call` — batch tx rollback via createAlt model ext [providers: all] → non-ported
- [x] `extended client in tx works via custom call` — batch tx commit via custom call [providers: all] → non-ported
- [x] `isolation level is properly reflected in extended client` — type-only: isolationLevel on batch tx; @ts-test-if non-MONGODB [providers: all] → non-ported
- [x] `type inference allows for destructuring the array` — type-only: destructure $transaction array results [providers: all] → non-ported

### packages/client/tests/functional/field-reference/enum/tests.ts

- [x] `simple enum equality` — findMany where enum1 equals field reference to enum2 [providers: postgres,mongodb,cockroachdb,mysql] → non-ported
- [x] `via extended client` — same enum field-reference equality through $extends client [providers: postgres,mongodb,cockroachdb,mysql] → non-ported

### packages/client/tests/functional/field-reference/json/tests.ts

- [x] `simple equality` — findMany where JSON properties1 equals field reference to properties2 [providers: postgres,sqlite,mysql,mongodb,cockroachdb] → non-ported
- [x] `does not conflict with {_ref: "something"} json value` — literal {_ref} JSON value is not treated as a field reference [providers: postgres,sqlite,mysql,mongodb,cockroachdb] → non-ported
- [x] `string filter` — testIf(postgres||cockroach): JSON path string_ends_with against a field reference [providers: postgres,sqlite,mysql,mongodb,cockroachdb] → non-ported
- [x] `array filter` — testIf(postgres||cockroach): JSON path array_contains against a field reference [providers: postgres,sqlite,mysql,mongodb,cockroachdb] → non-ported
- [x] `wrong field type` — referencing a String field for a JSON filter rejects with error snapshot [providers: postgres,sqlite,mysql,mongodb,cockroachdb] → non-ported
- [x] `via extended client` — JSON field-reference equality through $extends client [providers: postgres,sqlite,mysql,mongodb,cockroachdb] → non-ported

### packages/client/tests/functional/field-reference/list/tests.ts

- [x] `in` — scalar/enum `in` filter against a list field reference [providers: postgres,mongodb,cockroachdb] → non-ported
- [x] `notIn` — scalar/enum `notIn` filter against a list field reference [providers: postgres,mongodb,cockroachdb] → non-ported
- [x] `via extended client` — list field-reference notIn through $extends client [providers: postgres,mongodb,cockroachdb] → non-ported

### packages/client/tests/functional/field-reference/numeric/tests.ts

- [ ] `single condition` — findMany where quantity gt maxQuantity field reference [providers: all] → non-ported (not yet ported)
- [ ] `multiple condition` — quantity gt minQuantity and lt maxQuantity field references [providers: all] → non-ported (not yet ported)
- [ ] `aggregate` — aggregate _sum with field-reference where filter [providers: all] → non-ported (not yet ported)
- [ ] `relationship` — nested relation select with field-reference where filter [providers: all] → non-ported (not yet ported)
- [x] `wrong column numeric type` — referencing mismatched-type column rejects with error snapshot [providers: all] → non-ported
- [x] `via extended client` — numeric field-reference gt through $extends client [providers: all] → non-ported

### packages/client/tests/functional/field-reference/string/tests.ts

- [ ] `simple equality` — findMany where string equals otherString field reference [providers: all] → non-ported (not yet ported)
- [x] `advanced filter` — string startsWith field reference [providers: all] → non-ported
- [x] `wrong field type` — referencing an Int field for a String filter rejects with inline snapshot [providers: all] → non-ported
- [x] `wrong model` — referencing a field of another model rejects with inline snapshot [providers: all] → non-ported
- [x] `wrong identical model` — referencing a field of an identical-shaped model rejects with inline snapshot [providers: all] → non-ported

### packages/client/tests/functional/filter-count-relations/tests.ts

- [x] `without condition` — _count select of posts relation with no filter [providers: all] → passing: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `one-to-many > with simple equality condition` — _count posts filtered by published true [providers: all] → passing: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `one-to-many > with > condition` — _count posts filtered by upvotes gt 100 [providers: all] → passing: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `one-to-many > with multiple conditions` — _count posts filtered by published and upvotes gt [providers: all] → passing: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `many-to-many > with simple equality condition` — _count users filtered by blocked true [providers: all] → test.fails: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `many-to-many > with > condition` — _count users filtered by balance gt 20 [providers: all] → test.fails: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `many-to-many > with multiple conditions` — _count users filtered by balance gt and blocked false [providers: all] → test.fails: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts
- [x] `nested relation` — testIf(!dataProxy||provider!==mongodb): nested users select with filtered _count posts [providers: all] → passing: test/ports/prisma/functional/filter-count-relations/filter-count-relations.test.ts

### packages/client/tests/functional/find-unique-or-throw-batching/tests.ts

- [x] `batched errors are when all objects in batch are found` — two findUniqueOrThrow batched, both fulfilled [providers: all] → ports/prisma/functional/find-unique-or-throw-batching/find-unique-or-throw-batching.test.ts
- [x] `batched errors when some of the objects not found` — batched findUniqueOrThrow, missing one rejects with P2025 [providers: all] → ports/prisma/functional/find-unique-or-throw-batching/find-unique-or-throw-batching.test.ts

### packages/client/tests/functional/fluent-api/tests.ts

- [x] `regular client > lower-cased relations` — chained lower-cased fluent relations return null with correct types (describeIf !shouldSkip) [providers: all] → non-ported
- [x] `regular client > upper-cased relations` — chained upper-cased Banking relation returns null with correct types [providers: all] → non-ported
- [x] `regular client > findFirst` — findFirst then .posts() returns related posts [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow` — findFirstOrThrow then .posts() returns non-nullable posts [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow where nested entity is not found` — fluent .property() resolves null when relation absent [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow` — findUniqueOrThrow then .posts() returns non-nullable posts [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow where nested entity is not found` — fluent .property() resolves null when relation absent [providers: all] → non-ported
- [x] `regular client > create` — create then .posts() returns empty array [providers: all] → non-ported
- [x] `regular client > update` — update then .posts() returns related posts [providers: all] → non-ported
- [x] `regular client > upsert` — upsert then .posts() returns related posts [providers: all] → non-ported
- [x] `regular client > delete` — delete then .posts() returns related posts [providers: all] → non-ported
- [x] `regular client > chaining and selecting` — fluent .posts() with select narrows type [providers: all] → non-ported
- [x] `regular client > chaining and selecting twice` — fluent .property().house() with select at each step [providers: all] → non-ported
- [x] `extended client > lower-cased relations` — chained lower-cased fluent relations via $extends (describeIf !shouldSkip) [providers: all] → non-ported
- [x] `extended client > upper-cased relations` — chained upper-cased Banking relation via $extends [providers: all] → non-ported
- [x] `extended client > findFirst` — findFirst then .posts() via $extends [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow` — findFirstOrThrow then .posts() via $extends [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow where nested entity is not found` — fluent .property() resolves null via $extends [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow` — findUniqueOrThrow then .posts() via $extends [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow where nested entity is not found` — fluent .property() resolves null via $extends [providers: all] → non-ported
- [x] `extended client > create` — create then .posts() empty array via $extends [providers: all] → non-ported
- [x] `extended client > update` — update then .posts() via $extends [providers: all] → non-ported
- [x] `extended client > upsert` — upsert then .posts() via $extends [providers: all] → non-ported
- [x] `extended client > delete` — delete then .posts() via $extends [providers: all] → non-ported
- [x] `extended client > chaining and selecting` — fluent .posts() with select via $extends [providers: all] → non-ported
- [x] `extended client > chaining and selecting twice` — fluent .property().house() with select via $extends [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow with required to-one relation` — type-only: fluent .house() resolves House [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow with required to-one relation` — type-only: fluent .house() resolves House [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow with required to-one relation circling back to optional relation` — type-only: long fluent chain resolves Property|null [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow with required to-one relation circling back to optional relation` — type-only: long fluent chain resolves Property|null [providers: all] → non-ported
- [x] `findUniqueOrThrow with required to-one relation` — top-level type-only: $extends property.house() resolves House [providers: all] → non-ported
- [x] `findFirstOrThrow with required to-one relation` — top-level type-only: $extends property.house() resolves House [providers: all] → non-ported
- [x] `findUniqueOrThrow with required to-one relation circling back to optional relation` — top-level type-only: long fluent chain resolves Property|null [providers: all] → non-ported
- [x] `findFirstOrThrow with required to-one relation circling back to optional relation` — top-level type-only: long fluent chain resolves Property|null [providers: all] → non-ported

### packages/client/tests/functional/fluent-api-null/tests.ts

- [x] `regular client > findFirst` — fluent .children() after findFirst returns null and nullable type [providers: all] → non-ported
- [x] `regular client > findUnique` — fluent .children() after findUnique returns null and nullable type [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow` — fluent .children() after findFirstOrThrow rejects, non-nullable type [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow` — fluent .children() after findUniqueOrThrow rejects, non-nullable type [providers: all] → non-ported
- [x] `regular client > create` — fluent .children() after create returns empty array [providers: all] → non-ported
- [x] `regular client > update` — fluent .children() after update on missing id rejects [providers: all] → non-ported
- [x] `regular client > upsert` — fluent .children() after upsert returns empty array [providers: all] → non-ported
- [x] `regular client > findFirst with select` — fluent .children({select}) after findFirst returns null [providers: all] → non-ported
- [x] `regular client > findUnique with select` — fluent .children({select}) after findUnique returns null [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow with select` — fluent .children({select}) after findFirstOrThrow rejects [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow with select` — fluent .children({select}) after findUniqueOrThrow rejects [providers: all] → non-ported
- [x] `regular client > create with select` — fluent .children({select}) after create returns empty array [providers: all] → non-ported
- [x] `regular client > update with select` — fluent .children({select}) after update rejects [providers: all] → non-ported
- [x] `regular client > upsert with select` — fluent .children({select}) after upsert returns empty array [providers: all] → non-ported
- [x] `regular client > findFirst with include` — fluent .children({include}) after findFirst returns null [providers: all] → non-ported
- [x] `regular client > findUnique with include` — fluent .children({include}) after findUnique returns null [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow with include` — fluent .children({include}) after findFirstOrThrow rejects [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow with include` — fluent .children({include}) after findUniqueOrThrow rejects [providers: all] → non-ported
- [x] `regular client > create with include` — fluent .children({include}) after create returns empty array [providers: all] → non-ported
- [x] `regular client > update with include` — fluent .children({include}) after update rejects [providers: all] → non-ported
- [x] `regular client > upsert with include` — fluent .children({include}) after upsert returns empty array [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow with optional to-one relation` — type-only: .parent() resolves Resource|null [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow with optional to-one relation` — type-only: .parent() resolves Resource|null [providers: all] → non-ported
- [x] `regular client > findUniqueOrThrow with optional to-one relation circling back to to-many relation` — type-only: .parent().children() resolves Child[]|null [providers: all] → non-ported
- [x] `regular client > findFirstOrThrow with optional to-one relation circling back to to-many relation` — type-only: .parent().children() resolves Child[]|null [providers: all] → non-ported
- [x] `extended client > findFirst` — fluent .children() after findFirst via $extends returns null [providers: all] → non-ported
- [x] `extended client > findUnique` — fluent .children() after findUnique via $extends returns null [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow` — fluent .children() after findFirstOrThrow via $extends rejects [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow` — fluent .children() after findUniqueOrThrow via $extends rejects [providers: all] → non-ported
- [x] `extended client > create` — fluent .children() after create via $extends returns empty array [providers: all] → non-ported
- [x] `extended client > update` — fluent .children() after update via $extends rejects [providers: all] → non-ported
- [x] `extended client > upsert` — fluent .children() after upsert via $extends returns empty array [providers: all] → non-ported
- [x] `extended client > findFirst with select` — fluent .children({select}) after findFirst via $extends returns null [providers: all] → non-ported
- [x] `extended client > findUnique with select` — fluent .children({select}) after findUnique via $extends returns null [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow with select` — fluent .children({select}) after findFirstOrThrow via $extends rejects [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow with select` — fluent .children({select}) after findUniqueOrThrow via $extends rejects [providers: all] → non-ported
- [x] `extended client > create with select` — fluent .children({select}) after create via $extends returns empty array [providers: all] → non-ported
- [x] `extended client > update with select` — fluent .children({select}) after update via $extends rejects [providers: all] → non-ported
- [x] `extended client > upsert with select` — fluent .children({select}) after upsert via $extends returns empty array [providers: all] → non-ported
- [x] `extended client > findFirst with include` — fluent .children({include}) after findFirst via $extends returns null [providers: all] → non-ported
- [x] `extended client > findUnique with include` — fluent .children({include}) after findUnique via $extends returns null [providers: all] → non-ported
- [x] `extended client > findFirstOrThrow with include` — fluent .children({include}) after findFirstOrThrow via $extends rejects [providers: all] → non-ported
- [x] `extended client > findUniqueOrThrow with include` — fluent .children({include}) after findUniqueOrThrow via $extends rejects [providers: all] → non-ported
- [x] `extended client > create with include` — fluent .children({include}) after create via $extends returns empty array [providers: all] → non-ported
- [x] `extended client > update with include` — fluent .children({include}) after update via $extends rejects [providers: all] → non-ported
- [x] `extended client > upsert with include` — fluent .children({include}) after upsert via $extends returns empty array [providers: all] → non-ported
- [x] `findUniqueOrThrow with optional to-one relation` — top-level type-only: $extends child.parent() resolves Resource|null [providers: all] → non-ported
- [x] `findFirstOrThrow with optional to-one relation` — top-level type-only: $extends child.parent() resolves Resource|null [providers: all] → non-ported
- [x] `findUniqueOrThrow with optional to-one relation circling back to to-many relation` — top-level type-only: .parent().children() resolves Child[]|null [providers: all] → non-ported
- [x] `findFirstOrThrow with optional to-one relation circling back to to-many relation` — top-level type-only: .parent().children() resolves Child[]|null [providers: all] → non-ported

### packages/client/tests/functional/fulltext-search/tests.ts

- [x] `AND query` — fulltext search AND query returns single matching user [providers: postgres,mysql] → non-ported
- [ ] `OR query` — fulltext search OR query returns all three users [providers: postgres,mysql] → non-ported (not yet ported)
- [ ] `NOT query` — fulltext search NOT query excludes matched term [providers: postgres,mysql] → non-ported (not yet ported)
- [ ] `no results` — fulltext search query with no matches returns empty [providers: postgres,mysql] → non-ported (not yet ported)
- [x] `bad query` — testIf(platform!==win32): malformed fulltext query rejects with error snapshot [providers: postgres,mysql] → non-ported
- [ ] `order by relevance on a single field` — orderBy _relevance on name field, desc [providers: postgres,mysql] → non-ported (not yet ported)
- [ ] `order by relevance on multiple fields` — orderBy _relevance on name and email, asc [providers: postgres,mysql] → non-ported (not yet ported)
- [ ] `order by relevance: multiple orderBy statements` — orderBy _relevance on name field, desc ordering [providers: postgres,mysql] → non-ported (not yet ported)

### packages/client/tests/functional/globalOmit/test.ts

- [x] `throws if omit is not an object` — global omit config rejected when omit value is not an object [providers: exclude:mongodb] → non-ported
- [x] `throws if omit is null` — global omit config rejected when omit is null [providers: exclude:mongodb] → non-ported
- [x] `throws if unknown model is mentioned in omit` — validation error for unknown model key in omit [providers: exclude:mongodb] → non-ported
- [x] `throws if unknown field is mentioned in omit` — validation error for unknown field in omit [providers: exclude:mongodb] → non-ported
- [x] `throws if non boolean field is used in omit` — validation error when omit field value is not boolean [providers: exclude:mongodb] → non-ported
- [x] `throws if relation field is used in omit` — validation error when omitting a relation field [providers: exclude:mongodb] → non-ported
- [x] `omitting every field` — omitting all fields of a model [providers: exclude:mongodb] → non-ported
- [x] `findFirstOrThrow` — global omit applied in findFirstOrThrow result [providers: exclude:mongodb] → non-ported
- [x] `findUniqueOrThrow` — global omit applied in findUniqueOrThrow result [providers: exclude:mongodb] → non-ported
- [x] `findFirst` — global omit applied in findFirst result [providers: exclude:mongodb] → non-ported
- [x] `findUnique` — global omit applied in findUnique result [providers: exclude:mongodb] → non-ported
- [x] `findMany` — global omit applied in findMany result [providers: exclude:mongodb] → non-ported
- [x] `create` — global omit applied in create result [providers: exclude:mongodb] → non-ported
- [x] `delete` — global omit applied in delete result [providers: exclude:mongodb] → non-ported
- [x] `createMany does not crash` — createMany works with global omit configured [providers: exclude:mongodb] → non-ported
- [x] `deleteMany does not crash` — deleteMany works with global omit configured [providers: exclude:mongodb] → non-ported
- [x] `updateMany does not crash` — updateMany works with global omit configured [providers: exclude:mongodb] → non-ported
- [x] `groupBy does not crash` — groupBy works with global omit configured [providers: exclude:mongodb] → non-ported
- [x] `count does not crash` — count works with global omit configured [providers: exclude:mongodb] → non-ported
- [x] `aggregate does not crash` — aggregate works with global omit configured [providers: exclude:mongodb] → non-ported
- [x] `createManyAndReturn` — global omit applied in createManyAndReturn result (skipTestIf: not sqlserver/mongodb/mysql) [providers: exclude:mongodb] → non-ported
- [x] `update` — global omit applied in update result [providers: exclude:mongodb] → non-ported
- [x] `upsert` — global omit applied in upsert result [providers: exclude:mongodb] → non-ported
- [x] `excluding more than one field at a time` — multiple fields omitted globally [providers: exclude:mongodb] → non-ported
- [x] `allows to include globally omitted field with omit: false` — local omit:false overrides global omit [providers: exclude:mongodb] → non-ported
- [x] `allows to include globally omitted field with select: true` — local select:true overrides global omit [providers: exclude:mongodb] → non-ported
- [x] `works for nested relations (include)` — global omit applied to nested include relations [providers: exclude:mongodb] → non-ported
- [x] `works for nested relations (select)` — global omit applied to nested select relations [providers: exclude:mongodb] → non-ported
- [x] `works for fluent api` — global omit applied via fluent api traversal [providers: exclude:mongodb] → non-ported
- [x] `works after extending the client` — global omit still applied on extended client [providers: exclude:mongodb] → non-ported
- [x] `works with fluent api after extending the client` — global omit applied via fluent api on extended client [providers: exclude:mongodb] → non-ported
- [x] `works with result extension, depending on explicitly omitted field` — result extension reads a globally omitted field [providers: exclude:mongodb] → non-ported

### packages/client/tests/functional/globalOmitJSGenerator/test.ts

- [x] `throws if omit is not an object` — global omit config rejected when omit value is not an object (JS generator) [providers: all] → non-ported
- [x] `throws if omit is null` — global omit config rejected when omit is null (JS generator) [providers: all] → non-ported
- [x] `throws if unknown model is mentioned in omit` — validation error for unknown model key in omit (JS generator) [providers: all] → non-ported
- [x] `throws if unknown field is mentioned in omit` — validation error for unknown field in omit (JS generator) [providers: all] → non-ported
- [x] `throws if non boolean field is used in omit` — validation error when omit field value is not boolean (JS generator) [providers: all] → non-ported
- [x] `throws if relation field is used in omit` — validation error when omitting a relation field (JS generator) [providers: all] → non-ported
- [x] `omitting every field` — omitting all fields of a model (JS generator) [providers: all] → non-ported
- [x] `findFirstOrThrow` — global omit applied in findFirstOrThrow result [providers: all] → non-ported
- [x] `findUniqueOrThrow` — global omit applied in findUniqueOrThrow result [providers: all] → non-ported
- [x] `findFirst` — global omit applied in findFirst result [providers: all] → non-ported
- [x] `findUnique` — global omit applied in findUnique result [providers: all] → non-ported
- [x] `findMany` — global omit applied in findMany result [providers: all] → non-ported
- [x] `create` — global omit applied in create result [providers: all] → non-ported
- [x] `delete` — global omit applied in delete result [providers: all] → non-ported
- [x] `createMany does not crash` — createMany works with global omit configured [providers: all] → non-ported
- [x] `deleteMany does not crash` — deleteMany works with global omit configured [providers: all] → non-ported
- [x] `updateMany does not crash` — updateMany works with global omit configured [providers: all] → non-ported
- [x] `groupBy does not crash` — groupBy works with global omit configured [providers: all] → non-ported
- [x] `count does not crash` — count works with global omit configured [providers: all] → non-ported
- [x] `aggregate does not crash` — aggregate works with global omit configured [providers: all] → non-ported
- [x] `createManyAndReturn` — global omit applied in createManyAndReturn result (skipTestIf: not sqlserver/mongodb/mysql) [providers: all] → non-ported
- [x] `update` — global omit applied in update result [providers: all] → non-ported
- [x] `upsert` — global omit applied in upsert result [providers: all] → non-ported
- [x] `excluding more than one field at a time` — multiple fields omitted globally [providers: all] → non-ported
- [x] `allows to include globally omitted field with omit: false` — local omit:false overrides global omit [providers: all] → non-ported
- [x] `allows to include globally omitted field with select: true` — local select:true overrides global omit [providers: all] → non-ported
- [x] `works for nested relations (include)` — global omit applied to nested include relations [providers: all] → non-ported
- [x] `works for nested relations (select)` — global omit applied to nested select relations [providers: all] → non-ported
- [x] `works for fluent api` — global omit applied via fluent api traversal [providers: all] → non-ported
- [x] `works after extending the client` — global omit still applied on extended client [providers: all] → non-ported
- [x] `works with fluent api after extending the client` — global omit applied via fluent api on extended client [providers: all] → non-ported
- [x] `works with result extension, depending on explicitly omitted field` — result extension reads a globally omitted field [providers: all] → non-ported

### packages/client/tests/functional/handle-int-overflow/tests.ts

- [x] `integer overflow` — creating with 1e20 int throws 64-bit signed integer overflow error [providers: all] → passing: test/ports/prisma/functional/handle-int-overflow/handle-int-overflow.test.ts
- [x] `big float in exponent notation` — creating with Number.MAX_VALUE throws 64-bit signed integer overflow error [providers: all] → passing: test/ports/prisma/functional/handle-int-overflow/handle-int-overflow.test.ts

### packages/client/tests/functional/interactive-transactions/tests.ts

- [x] `issue #19137` — regression test for interactive transaction issue #19137 [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `basic` — basic interactive transaction commits changes [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `timeout default` — transaction hits the default timeout [providers: all] → non-ported
- [x] `timeout override` — per-call timeout option overrides default [providers: all] → non-ported
- [x] `timeout override by PrismaClient` — client-level timeout option overrides default [providers: all] → non-ported
- [x] `rollback throw` — throwing inside transaction rolls back [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `rollback throw value` — throwing a non-error value rolls back [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `postgresql: nested create` — nested create inside transaction (testIf: postgres only) [providers: all] → non-ported
- [x] `mongodb: nested transactions are not available in types` — nested transactions absent from types on mongodb (testIf: mongodb only) [providers: all] → non-ported
- [x] `sql: nested rollback` — nested transaction rollback on sql (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: nested rollback restores parent state (savepoints, 3 levels)` — savepoint rollback restores parent state across 3 levels (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: nested commit keeps state (savepoints, 3 levels)` — nested commits preserve state across 3 savepoint levels (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: disallow concurrent nested transactions` — concurrent nested transactions rejected (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: allow nested transactions in concurrent top-level transactions` — nested txns allowed within concurrent top-level txns (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: nested commit keeps outer transaction open` — committing nested txn leaves outer open (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: sequential nested transactions work` — sequential nested transactions succeed (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: deep nesting (3 levels) works` — 3-level deep nesting works (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: nested rollback can be caught and outer can continue` — caught nested rollback lets outer txn continue (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: enforce order for nested transactions` — enforced ordering of nested transactions (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: child fails if parent tries to commit before child finishes` — child errors when parent commits early (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: child fails if parent rolls back before child finishes` — child errors when parent rolls back early (testIf: non-mongodb) [providers: all] → non-ported
- [x] `sql: child fails if nested parent closes before grandchild finishes` — grandchild errors when nested parent closes early (testIf: non-mongodb) [providers: all] → non-ported
- [x] `mongodb: disallow nested transactions at runtime` — nested transactions rejected at runtime on mongodb (testIf: mongodb only) [providers: all] → non-ported
- [x] `forbidden` — forbidden operations inside interactive transaction [providers: all] → non-ported
- [x] `rollback query` — explicit rollback of a query within transaction [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `already committed` — using a transaction after it is committed [providers: all] → non-ported
- [x] `batching` — batch operations within interactive transaction [providers: all] → non-ported
- [x] `batching rollback` — batch rollback within transaction [providers: all] → non-ported
- [x] `batching rollback within callback` — batch rolled back from inside callback [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `batching timeout override` — timeout override for batched transaction [providers: all] → non-ported
- [x] `batching raw rollback` — raw query batch rollback (testIf: non-mongodb) [providers: all] → non-ported
- [x] `concurrent` — concurrent interactive transactions [providers: all] → non-ported
- [x] `high concurrency with write conflicts` — high concurrency with write conflicts (testIf: postgres only) [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `high concurrency with no conflicts` — high concurrency without conflicts (testIf: non-sqlite) [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `rollback with then calls` — rollback when using .then chaining [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `rollback with catch calls` — rollback when using .catch chaining [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [x] `rollback with finally calls` — rollback when using .finally chaining [providers: all] → ports/prisma/functional/interactive-transactions/interactive-transactions.test.ts
- [ ] `high concurrency with SET FOR UPDATE` — high concurrency using SELECT FOR UPDATE (testIf: postgres only) [providers: all] → non-ported (not yet ported)
- [x] `isolation levels > read committed` — read committed isolation level supported per provider (describeIf: non-mongodb) [providers: all] → non-ported
- [x] `isolation levels > read uncommitted` — read uncommitted isolation level supported per provider (describeIf: non-mongodb) [providers: all] → non-ported
- [x] `isolation levels > repeatable read` — repeatable read isolation level supported per provider (describeIf: non-mongodb) [providers: all] → non-ported
- [x] `isolation levels > serializable` — serializable isolation level supported (describeIf: non-mongodb) [providers: all] → non-ported
- [x] `isolation levels > invalid value` — invalid isolation level value rejected (describeIf: non-mongodb) [providers: all] → non-ported
- [x] `attempt to set isolation level on mongo` — setting isolation level on mongodb errors (testIf: mongodb only) [providers: all] → non-ported

### packages/client/tests/functional/invalid-env-value/tests.ts

- [x] `PrismaClientInitializationError for invalid env` — $connect with invalid datasource URL env throws PrismaClientInitializationError [providers: all] → non-ported

### packages/client/tests/functional/invalid-sqlite-isolation-level/tests.ts

- [x] `invalid level generates run- and compile- time error` — ReadUncommitted isolation level on sqlite errors at run/compile time (testIf: driver-adapter only) [providers: sqlite-only] → non-ported

### packages/client/tests/functional/json-fields/tests.ts

- [x] `simple object` — storing/reading a simple JSON object [providers: exclude:sqlserver] → passing: test/ports/prisma/functional/json-fields/json-fields.test.ts
- [x] `empty object` — storing/reading an empty JSON object [providers: exclude:sqlserver] → passing: test/ports/prisma/functional/json-fields/json-fields.test.ts
- [x] `object with no prototype` — JSON object created with no prototype (regression #14274/#14342) [providers: exclude:sqlserver] → passing: test/ports/prisma/functional/json-fields/json-fields.test.ts
- [x] `object with .toJSON method` — JSON serialization honors toJSON and URL (regression #20192) [providers: exclude:sqlserver] → passing: test/ports/prisma/functional/json-fields/json-fields.test.ts

### packages/client/tests/functional/json-list-push/tests.ts

- [x] `push with single element` — push a single element onto a JSON list [providers: postgres-only] → non-ported
- [x] `push with array value` — push an array value onto a JSON list [providers: postgres-only] → non-ported

### packages/client/tests/functional/json-null-types/tests.ts

- [x] `nullableJsonField > JsonNull` — JsonNull stored as null in nullable JSON field [providers: exclude:mongodb,sqlserver] → non-ported
- [x] `nullableJsonField > DbNull` — DbNull stored as null in nullable JSON field [providers: exclude:mongodb,sqlserver] → non-ported
- [x] `requiredJsonField > JsonNull` — JsonNull accepted for required JSON field [providers: exclude:mongodb,sqlserver] → non-ported
- [x] `requiredJsonField > DbNull` — DbNull rejected for required JSON field with validation error [providers: exclude:mongodb,sqlserver] → non-ported
- [x] `properties of DbNull/JsonNull/AnyNull > instanceof checks pass` — DbNull/JsonNull/AnyNull instanceof their NullTypes classes [providers: exclude:mongodb,sqlserver] → non-ported
- [x] `properties of DbNull/JsonNull/AnyNull > custom instances are accepted for cross-bundle compatibility` — custom NullTypes instances accepted for cross-bundle compat [providers: exclude:mongodb,sqlserver] → non-ported

### packages/client/tests/functional/large-floats/tests.ts

- [x] `floats` — large/negative floats and safe-integer bounds round-trip correctly [providers: all] → passing: test/ports/prisma/functional/large-floats/large-floats.test.ts

### packages/client/tests/functional/logging/tests.ts

- [x] `should log queries on a method call` — query event logged for a method call [providers: all] → non-ported
- [x] `should log queries inside a ITX` — queries inside interactive transaction logged (skipTestIf: not js_d1) [providers: all] → non-ported
- [x] `should log batched queries inside a ITX` — batched queries inside interactive transaction logged (skipTestIf: not js_d1) [providers: all] → non-ported
- [x] `should log transaction batched queries` — batched transaction queries logged [providers: all] → non-ported

### packages/client/tests/functional/logging-types/tests.ts

- [x] `check that query and info logs match their declared types` — query and info log events conform to declared event types [providers: all] → non-ported

**Total: 730 tests**
