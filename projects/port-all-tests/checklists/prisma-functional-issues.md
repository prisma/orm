# Checklist — prisma/prisma client functional regressions (issues/)

Source: prisma/prisma@a6d01554528e016bea1467a072776b0e2b94dcba — packages/client/tests/functional/issues/

Protocol: each line is one source test. `[ ]` = not yet dispositioned. The Opus reviewer sub-agent checks `[x]` ONLY when satisfied that the test is (a) faithfully ported and passing, (b) faithfully ported as `test.fails` with a `failing.md` entry, or (c) covered by a justified individual `non-ported.md` entry. Implementer sub-agents never check boxes.

### packages/client/tests/functional/issues/4004/tests.ts

- [x] `should not throw error when updating fields on a many to many join table` — updating scalar fields on an implicit m2m join model must not throw [providers: all] → ports/prisma/functional/issues-4004/issues-4004.test.ts

### packages/client/tests/functional/issues/5952-decimal-batch/tests.ts

- [x] `findUnique decimal with Promise.all` — Decimal values survive batch-compaction of concurrent findUnique via Promise.all [providers: sql] → ports/prisma/functional/issues-5952-decimal-batch/issues-5952-decimal-batch.test.ts
- [x] `findUnique decimal with $transaction([...])` — Decimal values survive findUnique batched inside array `$transaction` [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-5952-decimal-batch/issues-5952-decimal-batch.md)
- [x] `findFirst decimal with Promise.all` — Decimal values survive batched findFirst via Promise.all [providers: sql] → ports/prisma/functional/issues-5952-decimal-batch/issues-5952-decimal-batch.test.ts
- [x] `findFirst decimal with $transaction([...])` — Decimal values survive findFirst batched inside array `$transaction` [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-5952-decimal-batch/issues-5952-decimal-batch.md)

### packages/client/tests/functional/issues/6578/tests.ts

- [x] `should assert Dates, DateTimes, Times and UUIDs are wrapped in quotes and are deserializable` — raw-query JSON output quotes Date/DateTime/Time/UUID so JSON.parse does not throw [providers: sql] → non-ported

### packages/client/tests/functional/issues/9007/tests.ts

- [x] `should throw an error if using contains filter on uuid type` — `contains` filter on a UUID column raises a validation error [providers: postgres, cockroachdb] → non-ported
- [x] `should not generate the contains field on the where type` — `contains` is absent from the generated where-input type for UUID (type test) [providers: postgres, cockroachdb] → non-ported

### packages/client/tests/functional/issues/9372/tests.ts

- [x] `does not crash on large amount of items inserted` — createMany with a very large batch does not crash [providers: sqlite] → non-ported

### packages/client/tests/functional/issues/9678/tests.ts

- [x] `concurrent deleteMany/createMany` — concurrent deleteMany+createMany retries on write-conflict/deadlock (P2034) without corrupting data [providers: postgres, mysql, sqlserver, cockroachdb] → non-ported

### packages/client/tests/functional/issues/10000/tests.ts

- [x] `issue 10000 > issue 10000` — `@map`ped column names (`event_id`) resolve correctly through relation queries [providers: mysql] → non-ported

### packages/client/tests/functional/issues/10229/tests.ts

- [x] `should assert that the error has the correct errorCode` — connection failure surfaces the correct initialization error code [providers: postgres, mysql, cockroachdb] → non-ported

### packages/client/tests/functional/issues/11233/tests.ts

- [x] `should not throw when using Prisma.empty inside $executeRaw` — `Prisma.empty` passed to `$executeRaw` does not throw [providers: sql] → non-ported
- [x] `should not throw when using Prisma.empty inside $queryRaw` — `Prisma.empty` passed to `$queryRaw` does not throw [providers: sql] → non-ported

### packages/client/tests/functional/issues/11322/tests.ts

- [x] `example` — BigInt-typed related record ids read back correctly through `include` after `set` (mysql-specific) [providers: mysql] → non-ported

### packages/client/tests/functional/issues/11740-transaction-stored-query/tests.ts

- [x] `stored query triggered twice should fail but not exit process` — reusing a stored query promise twice in a batch `$transaction` rejects without crashing the process [providers: all] → non-ported (ports/prisma/non-ported/functional/issues-11740-transaction-stored-query/issues-11740-transaction-stored-query.md)
- [x] `stored query trigger .requestTransaction twice should fail` — calling `.requestTransaction` twice on a stored query rejects [providers: all] → non-ported (ports/prisma/non-ported/functional/issues-11740-transaction-stored-query/issues-11740-transaction-stored-query.md)
- [x] `no multiple resolves should happen` — reusing a stored query in a batch does not trigger Node `multipleResolves` [providers: all] → non-ported (ports/prisma/non-ported/functional/issues-11740-transaction-stored-query/issues-11740-transaction-stored-query.md)

### packages/client/tests/functional/issues/11789-sqlite-with-wal-or-connection_limit/tests.ts

- [x] `D1 does not support journal_mode = WAL` — D1 adapter rejects `journal_mode = WAL` (driver-specific) [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-sqlite-with-wal-or-connection_limit/issues-11789-sqlite-with-wal-or-connection_limit.md)
- [x] `default case: no Driver Adapter > 5 concurrent upsert should succeed with journal_mode = WAL` — 5 concurrent upserts succeed under WAL journal mode [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-sqlite-with-wal-or-connection_limit/issues-11789-sqlite-with-wal-or-connection_limit.md)
- [x] `default case: no Driver Adapter > 5 concurrent upsert should succeed with connection_limit=1 & journal_mode = WAL` — 5 concurrent upserts succeed with connection_limit=1 and WAL [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-sqlite-with-wal-or-connection_limit/issues-11789-sqlite-with-wal-or-connection_limit.md)
- [x] `default case: no Driver Adapter > 5 concurrent upsert should succeed with connection_limit=1` — 5 concurrent upserts succeed with connection_limit=1 [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-sqlite-with-wal-or-connection_limit/issues-11789-sqlite-with-wal-or-connection_limit.md)
- [x] `default case: no Driver Adapter > 5 concurrent delete should succeed with connection_limit=1` — 5 concurrent deletes succeed with connection_limit=1 [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-sqlite-with-wal-or-connection_limit/issues-11789-sqlite-with-wal-or-connection_limit.md)

### packages/client/tests/functional/issues/11789-timed-out/tests.ts

- [x] `5 concurrent upsert should succeed` — 5 concurrent upserts complete without timing out [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-timed-out/issues-11789-timed-out.md)
- [x] `5 concurrent delete should succeed` — 5 concurrent deletes complete without timing out [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-timed-out/issues-11789-timed-out.md)
- [x] `100 concurrent creates should succeed` — 100 concurrent creates complete without timing out [providers: sqlite] → non-ported (ports/prisma/non-ported/functional/issues-11789-timed-out/issues-11789-timed-out.md)

### packages/client/tests/functional/issues/11974/tests.ts

- [x] `should not throw an error when counting two relation fields using find` — selecting `_count` of two relations via find does not throw [providers: sql] → test.fails: ports/prisma/functional/issues-11974/issues-11974.test.ts
- [x] `should not throw an error when aggregating two relation fields using aggregate` — counting two relations via aggregate does not throw [providers: sql] → ports/prisma/functional/issues-11974/issues-11974.test.ts

### packages/client/tests/functional/issues/12003-order-by-self/tests.ts

- [ ] `findFirst` — orderBy across a self-relation works in findFirst [providers: all] → non-ported (not yet ported)
- [ ] `findMany` — orderBy across a self-relation works in findMany [providers: all] → non-ported (not yet ported)
- [ ] `aggregate` — orderBy across a self-relation works in aggregate [providers: all] → non-ported (needs re-examination)

### packages/client/tests/functional/issues/12378/tests.ts

- [x] `issue 12378 > issue 12378` — create/connect/update across a m2m through-model with implicit relation works end to end [providers: postgres, mysql, cockroachdb, sqlserver] → ports/prisma/functional/issues-12378/issues-12378.test.ts

### packages/client/tests/functional/issues/12557/tests.ts

- [x] `issue 12557 > issue 12557` — `_count` on a relation stays correct after deleting a related record [providers: postgres, mysql] → test.fails: ports/prisma/functional/issues-12557/issues-12557.test.ts

### packages/client/tests/functional/issues/12572/tests.ts

- [x] `should have equal dates on record creation for @default(now) and @updatedAt` — `@default(now())` and `@updatedAt` produce equal timestamps at creation [providers: all] → ports/prisma/functional/issues-12572/issues-12572.test.ts

### packages/client/tests/functional/issues/12862-errors-are-obfuscated-by-interactive-transactions/tests.ts

- [x] `should propagate the correct error when a method fails` — a failing method surfaces the underlying error, not an obfuscated one [providers: postgres] → non-ported (ports/prisma/non-ported/functional/issues-12862-errors-are-obfuscated-by-interactive-transactions/issues-12862-errors-are-obfuscated-by-interactive-transactions.md)
- [x] `should propagate the correct error when a method fails inside an transaction` — error propagated correctly inside a batch transaction [providers: postgres] → non-ported (ports/prisma/non-ported/functional/issues-12862-errors-are-obfuscated-by-interactive-transactions/issues-12862-errors-are-obfuscated-by-interactive-transactions.md)
- [x] `should propagate the correct error when a method fails inside an interactive transaction` — error propagated correctly inside an interactive transaction [providers: postgres] → non-ported (ports/prisma/non-ported/functional/issues-12862-errors-are-obfuscated-by-interactive-transactions/issues-12862-errors-are-obfuscated-by-interactive-transactions.md)

### packages/client/tests/functional/issues/13089/tests.ts

- [x] `should return records when using a `$` in the search string` — `$` in a filter string returns records (mongo) [providers: mongodb] → ports/prisma/functional/issues-13089-dollar-in-search/issues-13089-dollar-in-search.test.ts
- [x] `should update records when using a `$` in the search string` — `$` in an update filter string updates records [providers: mongodb] → ports/prisma/functional/issues-13089-dollar-in-search/issues-13089-dollar-in-search.test.ts
- [x] `should delete records when using a `$` in the search string` — `$` in a delete filter string deletes records [providers: mongodb] → ports/prisma/functional/issues-13089-dollar-in-search/issues-13089-dollar-in-search.test.ts

### packages/client/tests/functional/issues/13097-group-by-enum/tests.ts

- [x] `groupBy on enumValue field` — groupBy on an enum-scalar field works [providers: postgres, mysql, cockroachdb, mongodb] → non-ported
- [x] `groupBy on enumArray field` — groupBy on an enum-array field works (excludes mysql) [providers: postgres, cockroachdb, mongodb] → non-ported

### packages/client/tests/functional/issues/13405-mongo-raw-itx/tests.ts

- [x] `mongo raw queries should work inside iTX > findRaw` — `findRaw` works inside an interactive transaction [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-13405-mongo-raw-itx/issues-13405-mongo-raw-itx.md)
- [x] `mongo raw queries should work inside iTX > aggregateRaw` — `aggregateRaw` works inside an interactive transaction [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-13405-mongo-raw-itx/issues-13405-mongo-raw-itx.md)
- [x] `mongo raw queries should work inside iTX > runCommandRaw` — `runCommandRaw` works inside an interactive transaction [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-13405-mongo-raw-itx/issues-13405-mongo-raw-itx.md)
- [x] `iTX functionality should work when using mongo raw queries > commit` — iTX commit works when raw queries are used [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-13405-mongo-raw-itx/issues-13405-mongo-raw-itx.md)
- [x] `iTX functionality should work when using mongo raw queries > rollback` — iTX rollback works when raw queries are used [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-13405-mongo-raw-itx/issues-13405-mongo-raw-itx.md)

### packages/client/tests/functional/issues/13766/at-unique/tests.ts

- [x] `relationMode=prisma should not prevent any updates on a model when updating a field which is not referenced in a relation` — updating a non-referenced field is allowed under relationMode=prisma (@unique key) [providers: all] → non-ported
- [x] `relationMode=prisma should prevent updates on a model if any other relation references a field` — updating a relation-referenced field is prevented under relationMode=prisma (@unique key) [providers: all] → non-ported

### packages/client/tests/functional/issues/13766/primary-key/tests.ts

- [x] `relationMode=prisma should not prevent any updates on a model when updating a field which is not referenced in a relation` — updating a non-referenced field is allowed under relationMode=prisma (primary key) [providers: all] → non-ported
- [x] `relationMode=prisma should prevent updates on a model if any other relation references a field` — updating a relation-referenced field is prevented under relationMode=prisma (primary key; excludes mongodb) [providers: all exclude:mongodb] → non-ported

### packages/client/tests/functional/issues/13913-integer-overflow/tests.ts

- [x] `int overflow` — integer overflow handling (test.skip, pending fix decision) [providers: all] [skip] → non-ported

### packages/client/tests/functional/issues/14001-mongo-order-by-conflict/tests.ts

- [x] `findFirst` — field named `OrderBy` with where/orderBy/cursor/distinct does not produce invalid mongo query in findFirst [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-14001-mongo-order-by-conflict/issues-14001-mongo-order-by-conflict.md)
- [x] `findMany` — `OrderBy` field query is valid in findMany [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-14001-mongo-order-by-conflict/issues-14001-mongo-order-by-conflict.md)
- [x] `aggregate` — `OrderBy` field query is valid in aggregate [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-14001-mongo-order-by-conflict/issues-14001-mongo-order-by-conflict.md)
- [x] `groupBy` — `OrderBy` field query is valid in groupBy [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-14001-mongo-order-by-conflict/issues-14001-mongo-order-by-conflict.md)

### packages/client/tests/functional/issues/14271/tests.ts

- [x] `issue 14271 > issue 14271` — nested createMany + ordered findMany across relations returns expected shape [providers: postgres] → ports/prisma/functional/issues-14271/issues-14271.test.ts

### packages/client/tests/functional/issues/14373-batch-tx-error/tests.ts

- [x] `correctly reports location of a batch error` — a batch transaction error reports the correct failing query location/index [providers: all] → non-ported

### packages/client/tests/functional/issues/14954-date-batch/tests.ts

- [x] `findUnique date with Promise.all` — Date values survive batch-compaction of concurrent findUnique via Promise.all [providers: all] → ports/prisma/functional/issues-14954-date-batch/issues-14954-date-batch.test.ts
- [x] `findUnique date with $transaction([...])` — Date values survive findUnique batched inside array `$transaction` [providers: all] → non-ported (ports/prisma/non-ported/functional/issues-14954-date-batch/issues-14954-date-batch.md)
- [x] `findFirst date with Promise.all` — Date values survive batched findFirst via Promise.all [providers: all] → ports/prisma/functional/issues-14954-date-batch/issues-14954-date-batch.test.ts
- [x] `findFirst date with $transaction([...])` — Date values survive findFirst batched inside array `$transaction` [providers: all] → non-ported (ports/prisma/non-ported/functional/issues-14954-date-batch/issues-14954-date-batch.md)

### packages/client/tests/functional/issues/15044/tests.ts

- [x] `should not throw error when using connect inside transaction` — `connect` inside an interactive `$transaction` across multiple creates does not throw [providers: all] → ports/prisma/functional/issues-15044/issues-15044.test.ts

### packages/client/tests/functional/issues/15079/tests.ts

- [x] `should not throw an error when upserting a @db.Decimal(2, 0)` — upsert of a `@db.Decimal(2,0)` column does not throw (sqlserver) [providers: sqlserver] → non-ported

### packages/client/tests/functional/issues/15084-mongo-logging/tests.ts

- [x] `should log queries` — mongo query events are emitted to the query log [providers: mongodb] → non-ported (ports/prisma/non-ported/functional/issues-15084-mongo-logging/issues-15084-mongo-logging.md)

### packages/client/tests/functional/issues/15177/tests.ts

- [x] `should allow CRUD methods on a table column that has a space` — CRUD works on a column whose name contains a space [providers: sql] → non-ported

### packages/client/tests/functional/issues/15204-conversion-error/tests.ts

- [x] `should return a descriptive error` — reading an out-of-range Int/BigInt yields a descriptive conversion error (sqlite) [providers: sqlite] → non-ported

### packages/client/tests/functional/issues/15264-uint-id-overflow/tests.ts

- [x] `upsert should not fail` — upsert on an unsigned-int id near overflow does not fail (mysql) [providers: mysql] → non-ported

### packages/client/tests/functional/issues/16195-index-out-of-bounds/tests.ts

- [x] `transaction` — a transaction does not trigger an index-out-of-bounds engine panic [providers: all] → non-ported

### packages/client/tests/functional/issues/16390-relation-mode-m-n-dangling-pivot/tests.ts

- [x] `issue 16390 > when deleting an item, the corresponding entry in the implicit pivot table should be deleted` — deleting an item removes its implicit m2m pivot rows under relationMode [providers: postgres, mysql] → non-ported
- [x] `when deleting a category, the corresponding entry in the implicit pivot table should be deleted` — deleting a category removes its implicit m2m pivot rows [providers: postgres, mysql] → non-ported

### packages/client/tests/functional/issues/16535-select-enum/tests.ts

- [x] `allows to select enum field` — selecting an enum field returns its value [providers: postgres, mysql, cockroachdb] → ports/prisma/functional/issues-16535-select-enum/issues-16535-select-enum.test.ts

### packages/client/tests/functional/issues/17005-args-type-conflict/tests.ts

- [x] `dummy` — placeholder runtime check; real assertion is that generated arg types don't conflict (type test) [providers: all] → ports/prisma/functional/issues-17005-args-type-conflict/issues-17005-args-type-conflict.test.ts

### packages/client/tests/functional/issues/17030-args-type-conflict/tests.ts

- [x] `include works correctly` — `include` still works when a model field name would conflict with args types [providers: all] → ports/prisma/functional/issues-17030-args-type-conflict/issues-17030-args-type-conflict.test.ts

### packages/client/tests/functional/issues/17405-extensions-casing/tests.ts

- [x] `empty` — client extension with model-name casing variations instantiates (type test) [providers: all] → non-ported

### packages/client/tests/functional/issues/17797-no-env-error-init/tests.ts

- [x] `instantiate works without failing` — instantiating the client without env vars does not throw [providers: all] → non-ported

### packages/client/tests/functional/issues/17948-tx-client-extensions/tests.ts

- [x] `extension method is bound to transaction client within itx` — a `$extends` model method binds to the transaction client inside an interactive transaction [providers: all] → non-ported

### packages/client/tests/functional/issues/18276-batch-order/tests.ts

- [x] `executes batch queries in the right order when using extensions + middleware` — batched queries preserve order with query extensions and middleware [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-18276-batch-order/issues-18276-batch-order.md)
- [x] `executes batch in right order when using delayed middleware` — batched queries preserve order with a delayed middleware [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-18276-batch-order/issues-18276-batch-order.md)

### packages/client/tests/functional/issues/18292-inspect-loop/test.ts

- [x] `it is possible to inspect/log prisma client` — `util.inspect`/logging the client does not infinite-loop [providers: all] → non-ported
- [x] `result extensions are still logged/inspected correctly` — result extensions are represented correctly when inspected [providers: all] → non-ported
- [x] `depth option is respected` — inspect `depth` option is respected [providers: all] → non-ported

### packages/client/tests/functional/issues/18598-select-count-true/tests.ts

- [x] `works with _count shorthand` — `select: { _count: true }` shorthand works [providers: all] → non-ported: `select: { _count: true }` returns a count of every relation; prisma-next has no all-relations `_count` selection surface

### packages/client/tests/functional/issues/18846-empty-array/tests.ts

- [x] `correctly rejects empty arrays in places where empty objects are allowed` — empty arrays are rejected where empty objects are valid inputs [providers: all] → non-ported

### packages/client/tests/functional/issues/18854-extensions-db-null/tests.ts

- [x] `allows to use DbNull together with query extensions` — `Prisma.DbNull` works together with query extensions [providers: postgres, sqlite, mysql, cockroachdb] → non-ported

### packages/client/tests/functional/issues/18970-invalid-date/tests.ts

- [x] `throws on invalid date (json)` — an invalid Date passed into a JSON field throws [providers: all] → passing: test/ports/prisma/functional/issues-18970-invalid-date/issues-18970-invalid-date.test.ts

### packages/client/tests/functional/issues/19997-select-include-undefined/tests.ts

- [x] `correctly infers selection when passing select: undefined` — `select: undefined` yields the default selection [providers: all] → non-ported: passing an explicit `undefined` to select/include has no prisma-next surface; omitting the call tests something different
- [x] `correctly infers selection when passing include: undefined` — `include: undefined` yields the default selection [providers: all] → non-ported: passing an explicit `undefined` to select/include has no prisma-next surface; omitting the call tests something different

### packages/client/tests/functional/issues/20261-group-by-shortcut/tests.ts

- [x] `works with a scalar in "by"` — groupBy accepts a scalar (string) shorthand for `by` [providers: all] → passing: test/ports/prisma/functional/issues-20261-group-by-shortcut/issues-20261-group-by-shortcut.test.ts
- [x] `works with a scalar in "by" and no other selection` — groupBy with only a scalar `by` and no extra selection [providers: all] → non-ported
- [x] `works with extended client` — groupBy scalar `by` shorthand works on an extended client [providers: all] → non-ported

### packages/client/tests/functional/issues/20422-cannot-assign-type-to-itself/tests.ts

- [x] `return types must be compatible with returned data types in classes (type test only)` — generated return types assignable to model class instances (type test) [providers: all] → non-ported

### packages/client/tests/functional/issues/20499-result-ext-count/tests.ts

- [x] `result extensions do not break .count` — defining result extensions does not break `.count` [providers: all] → non-ported

### packages/client/tests/functional/issues/20724/tests.ts

- [x] `unique constraint violation > modelName is returned on error.meta > should return modelName on error.meta when performing prisma.model.create` — unique-violation error exposes modelName in meta for model.create [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-20724/issues-20724.md)
- [x] `unique constraint violation > modelName is returned on error.meta > should return modelName on error.meta when performing prisma$transaction with the client` — unique-violation error exposes modelName in meta inside `$transaction` [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-20724/issues-20724.md)
- [x] `unique constraint violation > modelName is not returned on error.meta > should not return modelName when performing queryRaw` — raw query unique-violation error has no modelName in meta [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-20724/issues-20724.md)
- [x] `unique constraint violation > modelName is not returned on error.meta > should not return modelName when performing executeRaw` — raw executeRaw unique-violation error has no modelName in meta [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-20724/issues-20724.md)
- [x] `unique constraint violation > modelName is not returned on error.meta > should not return modelName when performing transactions with raw queries` — raw-query transaction unique-violation error has no modelName in meta [providers: sql] → non-ported (ports/prisma/non-ported/functional/issues-20724/issues-20724.md)

### packages/client/tests/functional/issues/21136-extensions-mocking-library/tests.ts

- [x] `with full override extension > output inference (via `mockResolvedValue`)` — output types infer correctly through a full-override result extension (mock proxy) [providers: sqlite] → non-ported
- [x] `with full override extension > input inference (via `calledWith`)` — input types infer correctly through a full-override extension [providers: sqlite] → non-ported
- [x] `with full override extension > call still work as usual` — calls still work through a full-override extension [providers: sqlite] → non-ported
- [x] `with empty extension > output inference (via `mockResolvedValue`)` — output types infer correctly through an empty extension (mock proxy) [providers: sqlite] → non-ported
- [x] `with empty extension > input inference (via `calledWith`)` — input types infer correctly through an empty extension [providers: sqlite] → non-ported
- [x] `with empty extension > call still work as usual` — calls still work through an empty extension [providers: sqlite] → non-ported

### packages/client/tests/functional/issues/21352-id-does-not-exist/tests.ts

- [x] `[1] should not fail` — relation-join query does not fail with "column j1.id does not exist" [providers: sql] → ports/prisma/functional/issues-21352-id-does-not-exist/issues-21352-id-does-not-exist.test.ts
- [x] `[2] should not fail` — relation-join query does not fail with "column j1.field does not exist" [providers: sql] → ports/prisma/functional/issues-21352-id-does-not-exist/issues-21352-id-does-not-exist.test.ts

### packages/client/tests/functional/issues/21369-select-null/tests.ts

- [ ] `SELECT NULL works` — a raw `SELECT NULL` returns null correctly [providers: sql] → non-ported (not yet ported)

### packages/client/tests/functional/issues/21454-$type-in-json/tests.ts

- [x] `preserves json with $type key inside` — JSON values containing a `$type` key are preserved verbatim [providers: exclude:sqlserver] → ports/prisma/functional/issues-21454-type-in-json/issues-21454-type-in-json.test.ts
- [x] `preserves deeply nested json with $type key inside` — deeply nested JSON with `$type` keys is preserved verbatim [providers: exclude:sqlserver] → ports/prisma/functional/issues-21454-type-in-json/issues-21454-type-in-json.test.ts

### packages/client/tests/functional/issues/21592-char-truncation/tests.ts

- [x] `does not truncate the input` — char/varchar input is not silently truncated [providers: postgres, mysql, cockroachdb, sqlserver] → non-ported
- [x] `upsert` — upsert does not truncate char input [providers: postgres, mysql, cockroachdb, sqlserver] → non-ported

### packages/client/tests/functional/issues/21631-batching-in-transaction/tests.ts

- [x] `Transactions and batching (query compacting) shouldn't interfere with result sets > 2 independent `findUnique`s` — query compacting keeps result sets correct for 2 independent findUniques [providers: all] → ports/prisma/functional/issues-21631-batching-in-transaction/issues-21631-batching-in-transaction.test.ts
- [x] `Transactions and batching (query compacting) shouldn't interfere with result sets > 2 concurrent `findUnique`s` — query compacting keeps result sets correct for 2 concurrent findUniques [providers: all] → ports/prisma/functional/issues-21631-batching-in-transaction/issues-21631-batching-in-transaction.test.ts
- [x] `Transactions and batching (query compacting) shouldn't interfere with result sets > 2 `findUnique`s in a $transaction` — query compacting keeps result sets correct for 2 findUniques in a `$transaction` [providers: all] → non-ported (ports/prisma/non-ported/functional/issues-21631-batching-in-transaction/issues-21631-batching-in-transaction.md)

### packages/client/tests/functional/issues/21807-citext-neon/tests.ts

- [x] `writing and reading a citext field works` — writing and reading a Postgres `citext` field works [providers: postgres] → non-ported

### packages/client/tests/functional/issues/21967-mapped-enum/test.ts

- [x] `correctly returns mapped enums` — `@map`ped enum values are returned correctly (mysql) [providers: mysql] → non-ported

### packages/client/tests/functional/issues/22098-column_does_not_exist/test.ts

- [x] `does not throw error` — query against a model with a mapped/omitted column does not throw "column does not exist" [providers: all] → ports/prisma/functional/issues-22098-column-does-not-exist/issues-22098-column-does-not-exist.test.ts

### packages/client/tests/functional/issues/22610-parallel-batch/tests.ts

- [x] `batch does not times out` — a large parallel batch of queries completes without timing out [providers: all] → ports/prisma/functional/issues-22610-parallel-batch/issues-22610-parallel-batch.test.ts

### packages/client/tests/functional/issues/22947-sqlite-conccurrent-upsert/tests.ts

- [x] `concurrent upserts should succeed` — concurrent upserts on sqlite succeed without conflict errors [providers: all] → non-ported

### packages/client/tests/functional/issues/23201-non-ascii-comments/test.ts

- [x] `can connect to the DB` — schema with non-ASCII comments still connects and queries [providers: all] → ports/prisma/functional/issues-23201-non-ascii-comments/issues-23201-non-ascii-comments.test.ts

### packages/client/tests/functional/issues/23902/tests.ts

- [x] `should not throw error when updating fields on a many to many join table` — updating scalar fields on an explicit m2m join model must not throw (repro of #4004) [providers: all] → ports/prisma/functional/issues-23902/issues-23902.test.ts

### packages/client/tests/functional/issues/24835-omit-error/test.ts

- [x] `have omitted field as never` — an omitted field is typed as `never` and absent at runtime [providers: all] → non-ported

### packages/client/tests/functional/issues/25163-typed-sql-enum/test.ts

- [x] `returns enums that are mapped to invalid JS identifier correctly` — TypedSQL returns enum values whose names are invalid JS identifiers correctly [providers: postgres, cockroachdb] → non-ported

### packages/client/tests/functional/issues/25404/test.ts

- [x] `should not throw error when using d1 adapter and creating with string field that contains date string` — creating a string field containing a date string via D1 adapter does not throw [providers: all] → test/ports/prisma/functional/issues-25404/issues-25404.test.ts

### packages/client/tests/functional/issues/25481-typedsql-query-extension/test.ts

- [x] `TypedSQL should work when a client extension of type query extension is used` — TypedSQL works when a query-type client extension is active [providers: postgres] → non-ported

### packages/client/tests/functional/issues/27455-bytes-id/test.ts

- [x] `should retrieve records after a create with Bytes IDs` — records with `Bytes` primary keys are retrievable after create [providers: postgres, mysql, cockroachdb, sqlite] → test.fails: test/ports/prisma/functional/issues-27455-bytes-id/issues-27455-bytes-id.test.ts

### packages/client/tests/functional/issues/27511-include-enum-array/test.ts

- [x] `findMany with include on many-to-many relationship with enum array should work` — findMany + include over a m2m relation with an enum-array field works [providers: postgres] → ports/prisma/functional/issues-27511-include-enum-array/issues-27511-include-enum-array.test.ts

### packages/client/tests/functional/issues/28151-broken-nested-set/tests.ts

- [x] `nested set should result in all expected linked rows` — nested `set` produces all expected relation links [providers: all] → test.fails: ports/prisma/functional/issues-28151-broken-nested-set/issues-28151-broken-nested-set.test.ts

### packages/client/tests/functional/issues/28192-pg-historical-dates/test.ts

- [x] `historical dates with 2-digit years (00-99 AD) > correctly parses $label` — Postgres timestamps with historical/2-digit-year dates round-trip correctly (9 data rows) [providers: postgres] [each] → ports/prisma/functional/issues-28192-pg-historical-dates/issues-28192-pg-historical-dates.test.ts (5 passing: 120 AD, ms, modern, 3-digit year, timestamptz+tz; test.fails ×4: 31/32/40/99 AD — pg/date@1 century-drop)

### packages/client/tests/functional/issues/28213-relation-join-batch-crash/tests.ts

- [x] `should not crash when submitting a batch with relationLoadStrategy join` — batching queries with `relationLoadStrategy: 'join'` does not crash [providers: postgres, cockroachdb, mysql] → non-ported

### packages/client/tests/functional/issues/28591-mapped-enums/test.ts

- [x] `create with mapped enum` — creating a record with a `@map`ped enum value works (postgres) [providers: postgres] → test.fails: ports/prisma/functional/issues-28591-mapped-enums/issues-28591-mapped-enums.test.ts

### packages/client/tests/functional/issues/28968-sqlite-exists-duplicate/tests.ts

- [x] `should not duplicate rows for a nested "some ... in" query` — a nested `some { ... in }` filter does not return duplicate rows (sqlite) [providers: sqlite] → non-ported

### packages/client/tests/functional/issues/29010-bigint-precision-relation-joins/tests.ts

- [x] `preserves BigInt precision in relationJoins queries` — BigInt ids beyond MAX_SAFE_INTEGER keep precision in relationJoins queries [providers: postgres, cockroachdb, mysql] → test.fails: ports/prisma/functional/issues-29010-bigint-precision-relation-joins/issues-29010-bigint-precision-relation-joins.test.ts
- [x] `preserves BigInt precision in nested relationJoins queries` — BigInt precision preserved in nested relationJoins queries [providers: postgres, cockroachdb, mysql] → test.fails: ports/prisma/functional/issues-29010-bigint-precision-relation-joins/issues-29010-bigint-precision-relation-joins.test.ts

### packages/client/tests/functional/issues/29122-mysql-bigint-view-relation/tests.ts

- [x] `correctly handles an integer key returned from a view relation in MySQL` — integer key from a MySQL view relation is handled correctly [providers: mysql] → non-ported

### packages/client/tests/functional/issues/29160-mysql-precision-loss/tests.ts

- [x] `preserves precision for large decimal values` — large decimal values retain precision (MySQL/MariaDB) [providers: mysql] → non-ported

### packages/client/tests/functional/issues/29174-jsonb-parameter-regression/tests.ts

- [x] `correctly deserializes Date objects in JSON fields` — Date objects inside JSON fields deserialize correctly [providers: all exclude:sqlserver] → ports/prisma/functional/issues-29174-jsonb-parameter-regression/issues-29174-jsonb-parameter-regression.test.ts
- [x] `correctly deserializes Date array objects in JSON fields` — arrays of Date objects inside JSON fields deserialize correctly [providers: all exclude:sqlserver] → ports/prisma/functional/issues-29174-jsonb-parameter-regression/issues-29174-jsonb-parameter-regression.test.ts
- [x] `correctly deserializes Date objects in JSON fields with $type` — Date objects with `$type` wrapper inside JSON fields deserialize correctly [providers: all exclude:sqlserver] → ports/prisma/functional/issues-29174-jsonb-parameter-regression/issues-29174-jsonb-parameter-regression.test.ts

### packages/client/tests/functional/issues/29176-cursor-parameter-regression/tests.ts

- [x] `correctly handles a cursor with parameterised values` — pagination with a cursor whose values are parameterised works [providers: all] → test.fails: ports/prisma/functional/issues-29176-cursor-parameter-regression/issues-29176-cursor-parameter-regression.test.ts

### packages/client/tests/functional/issues/29212-array-push-regression/tests.ts

- [x] `correctly pushes to array field` — `push` update on a scalar array field appends correctly [providers: postgres, cockroachdb, mongodb] → non-ported

### packages/client/tests/functional/issues/29215-case-insensitive-in/tests.ts

- [x] `correctly handles a case insensitive IN filter` — `in` filter with `mode: insensitive` matches case-insensitively [providers: postgres, cockroachdb, mongodb] → non-ported
- [x] `correctly handles a case insensitive NOT IN filter` — `notIn` filter with `mode: insensitive` matches case-insensitively [providers: postgres, cockroachdb, mongodb] → non-ported

### packages/client/tests/functional/issues/29254-query-plan-cache-mutation/tests.ts

- [x] `correctly handles two subsequent queries with a different cursor` — query-plan cache is not mutated across subsequent queries with different cursors [providers: all] → test.fails: ports/prisma/functional/issues-29254-query-plan-cache-mutation/issues-29254-query-plan-cache-mutation.test.ts

### packages/client/tests/functional/issues/29267-uint8array-in-json/tests.ts

- [x] `serializes Uint8Array nested in object as base64` — Uint8Array nested in an object inside a JSON field serializes as base64 [providers: all exclude:sqlserver] → test.fails: ports/prisma/functional/issues-29267-uint8array-in-json/issues-29267-uint8array-in-json.test.ts
- [x] `serializes Uint8Array nested in array as base64` — Uint8Array nested in an array inside a JSON field serializes as base64 [providers: all exclude:sqlserver] → test.fails: ports/prisma/functional/issues-29267-uint8array-in-json/issues-29267-uint8array-in-json.test.ts
- [x] `serializes Uint8Array directly as base64` — a top-level Uint8Array JSON value serializes as base64 [providers: all exclude:sqlserver] → test.fails: ports/prisma/functional/issues-29267-uint8array-in-json/issues-29267-uint8array-in-json.test.ts
- [x] `serializes deeply nested Uint8Array as base64` — deeply nested Uint8Array inside a JSON field serializes as base64 [providers: all exclude:sqlserver] → test.fails: ports/prisma/functional/issues-29267-uint8array-in-json/issues-29267-uint8array-in-json.test.ts

### packages/client/tests/functional/issues/29309-datetime-cursor/tests.ts

- [x] `retrieves a cursor against a DATE column` — pagination cursor against a DATE column works [providers: postgres, mysql, cockroachdb, sqlserver] → test.fails: ports/prisma/functional/issues-29309-datetime-cursor/issues-29309-datetime-cursor.test.ts

### packages/client/tests/functional/issues/29331-query-plan-cache-bloat/tests.ts

- [x] `createMany stress test for cache bloat` — repeated createMany with varying parameter patterns does not bloat the query-plan cache [providers: all] → ports/prisma/functional/issues-29331-query-plan-cache-bloat/issues-29331-query-plan-cache-bloat.test.ts

### packages/client/tests/functional/issues/TML-1664-invalid-enum-value-error/test.ts

- [x] `returns P2007 error when inserting enum value that does not exist in database` — inserting an enum value missing from the DB enum surfaces P2007 (data validation error) [providers: postgres] → test/ports/prisma/functional/issues-TML-1664-invalid-enum-value-error/issues-TML-1664-invalid-enum-value-error.test.ts

### packages/client/tests/functional/issues/TML-1664-unknown-enum-value-read-error/test.ts

- [x] `returns P2023 error when reading enum value unknown to Prisma` — reading a DB enum value unknown to the Prisma schema surfaces P2023 [providers: postgres] → test.fails: test/ports/prisma/functional/issues-TML-1664-unknown-enum-value-read-error/issues-TML-1664-unknown-enum-value-read-error.test.ts

### packages/client/tests/functional/issues/unmapped-driver-error-user-facing/test.ts

- [x] `returns P2039 with the original DB code and message for unmapped Postgres errors` — an unmapped Postgres error (42P10) surfaces P2039 with the original DB code and message [providers: postgres] → test/ports/prisma/functional/issues-unmapped-driver-error-user-facing/issues-unmapped-driver-error-user-facing.test.ts

**Total: 153 tests**
