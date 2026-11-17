---
from: "8.0.0-rc.18"
to: "8.0.0-rc.19"
changes:
  - id: client-takes-contract-value
    summary: |
      Every client and static entry takes the contract only as a value, `{ contract }`. The `contractJson` option is removed, so `postgres<Contract>({ contractJson, url })` no longer compiles, and the client infers its contract type from the value, so the call needs no type argument. Turn the emitted JSON into a typed value once with `contractFromJson<Contract>(contractJson)` from the facade's `/static` entry (`@prisma/orm-postgres/static`, `@prisma/orm-sqlite/static`, `@prisma/orm-mongo/static`; Supabase uses the Postgres one), export it from the module that creates the client, and pass `{ contract }`. This applies to `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()`, `postgresStatic()`, `sqliteStatic()`, `mongoStatic()` and `mongoQuery()`. Extension packages that build a client, static entry or `mongoQuery` in their code, examples or tests move the same way. The colocated script moves source files; move test files by hand.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])(?:postgres|postgresServerless|sqlite|supabase|mongo|postgresStatic|sqliteStatic|mongoStatic|mongoQuery)(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
        - '(?<![\s\S])(?:(?!import\s+[\w$]+\s*(?:,\s*\{[^{}]*\}\s*)?from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"])[\s\S])*import\s+([\w$]+)\s*(?:,\s*\{[^{}]*\}\s*)?from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"][\s\S]*(?<![\w$.])\1(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
        - '(?<![\s\S])(?:(?!import\s*(?:[\w$]+\s*,\s*)?\{[^{}]*\b(?:default|supabase|mongoQuery|postgresStatic|sqliteStatic|mongoStatic)\s+as\s+[\w$]+[^{}]*\}\s*from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"])[\s\S])*import\s*(?:[\w$]+\s*,\s*)?\{[^{}]*\b(?:default|supabase|mongoQuery|postgresStatic|sqliteStatic|mongoStatic)\s+as\s+([\w$]+)[^{}]*\}\s*from\s*[''"]@prisma/orm-(?:(?:postgres|sqlite|mongo)/(?:runtime|serverless|static|query-builder)|extension-supabase/runtime)[''"][\s\S]*(?<![\w$.])\1(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{[^{}]*\})*?,)?\s*contractJson\s*[,}:]'
    script: ./scripts/client-takes-contract-value/contract-from-json.ts
  - id: collections-on-the-client
    summary: |
      Not a breaking change. Every SQL client takes your custom collection classes as an option, `collections`, and uses them on `db.orm`, on the ORM of every transaction (`tx.orm`), on every connection a serverless client opens, and on every Supabase role-bound client: `postgres({ contract, url, collections: { Post: PostCollection } })`, then `db.orm.public.Post.published()`. Extension code, examples and tests that build their own ORM client with `orm({ runtime, context, collections })` to reach custom classes still work; replace them with the option and use the client's ORM. The detection matches a call to `orm({ ... })`, or to `orm` imported under another name, that passes `collections`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])orm\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?,)?\s*collections\s*[,}:]'
        - '(?<![\s\S])(?:(?!import\s*\{[^{}]*\borm\s+as\s+[\w$]+[^{}]*\}\s*from\s*[''\"][^''\"]+[''\"])[\s\S])*import\s*\{[^{}]*\borm\s+as\s+([\w$]+)[^{}]*\}\s*from\s*[''\"][^''\"]+[''\"][\s\S]*(?<![\w$.])\1\s*(?:<[^<>()]*(?:<[^<>()]*>[^<>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?,)?\s*collections\s*[,}:]'
  - id: client-query-and-to-sql
    summary: |
      Additive for code that only uses these types. Every SQL client gets `query(plan)` and `execute(plan)`, with the types a transaction's have, and `toSql(plan)`, which returns `{ sql, params }` with no database. A serverless connection gets `query` and `execute` too; the serverless client, `postgresStatic()`, `sqliteStatic()` and every transaction get `toSql`. `postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take `mode: 'strict' | 'permissive'`. `supabase()` creates its pool on the first query instead of when it is called. Extension code, examples and tests can move from `db.runtime().query(plan)` to `db.query(plan)`; code that builds its own object of one of the changed types, such as a test double, must add the new members. The detection matches a file that imports one of the changed types from a Prisma package, calls `runtime().query(` or `runtime().execute(`, or reads the renamed error details or the old message texts.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - 'import\s*(?:type\s*)?(?:[\w$]+\s*,\s*)?\{[^}]*(?<![\w$])(?:PostgresClient|PostgresServerlessClient|PostgresServerlessConnection|PostgresStaticContext|PostgresStaticMembers|SqliteClient|SqliteStaticContext|RoleBoundDb|ServiceRoleDb|SupabaseInternalDb|PostgresTransactionContext|SqliteTransactionContext)(?![\w$])[^}]*\}\s*from\s*[''"]@prisma/orm-'
        - '\.runtime\(\)\s*\.(?:query|execute)\('
        - '(?<![\w$])(?:runtimeTarget|runtimeStorageHash)\s*:|\.(?:runtimeTarget|runtimeStorageHash)\b|[''"](?:runtimeTarget|runtimeStorageHash)[''"]'
        - 'Ad-hoc execute received a bind-site slot|Plan target does not match runtime target|Plan storage hash does not match runtime contract'
  - id: transaction-query-members
    summary: |
      Additive for code that only uses these types: a transaction now offers the client's query members (`sql`, `orm`, `raw`, `prepare`, `query`, `execute`) on every SQL client, a Supabase role-bound client gains `prepare`, and SQLite's `db.orm` gains `fragment`. Code that builds its own object of one of the changed types must add the new members. Changed: `PostgresTransactionContext` (adds `raw` and `prepare`), `SqliteTransactionContext` (adds `raw` and `prepare`; `orm` is now `SqliteOrm`), `RoleBoundDb` (adds `prepare`; `transaction` passes a `SupabaseTransactionContext`). New: `PostgresQueryMembers` and `SqliteQueryMembers` (the query members a client and its transactions share), `SupabaseTransactionContext`, `SqliteOrm`, and from the ORM client `OrmClientRootMembers` and `PrepareMember`. The detection matches a file that imports one of the changed types that 8.0.0-rc.18 had, or `SqliteClient`, whose `orm` changed, from a Prisma package.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - 'import\s*(?:type\s*)?(?:[\w$]+\s*,\s*)?\{[^}]*(?<![\w$])(?:PostgresTransactionContext|SqliteTransactionContext|SqliteClient|RoleBoundDb)(?![\w$])[^}]*\}\s*from\s*[''"]@prisma/orm-'
  - id: runtime-activity-is-activity
    summary: |
      `RuntimeActivity` is renamed `Activity`, with no alias. It is the type of the `activity` parameter of `activityStarted`, `activityEnded` and `activityFinalized`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bRuntimeActivity\b'
  - id: activity-includes-client-activities
    summary: |
      `Activity` is `StatementActivity | TransactionActivity | ClientActivity`, and `ActivityEndedResult` includes `ClientActivityEnded`, in every program. A client activity's kind contains a hyphen, such as `orm-call`. A hook that narrows by ruling out `'transaction'` and then reads statement fields no longer compiles. Narrow by the kind you handle, such as `if (result.kind !== 'statement') return;`, and ignore kinds you do not know.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bif\s*\(\s*[\w$.]+\.kind\s*===\s*[''"]transaction[''"]\s*\)\s*(?:\{\s*)?(?:return|continue)\b'
  - id: start-a-client-activity
    summary: |
      An extension can start an activity of its own kind with `startActivityOn(queryable, { kind, contentHash, annotations? })`, where `contentHash` is a function returning a promise of the digest, for example `() => planContentHashOn(queryable, plan)`; middleware read it with `activity.contentHash()`, which computes it once per activity and only when asked. The extension sends statements through the returned handle and must end every handle with `end({ outcome, result? })`, in a `finally`; an open handle keeps `close()` waiting. A middleware can supply the activity's result through `intercept.onActivity(activity, ctx)`. Registering the kind in `ClientActivityRegistry` types the handle's `intercepted.result` and `end({ result })`; in middleware hooks the result stays `unknown`.
  - id: runtime-connections-carry-an-activity-source
    summary: |
      The SQL runtime's queryables start client activities through an `activitySource` member, keyed by a symbol so the public queryable types do not show it, which `startActivityOn` and `planContentHashOn` read. A connection-like object that a `SqlRuntimeBase` subclass builds over a raw connection adds `[activitySource]: this.connectionActivitySource(connection, () => session)`, and `ActivitySourceTarget` to the object's declared type, so activities can start on it. The public `RuntimeConnection` type does not require it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*\[activitySource\])[\s\S]*\[transactionStart\]\s*:'
  - id: begin-transaction-on-takes-a-parent
    summary: |
      `SqlRuntimeBase.beginTransactionOn(connection, owner)` takes a third argument, `parent`: the activity the transaction starts beneath, or `undefined`. Pass `undefined` where you began a transaction before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bbeginTransactionOn\s*\(\s*[^,()]+,\s*[^,()]+\)'
  - id: transaction-activity-takes-a-parent
    summary: |
      `startTransactionActivity` requires `parent` (the activity the transaction starts beneath, or `undefined`). An `ActivityParent` has `acceptsChildren()`, and its `adopt(child)` returns an `ActivityChildSlot` (`statementFailed()`, `ended(own)`, `transactionAcceptsChildren()`) instead of an end callback; `ActivityParent.activity` is an `ActivityBase`. A transaction stops accepting children with `stopAcceptingChildren()`, and adopting beneath a parent that no longer accepts children throws `RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN` instead of an internal error.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bstartTransactionActivity\s*\(\s*\{(?![^{}]*\bparent\b)'
        - '(?<![\s\S])(?![\s\S]*\bActivityChildSlot\b)(?=[\s\S]*\bActivityParent\b)[\s\S]*\badopt\s*\('
  - id: orm-runtime-objects-carry-an-activity-source
    summary: |
      The ORM reaches activities only through `startActivityOn` on the queryable it holds, and every ORM terminal method on a queryable without an `activitySource` member fails with `ORM.ACTIVITY_SOURCE_MISSING` (see `queryable-carries-the-activity-source`). `db.runtime()` passed straight to `orm()` carries one. A facade, such as `postgres()`, that builds its own ORM runtime object, such as one that looks up its runtime on every call, adds `[activitySource]: delegatingActivitySource(() => runtime)` from `@prisma/orm-family-sql/runtime`, for the runtime and for the context of `db.transaction(fn)`. Where the facade's statements run through sessions of its own, such as role sessions, give an activity source whose statements go the same way.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*\[activitySource\])[\s\S]*(?<![\w$.])orm\s*(?:<[^>()]*>)?\(\s*\{(?:[^{}]|\{[^{}]*\})*?\bruntime\s*:\s*\{'
  - id: orm-annotations-on-the-call
    summary: |
      Every SQL ORM terminal method runs as one `orm-call` client activity, and the annotations a `configure` callback records live on that activity. The statements the call sends carry only the reserved keys the ORM sets, so a middleware that reads an ORM annotation from a statement plan (`handle.read(plan)` or `plan.meta.annotations`) finds nothing. Read it from the call: in `activityStarted(activity)` or `intercept.onActivity(activity)`, `if (activity.kind === 'orm-call') handle.read(activity)`. A middleware can answer the call through `intercept.onActivity`; the value must have the shape the terminal returns, or the ORM rejects with `ORM.INTERCEPTED_RESULT_INVALID`. The detection matches a file with a middleware hook, not a MongoDB one, that reads an annotation from something other than the activity, or reads `meta.annotations`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?:familyId:\s*[''"]mongo[''"]|\bMongoMiddleware\b))(?=[\s\S]*\b(?:beforeEncode|beforeCompile|onQuery|onExecute|onRow|activityStarted)\b)[\s\S]*\.read\(\s*(?!activity\b)[\w$]+(?:\.[\w$]+)*\s*\)'
        - '(?<![\s\S])(?![\s\S]*(?:familyId:\s*[''"]mongo[''"]|\bMongoMiddleware\b))(?=[\s\S]*\b(?:beforeEncode|beforeCompile|onQuery|onExecute|onRow|activityStarted)\b)[\s\S]*\bmeta\.annotations\b'
  - id: cache-store-holds-cached-values
    summary: |
      A cache store for `@internal/middleware-cache` holds `CachedValue`, `{ kind: 'statement-rows', rows } | { kind: 'call-result', result }`, not `CachedRows`; `CacheStore` and `CacheEntry` default their value type to `CachedValue`, and `createCacheMiddleware` accepts only a `CacheStore<TMeta, CachedValue>`. Type a custom store with `CachedValue`, and make `get` give back a value equivalent to the one `set` was given, `kind` included. An ORM call's result holds decoded values such as `Date`, `bigint`, Temporal values and extension class instances, so a store that serializes needs a serializer that rebuilds them; JSON does not. `createInMemoryCacheStore` takes only the meta type now and always holds `CachedValue`: drop its second type argument. The detection matches a file that names `CachedRows`, or imports from the cache package and names `CacheStore` or `CacheEntry` but not `CachedValue`, or passes `createInMemoryCacheStore` a second type argument.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCachedRows\b'
        - 'createInMemoryCacheStore<[^>(]*,'
        - '(?<![\s\S])(?![\s\S]*\bCachedValue\b)(?=[\s\S]*[''"](?:@prisma/orm-extension-middleware-cache|@internal/middleware-cache)[''"])[\s\S]*(?<![\w$])(?:CacheStore|CacheEntry)(?![\w$])'
  - id: queryable-carries-the-activity-source
    summary: |
      The SQL ORM starts its `orm-call` activity on the queryable it was given, through the queryable's `activitySource` member, and sends every statement through the activity's handle. A wrapper that copies a runtime, connection or transaction to intercept its `query` and `execute` (for example to record plans) also copies the `[activitySource]` member, so ORM statements bypass the wrapper. Wrap the activity source too: return a source whose `startActivity` wraps each handle the same way, including the transaction its `transaction()` returns. A custom queryable passed to the ORM must carry an activity source: without one, every terminal method fails with `ORM.ACTIVITY_SOURCE_MISSING` (streaming terminals throw when called, the others reject). A test stub can use `delegatingActivitySource(() => realRuntime)`, or a source whose handles send their statements to the stub.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.\.\.\s*[\w$.]+(?:\(\))?\s*,(?:[^{};\[\]]|\{(?:[^{}]|\{[^{}]*\})*\})*?(?<![\w$.])(?:async\s+)?(?:query|execute)\s*(?:[:(<])'
  - id: aggregate-operation-using-reserved
    summary: |
      Every ORM collection has a `using` member, so `orm()` refuses a contributed aggregate operation named `using` with `ORM.AGGREGATE_OPERATION_RESERVED`, as it refuses `with` and `fragment`. An extension that contributes an aggregate operation named `using` renames it. The detection matches a file that names an aggregate operation `using`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\boperation\s*:\s*[''"`]using[''"`]'
  - id: codecs-read-wire-and-data-type-values
    summary: |
      A codec implements `toWire`, `fromWire`, `toDataTypeValue` and `fromDataTypeValue` instead of `encode`, `decode`, `encodeJson` and `decodeJson`. Its constructor names its data type and parameters (`super(descriptor, dataType, params)`), and it builds the value it hands over with `this.dataTypeValueOf(json)`. A Mongo codec made with `mongoCodec()` takes the same four options in place of `encode`, `decode`, `encodeJson` and `decodeJson`, and a required `dataType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:encodeJson|decodeJson)\s*\('
        - '\basync\s+(?:encode|decode)\s*\('
        - '\b(?:encode|decode)\s*:\s*(?:async\s*)?\('
        - '\b(?:encodeJson|decodeJson)\s*:'
  - id: data-types-own-parameter-limits
    summary: |
      Every data type declares a `read` function, which reads and checks each stored value under the column's parameters. It replaces the `toCanonicalForm` hook of a data type or codec descriptor, and limits a parameter sets, such as a vector's length or a geometry's SRID, move from the codec to the data type. The detection matches `toCanonicalForm`, and a `sqlDataType`, `mongoDataType` or `dataType` call whose options have no `read` or are passed as a variable.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\btoCanonicalForm\b'
        - '(?<![\w$.])(?:sqlDataType|mongoDataType|dataType)\(\s*[^,()]+,\s*\{(?!(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\bread\b)'
        - '(?<![\w$.])(?:sqlDataType|mongoDataType|dataType)\(\s*[^,()]+,\s*(?!\{)[\w$]+\s*\)'
  - id: json-helpers-renamed
    summary: |
      The JSON helpers in `@prisma/orm-framework/components/codec` are renamed from `decodeJson*` to `readJson*` (`readJsonString`, `readJsonMatching`, `readJsonInteger`, `readJsonIntegerText`, `readJsonFloat`, `readJsonBoolean`), and `encodeJsonFloat` to `floatToJson`. `ToCanonicalForm` and `canonicalFormOf` are removed.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:decodeJson(?:String|Matching|Integer|IntegerText|Float|Boolean)|encodeJsonFloat|canonicalFormOf|ToCanonicalForm)\b'
  - id: stored-form-helpers-renamed
    summary: |
      The SQL helpers that read or write a value's stored text say "stored" instead of "canonical": `canonicalDateTime` is `dateTimeStoredText`, `CanonicalDateTimeOptions` is `DateTimeStoredTextOptions`, `canonicalNumeralText` is `storedNumeralText`, `sqlTextFromCanonical` is `sqlTextFromStored`, and `canonicalSqlText` is `storedSqlText`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:canonicalDateTime|CanonicalDateTimeOptions|canonicalNumeralText|sqlTextFromCanonical|canonicalSqlText)\b'
  - id: projections-read-by-from-wire
    summary: |
      An include and an aggregate read a column's JSON projection with the codec's `fromWire`, as a row is read, so a descriptor's `jsonProjection` writes the value the driver returns for a row, often `CAST(x AS text)`, instead of the codec's JSON form.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bjsonProjection\s*\('
  - id: empty-result-json-renamed-empty-result-wire
    summary: |
      An aggregate descriptor's `emptyResultJson` is renamed `emptyResultWire`, and holds the value the driver would return, which the result codec reads with `fromWire`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bemptyResultJson\b'
  - id: target-codec-adapters-take-a-factory
    summary: |
      `postgresCodec` (`@prisma/orm-postgres/target/codec-descriptor`) and `sqliteCodec` (`@prisma/orm-sqlite/target/codec-descriptor`) require a `factory` option, and it receives the option's `dataType` between the descriptor and the column's parameters: `factory: (descriptor, dataType, params) => () => new MyCodec(descriptor, dataType, params)`. Before, `factory` was optional and took `(descriptor, params)`, and a call without it built the family template's codec. A family template names no data type, so it builds no codec of its own. `sqliteCodec` no longer takes `renderTypes`. The detection matches a call without `factory`, a `factory` whose second parameter is not the data type, and `renderTypes: false`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:postgresCodec|sqliteCodec)\(\s*[\w$.]+\s*,\s*\{(?!(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\bfactory\b)'
        - '\b(?:postgresCodec|sqliteCodec)\(\s*[\w$.]+\s*,\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?\bfactory\s*:\s*(?:\(\s*(?:[\w$]+\s*(?::\s*[^,()]+)?)?\)|\(\s*[\w$]+\s*(?::\s*[^,()]+)?,(?!\s*_?dataType\b)\s*[^,()]+\)|(?!\()[\w$]+)\s*=>'
        - '\brenderTypes\s*:\s*false\b'
  - id: family-codec-templates-render-no-literals
    summary: |
      `postgresCodec` and `sqliteCodec` now throw an `InternalError` when the family codec template they adapt declares `renderValueLiteral`. Earlier versions copied the template's renderer. A family template renders no literal, because only the target knows the form its data type stores a value in. Remove `renderValueLiteral` from the template and pass it in the adapter's options instead; the framework exports `renderTsLiteral`, `floatNumberLiteral`, `decimalTextNumberLiteral` and `decimalTextBigintLiteral` from `@internal/framework-components/codec` for the common stored forms.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+CodecDescriptorTemplateImpl\b)(?=[\s\S]*\brenderValueLiteral\s*\()'
  - id: enum-block-written-values
    summary: |
      A parsed PSL extension block now records each literal entry as it is written in `writtenValues`, a `WrittenScalar` by key, in place of `numberTexts`, which held only the source text of number entries. `AuthoringEntityContext.readWrittenNumber` is replaced by `readWrittenValueForCodec`, which takes a `WrittenScalar` as `written` in place of the number's `text`, and reads any written value, not only a number, by the cast rule. A refused `WrittenValueReading` now carries the diagnostic `code` with its `message`. `enumMemberValue()` yields a tagged member as its `WrittenScalar` in place of `null`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:numberTexts|readWrittenNumber|WrittenValueReading)\b'
  - id: type-lookups-one-framework-type
    summary: |
      `SqlTypeLookups` (from `@prisma/orm-family-sql/contract/data-type`) and `MongoTypeLookups` (from `@prisma/orm-family-mongo/contract/data-type`) are removed. Use `TypeLookups` from `@prisma/orm-framework/components/codec`, the same pair of `codecLookup` and `dataTypeLookup`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:SqlTypeLookups|MongoTypeLookups)\b'
  - id: type-name-normalisers-removed
    summary: |
      `normalizeSchemaNativeType` (from `@prisma/orm-postgres/target/native-type-normalizer` and `@prisma/orm-postgres/adapter/control`) and `normalizeSqliteNativeType` (from `@prisma/orm-sqlite/adapter/control`) are removed. Columns are compared by their data type and its parameters, so no type name needs normalising.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:normalizeSchemaNativeType|normalizeSqliteNativeType)\b'
  - id: introspected-type-text
    summary: |
      In `@prisma/orm-postgres/target/native-type-normalizer`, `introspectedNativeType` is renamed `introspectedTypeText` and `IntrospectedNativeType` is renamed `IntrospectedTypeText`; its result holds `typeText` (the type the database reports) and `many`, and no `resolvedNativeType`. `CatalogColumnType.dataType` is renamed `informationSchemaType`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:introspectedNativeType|IntrospectedNativeType|CatalogColumnType)\b'
  - id: schema-ir-column-type-text
    summary: |
      `SqlColumnIR` and `SqlColumnIRInput` (`@prisma/orm-family-sql/schema-ir/types`): `nativeType` is renamed `typeText`, and `resolvedNativeType` and `codecBaseNativeType` are removed. `dataType` is removed: a column's type is its `storedType` and `storedTypeParams`, and nothing compares `typeText`. A column built by hand compares equal to another only when it has `storedType` and `storedTypeParams`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:resolvedNativeType|codecBaseNativeType)\b'
        - '(?<![\s\S])(?=[\s\S]*(?:\bSqlColumnIR|\bSqlTableIR|\bSqlSchemaIR|schema-ir))[\s\S]*\bnativeType\b'
  - id: default-resolver-takes-the-column
    summary: |
      A `DefaultResolver` (`@prisma/orm-family-sql/family/control`) receives the column, `{ typeText, many }`, as its second argument instead of the resolved type name. `parsePostgresDefault(raw, nativeType?)` (`@prisma/orm-postgres/target/default-normalizer`, `@prisma/orm-postgres/adapter/control`) is replaced by `readPostgresDefault(raw, many)` from `@prisma/orm-postgres/target/default-normalizer`, which takes whether the column is a list and returns a `PostgresReportedDefault`, `{ kind: 'function', expression } | { kind: 'null' } | { kind: 'literal', literal }`, instead of a `ColumnDefault` or `undefined`. `parseSqliteDefault(raw, nativeType?)` (`@prisma/orm-sqlite/target/default-normalizer`, `@prisma/orm-sqlite/adapter/control`) is replaced the same way by `readSqliteDefault(raw, declaredType)`, which returns a `SqliteReportedDefault`. The optional `normalizeDefault` member of `SqlControlAdapter`, which nothing called, and its type `DefaultNormalizer` are removed.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:parsePostgresDefault|parseSqliteDefault|DefaultNormalizer|normalizeDefault)\b'
        - '(?<![\s\S])(?![\s\S]*\.(?:many|typeText)\b)[\s\S]*\bDefaultResolver\b'
  - id: alter-type-postcheck-by-data-type
    summary: |
      In `@prisma/orm-postgres/target/planner-sql-checks`, `buildExpectedFormatType` and `alterTypeCheckText` are removed. `alterTypeCheck(type, dataTypes, where)` returns how the `ALTER COLUMN TYPE` postcheck recognises the new type, a `ColumnTypeCheck`: `{ kind: 'catalog-text', text }`, the text `format_type` prints, or for an enum `{ kind: 'identity', typeName, many }`, checked with `to_regtype` whatever schema the enum is in. The `checkType` field of `AlterColumnTypeCall` (`@prisma/orm-postgres/target/op-factory-call`) is now a `ColumnTypeCheck` instead of a string. `AddColumnCall`, `AddRequiredColumnToEmptyTableCall` and `AddColumnWithTemporaryDefaultCall` gain a `checkType` of `ColumnTypeCheck | undefined`, `undefined` when no data type of the stack reads the column's type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:buildExpectedFormatType|alterTypeCheckText)\b'
  - id: control-adapters-take-declared-data-types
    summary: |
      `PostgresControlAdapter` (`@prisma/orm-postgres/adapter/control`) and `SqliteControlAdapter` (`@prisma/orm-sqlite/adapter/control`) take the stack's declared data types as a new last constructor argument, because introspection resolves each column's reported type over them. Pass the target's `postgresDataTypes` or `sqliteDataTypes` (from `/target/data-types`), or, when the stack has extensions, the stack's types: `stack.declaredDataTypes.map(({ type }) => type)`. Code that leaves it out fails to compile, and untyped JavaScript fails at the first introspection.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\bnew\s+(?:Postgres|Sqlite)ControlAdapter\s*\('
  - id: resolved-sql-type-carries-the-data-type
    summary: |
      `resolveReportedSqlType` and `resolveWrittenSqlTypes` (`@prisma/orm-family-sql/contract/data-type`) return the data type they found in `dataType`, a `SqlDataType`, instead of its id. Read `resolved.dataType.id` where you read `resolved.dataType`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bresolve(?:ReportedSqlType|WrittenSqlTypes)\b)[\s\S]*\.dataType\b(?!\s*\.)'
  - id: value-arguments-name-a-data-type
    summary: |
      A type constructor's argument that is a value is declared `{ kind: 'value', dataType }`, naming the data type the argument's value belongs to, such as `pg/int4` for a Postgres length, precision, scale or SRID. The argument kinds `string`, `boolean` and `stringArray` are removed, and a type constructor's `number` argument becomes a `value` argument. Drop `integer`, `minimum` and `maximum`: the data type's parameter schema checks the value. Assembly refuses a type constructor argument of any other kind, `option` and `object` included. A field preset keeps its `number`, `option` and `object` arguments, so a match inside a field preset needs no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'kind:\s*[''"](?:number|string|boolean|stringArray)[''"](?=[^}]*\b(?:name|integer|minimum|maximum|optional)\s*:)'
        - '\b(?:name|integer|minimum|maximum|optional)\s*:[^{}]*\bkind:\s*[''"](?:number|string|boolean|stringArray)[''"]'
        - '\{\s*kind:\s*[''"](?:number|string|boolean|stringArray)[''"]\s*\}'
  - id: value-argument-types-in-typescript
    summary: |
      The TypeScript builder types a `value` argument through `__dataTypeArguments`, a map a pack declares in its type from each data type it registers to `{ argument, parameter }`: the TypeScript value an author passes, and the type parameter it gives. A pack that registers a data type its own type constructors take must declare it, or the argument types as `never`. The TypeScript builder reads value arguments only with the data types and authoring entries the composed packs register, so every data type an argument takes must be registered, with a writable `authoring.dataTypes` entry, by some pack in the stack: the family, the target or an extension. An extension whose arguments take a target's data type, such as `pg/int4`, registers nothing; registering it again is refused as a duplicate.
  - id: psl-and-print-helpers-take-data-types
    summary: |
      `mapPslHelperArgs` and `instantiatePslFieldPreset` take the stack's `dataTypes`, and `parsePslPositionalArgs` is removed. The new `writtenTypeArguments` writes a call's arguments as literals of their data types. `sql.String` is no longer in the SQL family pack: a SQL target contributes it with `sqlTargetTypeConstructors({ sizeType })` from `family/pack`, and `temporalCodecPresetWithPrecision` takes `sizeType` too. `temporalCodecPresetWithPrecision` and `temporalStringAuthoringPresets` move from `family/control` to `family/pack`, so a target pack does not load the family's control entry point. `assembleAuthoringDataTypes` moves from `components/control` to `components/authoring`, beside `assembleDataTypeSupport`, which builds a `DataTypeSupport` from a list of components and checks their value arguments.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bparsePslPositionalArgs\b|\b(?:mapPslHelperArgs|instantiatePslFieldPreset)\(\s*\{(?![^{}]*\bdataTypes\b)'
        - 'import\s*(?:type\s*)?\{[^}]*\b(?:assembleAuthoringDataTypes|temporalCodecPresetWithPrecision|temporalStringAuthoringPresets)\b[^}]*\}\s*from\s*[''"][^''"]*/(?:components|family|family-sql)/control[''"]'
  - id: composed-helpers-take-no-data-type-lookup
    summary: |
      `createComposedAuthoringHelpers` no longer takes `dataTypeLookup`. It builds its data types from the family, target and extension packs it is given, with `assembleDataTypeSupport`. Remove the option. Every data type an argument takes must be registered, with an `authoring.dataTypes` entry, by some pack in the stack; an extension whose arguments take a target's data type, such as `pg/int4`, registers nothing.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'createComposedAuthoringHelpers\(\{[^}]*\bdataTypeLookup\b'
  - id: helper-codec-invariants
    summary: |
      `enforceDataTypeInvariants` is renamed `enforceHelperCodecInvariants`, and `DataTypeInvariantInput` is renamed `HelperCodecInvariantInput`. It now checks only type constructors and field presets against the stack's codecs, and takes `lookup`, `helpers` (formerly `constructors`) and `codecDescriptorFor`. `declaredTypes`, `codecs` and `authoringEntries` are removed: `assembleDataTypeSupport` checks data types, their entries, casts and written forms, through `enforceDataTypeAssemblyInvariants`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'enforceDataTypeInvariants|DataTypeInvariantInput'
  - id: default-functions-lower-to-database-defaults-only
    summary: |
      A default function in `controlMutationDefaults.defaultFunctionRegistry` can no longer lower to a client generator: `LoweredDefaultValue` has only its `{ kind: 'storage' }` arm. A function that generated a value in the client, such as `slugid()`, becomes a generator function: contribute a `GeneratorFunctionContribution` in `generatorFunctions` on the pack ref and the control descriptor, with a binding for each codec it fills, and keep the generator descriptor. Users then write `@onCreate(slugid())` instead of `@default(slugid())`. The detection matches files that lower a default function to a generator.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "kind:\\s*'execution'"
  - id: applicable-codec-ids-and-build-phases-removed
    summary: |
      `MutationDefaultGeneratorDescriptor.applicableCodecIds` and `buildPhases` are removed. A binding of a generator function declares the codecs it fills and the arguments `contract print` writes for each generator it produces. Delete the removed fields. The detection matches files that set them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'applicableCodecIds\s*:'
        - 'buildPhases\s*:'
  - id: sql-family-registers-identifier-generators
    summary: |
      The SQL family now registers the identifier generators `uuidv4`, `uuidv7`, `cuid2`, `ulid`, `nanoid` and `ksuid`. A target, adapter or extension that registers one of them in `generatorDescriptors` must stop: two components that register one generator fail with `CONTRACT.PACK_CONTRIBUTION_INVALID`. An extension that binds `uuid` or another identifier function to its own codec keeps the binding and drops the registration. `builtinGeneratorRegistryMetadata` from `@prisma/orm-framework/ids` is removed; delete its use. The detection matches files that register the built-in identifier generators.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'builtinGeneratorRegistryMetadata'
        - "\\{\\s*id:\\s*['\"](?:uuidv4|uuidv7|cuid2|ulid|nanoid|ksuid)['\"]\\s*\\}"
  - id: sql-target-declares-integer-argument-generators
    summary: |
      A SQL target declares the generator functions its columns take, in `generatorFunctions` on both its pack ref and its control descriptor, which 8.0.0-rc.18 did not have. The arguments of `uuid`, `cuid` and `nanoid` are values of the target's integer data type, which only the target knows, so the target spreads `sqlIntegerArgumentGeneratorFunctions({ integer })` from `@prisma/orm-family-sql/family/pack`, and binds the identifier functions to its text codecs with `idGeneratorFunctionBindings`. Without the first, composing a stack fails with `CONTRACT.PACK_CONTRIBUTION_INVALID`: `"sql" binds generator function "uuid", which no component declares.` The detection matches a SQL target descriptor that does not name `sqlIntegerArgumentGeneratorFunctions`; check the file that builds the target's `generatorFunctions`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*\bsqlIntegerArgumentGeneratorFunctions\b)(?=[\s\S]*\bfamilyId:\s*[''"]sql[''"])[\s\S]*\bkind:\s*[''"]target[''"]'
  - id: generator-signature-from-data-types
    summary: |
      The `signature` of a default function in a `defaultFunctionRegistry` entry may now be a function of the stack's data types that returns the `FuncCallSig`, as may the `signature` of a `GeneratorFunctionContribution`. Code that reads an entry's `signature` as a `FuncCallSig`, such as `funcCall(name, entry.signature as FuncCallSig)`, builds the call with `defaultFunctionCall(name, entry, dataTypes)` from `@prisma/orm-family-sql/contract-psl/attribute-specs` instead. A plain object still works. The detection matches a file that names `defaultFunctionRegistry` and reads a `signature`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bdefaultFunctionRegistry\b)[\s\S]*\.signature\b'
  - id: generator-function-field-length
    summary: |
      Nothing to change in code written against 8.0.0-rc.18, which has no generator function registry. A binding you write for `default-functions-lower-to-database-defaults-only` receives the column as `GeneratorFunctionField` (`@prisma/orm-framework/components/components`), whose `length` is the column's length in its data type's normal form, so a bare `Char` gives 1, or `undefined` for a column with no length or one whose database does not limit it, such as SQLite's. The built-in identifier bindings refuse a column shorter than what they write, and a binding of your own can read `length` to do the same. Code that calls `resolve` or `callFor` on a generator function registry passes it; for a SQL column, `sqlCodecColumnLength(dataTypes, codecId, typeParams)` from `@prisma/orm-family-sql/contract/data-type` computes it.
  - id: build-contract-definition-takes-lookups
    summary: |
      `buildContractDefinition` (`@prisma/orm-family-sql/contract-ts/contract-builder`) now requires `codecLookup` and `dataTypeLookup`, the same lookups `buildSqlContractFromDefinition` takes, so that each `.onCreate(...)` and `.onUpdate(...)` call is checked against its column's length. Pass them in the definition. The detection matches files that call `buildContractDefinition`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bbuildContractDefinition\('
  - id: arg-binding-spec-label
    summary: |
      `ArgBindingSpec` (`@prisma/orm-framework/psl-parser`), the second argument of `interpretArgs`, names its callee with `label`, the whole phrase such as `Attribute "rel"`, instead of `name`. `funcCall(name, signature, { label })` takes the phrase its binding diagnostics use; without it they say `Attribute "<name>"` as before.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\binterpretArgs\s*\('
        - '\bArgBindingSpec\b'
  - id: one-of-refuses-data-type-value
    summary: |
      `oneOf` (`@prisma/orm-framework/psl-parser`) throws an `InternalError` when one of its arms is a `dataTypeValue`. Give the value its own parameter, or use it as a parameter of a `funcCall` arm.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\boneOf\([^;]*\bdataTypeValue\('
  - id: text-data-types
    summary: |
      A component's authoring contributions may name `textDataTypes`, the data types whose values are text; a SQL target names its own. A SQL `@@discriminator` field must be stored in one of them. An extension that adds a text type names it there to make it a discriminator.
  - id: typescript-contract-pack-type-slots
    summary: |
      A contract built with `defineContract` reads its types from the packs in it. A third-party SQL pack is typed fully for such a contract only when it declares what an emitted `contract.d.ts` would get from its codecs and descriptors: `__queryOperationTypes` for its query operations, `__parameterizedOutputTypes` for codecs whose output type depends on their type parameters, literal-typed `types.aggregateDescriptors` for its aggregates, and exports from its `/pack` entry for the types an application's exported contract names. Nothing breaks for a pack that does none of this; its operations, refined output types and aggregates are missing from a `defineContract` contract's types, as before. The detection matches SQL pack metadata that declares codec types.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '__codecTypes\?:'
  - id: parameterized-output-types-declared-once
    summary: |
      A codec whose output type depends only on its column's type parameters, such as `Vector<3>` for `vector(3)`, declares that type once, as a type function the pack exports, and no longer implements `renderOutputType`. The emitted `contract.d.ts` applies the type function, and so does a contract built with `defineContract`. A pack must name the function twice: in its codec types' metadata as `types.codecTypes.parameterizedOutputTypes`, an import spec like `types.codecTypes.import`, which the emitter reads, and in its pack metadata's type as `__parameterizedOutputTypes`, which `defineContract` reads; if one is missing, that path types the column by the codec's plain output type without an error. `ParameterizedOutputTypesFunction` comes from `@prisma/orm-framework/contract/types`. A `renderOutputType` that writes such a type still works for the emitted file but is ignored by `defineContract`; remove it, with the `typeImports` entry it needed, once the type function exists. Keep `renderOutputType` only for a type no type function can compute, such as an arktype schema's text. The detection matches codec descriptors that implement `renderOutputType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'renderOutputType\('
        - 'renderOutputType:'
  - id: psl-interpreter-contract-capabilities
    summary: |
      `interpretPslDocumentToSqlContract` now writes the enabled capabilities it is given in `capabilities` into the contract it returns, joined with the target's and the extensions', so a contract read from PSL carries its adapter's capabilities as one built with `defineContract` does. Before, it used them only to check the schema and left them out of the contract. Code that called it directly and compared the contract's `capabilities` to the target's and extensions' alone now also sees the ones it passed in. The detection matches calls of the interpreter.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'interpretPslDocumentToSqlContract\('
  - id: field-types-expression-removed
    summary: |
      Nothing to change in code written against 8.0.0-rc.18: the `fieldTypesExpression` hook of `EmissionSpi` was added and removed between 8.0.0-rc.18 and 8.0.0-rc.19. The emitter writes `FieldOutputTypes` and `FieldInputTypes` for every family as `FieldTypesFromDomain` applied to the emitted contract, and declares `FieldTypeOverrides` and `ParameterizedOutputTypeFunctions` itself.
  - id: field-types-generic-moved
    summary: |
      Nothing to change in code written against 8.0.0-rc.18, which has no `FieldTypesFromDomain`. Code written against a development build after it imports `FieldTypesFromDomain` and `ValueTypeSide` from `@prisma/orm-framework/contract/types` instead of the SQL family contract types entry. The generic types value object and union fields itself, from the namespace's `valueObjects`. Its arguments are `FieldTypesFromDomain<DomainNamespaces, CodecTypes, ParameterizedOutputs, Overrides, Side>`, where `Overrides` is one map keyed like the domain, `[namespace]['models' | 'valueObjects'][owner][field]`, each entry `{ output?, input? }`; `ValueObjectTypesFromDomain` takes the same map. A storage type map can type one entry with `StoredValueType` from the same entry. `ColumnTypesFromStorage` stays in the SQL family.
  - id: resolve-field-value-set-renamed
    summary: |
      `EmissionSpi.resolveFieldValueSet` is renamed `resolveStorageValueSet`. The framework emitter now reads a field's value set itself when the field references a domain enum (`valueSet.plane` is `'domain'`), for model and value object fields alike, and no longer calls the hook for those fields. It calls `resolveStorageValueSet` only for other model fields, whose values the family keeps in its storage, such as a SQL column's value set. Rename the hook in a family emitter, and drop any handling of domain enum references from it. The detection matches implementations of the old hook.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bresolveFieldValueSet\s*[(:?]'
  - id: mongo-parameterized-output-types
    summary: |
      A Mongo-family pack whose codec output type depends only on a field's type parameters, such as `Vector<3>` for a vector of length 3, declares it once as a type function, as SQL packs do: export a `ParameterizedOutputTypesForTypeParams` interface extending `ParameterizedOutputTypesFunction` from its `codec-types` entry, name it in `types.codecTypes.parameterizedOutputTypes` where the codec types import is declared, and add `__parameterizedOutputTypes` to the pack metadata's type. `renderOutputType` is no longer used for such codecs: Mongo's vector codec no longer implements it, and a Mongo `defineContract` contract ignores it. Export the types the pack metadata names from its `/pack` entry, so an application that exports a contract can build declarations. The detection matches files that import a Mongo package and implement `renderOutputType`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(mongo|family-mongo|target-mongo)\b)[\s\S]*renderOutputType'
  - id: mongo-model-storage-fields
    summary: |
      A MongoDB model's `fields` are keyed by field name, and `model.storage.fields` records the key each field is stored under: `MongoModelStorage` gains a required `fields: Record<string, { field: string }>`, with an entry for every field. `on.localFields`, `on.targetFields` and `discriminator.field` name fields; indexes, validators and execution default refs name stored names. Code that read `model.fields` keys as document keys reads stored names through the helpers `@internal/mongo-contract` exports: `ownStoredNamesOf`, `ownStoredNameOf`, `ownFieldStoredAs`, `hasOwnFieldStoredAs`, `ownEmbedStoredNamesOf`, `ownDocumentIdFieldOf`, `storedNamesOf`, `modelAndBasesOf`, `valueObjectStoredNamesOf` and `mongoModelsOf`, and at the type level `OwnStoredNameOf` and `OwnFieldStoredAs`. An embed relation is stored under its `storage.relations` entry, or its own name. A hand-built MongoDB contract or model storage type adds `fields`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,json}"
      matches:
        - 'MongoModelStorage|MongoModelDefinition'
        - '"storage"\s*:\s*\{\s*(?:"collection"\s*:\s*"[^"]*"\s*)?\}'
        - '(?<![\w$])storage\s*:\s*\{\s*(?:readonly\s+)?collection\s*:\s*[''"][^''"]*[''"]\s*;?\s*\}'
  - id: mongo-validator-derivation-moves-to-mongo-contract
    summary: |
      The `FieldValueSets` type moves from `@internal/mongo-contract-psl` (`@prisma/orm-family-mongo/contract-psl`) to `@internal/mongo-contract` (`@prisma/orm-family-mongo/contract`). Extensions that author Mongo contracts through `defineContract(...)` or PSL need no change.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import[^;]*\bFieldValueSets\b[^;]*from\s*[''"](?:@internal/mongo-contract-psl|@prisma/orm-family-mongo/contract-psl)[''"]'
  - id: mongo-derive-json-schema-replaced-by-derive-collection-validators
    summary: |
      `deriveJsonSchema` and `derivePolymorphicJsonSchema` are removed. Call `deriveCollectionValidators` from `@internal/mongo-contract` (`@prisma/orm-family-mongo/contract`) instead. It returns the validator of each collection, keyed by collection name, and it is the validator a contract emits, including embedded models and variants.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bderive(?:Polymorphic)?JsonSchema\b'
  - id: psl-nocheck-removed
    summary: |
      The PSL attribute `@noCheck` no longer exists, and writing it in an extension's contract source is an unknown-attribute error. A list that allows null elements is now written `T?[]`. Replace `T[] @noCheck(elementNotNull)` with `T?[]`, delete `@noCheck(membership)`, and replace a bare `@noCheck` with both. Then re-emit the extension's bundled contract. The detection matches PSL files that use the attribute.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@noCheck\b'
  - id: ts-nocheck-method-removed
    summary: |
      The TypeScript field builder no longer has a `noCheck()` method. Replace `.many().noCheck('elementNotNull')` with `.many({ elementsNullable: true })`, delete `.noCheck('membership')`, and replace a bare `.noCheck()` with both. Then re-emit the extension's bundled contract. The detection matches TypeScript files that call the method.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.noCheck\('
  - id: stored-contracts-drop-nocheck
    summary: |
      A stored SQL contract that has a `noCheck` key on a column no longer loads. Run `scripts/remove-nocheck/remove-nocheck.ts` from the extension's package root. It removes the key from every stored contract the extension ships, its migration snapshots included, writes each PostgreSQL default in the form this release stores, and rewrites the hashes and references that change. Then re-emit the bundled contract.
    detection:
      glob: "**/*.json"
      matches:
        - '"noCheck"\s*:'
    script: ./scripts/remove-nocheck/remove-nocheck.ts
  - id: sqlite-contracts-name-datetime-and-json-data-types
    summary: |
      An extension that ships a SQLite contract space: a column whose codec is `sqlite/datetime@1` or `sqlite/json@1` names its own data type (`sqlite/datetime`, `sqlite/json`) instead of `sqlite/text`, and a datetime default or enum value is stored with exactly three fraction digits. The CLI refuses the old form. Run `scripts/data-type-values/data-type-values.ts` from the extension's package root, as the section of this name below describes. It rewrites the contract and its migration snapshots and their hashes. The storage hash changes, so tell the applications that use the extension to run `prisma db sign` after they upgrade.
    detection:
      glob: "**/*.json"
      matches:
        - '"codecId"\s*:\s*"sqlite/(?:datetime|json)@1"\s*,\s*"dataType"\s*:\s*"sqlite/text"'
    script: ./scripts/data-type-values/data-type-values.ts
  - id: mongo-contracts-record-stored-field-names
    summary: |
      An extension that ships a MongoDB contract space: a MongoDB contract records each field's stored name in `model.storage.fields`, and a contract without it is refused with `CONTRACT.VALIDATION_FAILED`. Re-emit the bundled contract, then run `scripts/mongo-field-storage-names/mongo-field-storage-names.ts` from the extension's package root to rewrite the migration snapshots, as the section of this name below describes. Storage hashes do not change.
    detection:
      glob: "**/*.json"
      matches:
        - '"storage"\s*:\s*\{\s*(?:"collection"\s*:\s*"[^"]*"\s*)?\}'
        - '"storage"\s*:\s*\{\s*"collection"\s*:\s*"[^"]*"\s*,\s*"relations"'
    script: ./scripts/mongo-field-storage-names/mongo-field-storage-names.ts
  - id: date-time-interval-and-bytes-defaults-use-tags
    summary: |
      In the PSL source of an extension's contract, a date, time, interval or bytes default is written with its type's tag instead of a quoted string, such as `@default(timestamptz`2024-01-01T00:00:00Z`)` or `@default(bytea`\x0102`)`. `contract emit` refuses the quoted form and names the tag to write. The section of this name below lists every tag. The detection matches Prisma 8 schema files with a quoted default that looks like a date or an interval, or that sits on a date, time, interval or bytes column. It skips a quoted time such as `"12:30"` on a column whose type is a type alias, because a `String` default can look the same; `contract emit` names such a default.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*@default\(\s*"(?:[+-]?\d{4,6}-\d{2}-\d{2}|-?P(?:\d|T\d)|[+-]?infinity")'
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*\b(?:DateTime|Date|Time|Timetz|Timestamp|Timestamptz|Interval)\b[^\n]*@default\(\s*"'
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*\bBytes\??[^\n]*@default\(\s*"'
  - id: postgres-defaults-stored-in-another-spelling
    summary: |
      An extension that ships a PostgreSQL contract space: the CLI refuses a contract that an earlier release emitted when it stores a default in another spelling than its column's parameters give, for example `"1.5"` on `numeric(10,2)`. Run `scripts/remove-nocheck/remove-nocheck.ts` from the extension's package root (`stored-contracts-drop-nocheck`): it writes each stored default in the new form, migration snapshots included. Then re-emit the bundled contract. If the storage hash changes, tell the applications that use the extension to run `prisma db sign` after they upgrade.
    script: ./scripts/remove-nocheck/remove-nocheck.ts
  - id: client-functions-move-from-default-to-on-create
    summary: |
      In the PSL source of an extension's contract, `@default(uuid())`, `@default(cuid(2))`, `@default(ulid())` and `@default(nanoid())` are refused with `PSL_GENERATOR_IN_DEFAULT`; write `@onCreate(...)` instead. `scripts/default-generators-to-on-create/rewrite-default-generators.mjs` rewrites the files it is given. The contract does not change. The detection matches Prisma 8 schema files, those with the `// use prisma-8` directive, that write one of these functions in `@default`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])\s*// *use +(?:prisma-8|prisma-next) *(?!\S)[\s\S]*@default\(\s*(?:uuid|cuid|ulid|nanoid)\s*\('
    script: ./scripts/default-generators-to-on-create/rewrite-default-generators.mjs
  - id: setdefault-operation-class-derived
    summary: |
      On PostgreSQL, `this.setDefault` in `migration.ts` no longer takes `operationClass`. The operation is widening when the migration's start contract gives the column a default, and additive otherwise. `migration plan` no longer writes `operationClass` into the call. A `migration.ts` that passes it no longer type-checks; delete the option.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bsetDefault\(\{(?:(?!\bthis\.|\brawSql\s*\()[\s\S])*?\boperationClass\s*:'
  - id: setdefault-has-no-postcheck
    summary: |
      On PostgreSQL, a `setDefault` operation no longer checks afterwards that the column has a default, so the runner no longer skips it when the column already has a different default. A package planned by 8.0.0-rc.15 or a later release before this one whose `migration.ts` has a hand-written `setDefault` that changes an existing default still carries the old check in `ops.json`; write its `ops.json` again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - 'verify column \\"(?:[^"\\]|\\.)*?\\" has a default'
  - id: postgres-postcheck-create-table
    summary: |
      On PostgreSQL, the check that runs after `createTable` checks that the relation is a table, not a view, sequence or index of the same name. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create table \\"(?:[^"\\]|\\.)*?\\""(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify table \\"(?:[^"\\]|\\.)*?\\" exists",\s*"sql": "SELECT \(?to_regclass\('
  - id: postgres-postcheck-add-column
    summary: |
      On PostgreSQL, the check that runs after `addColumn` checks the column's type, and that it is NOT NULL when the column is declared NOT NULL. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify column \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-column-with-temporary-default
    summary: |
      On PostgreSQL, the check that runs after `addColumnWithTemporaryDefault` checks the column's type. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - 'has no default after temporary default removal",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-required-column-to-empty-table
    summary: |
      On PostgreSQL, the check that runs after `addRequiredColumnToEmptyTable` checks the column's type. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify column \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\},\s*\{\s*"description": "verify column \\"(?:[^"\\]|\\.)*?\\" is NOT NULL",[^{}]*\}\s*\]'
  - id: postgres-postcheck-create-index
    summary: |
      On PostgreSQL, the check that runs after `createIndex` checks that the relation is an index on the planned table, with the planned uniqueness, access method and columns in order, and with an expression and a predicate only where the call has them. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create index \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify index \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-index
    summary: |
      On PostgreSQL, the check that runs after `renameIndex` also checks that no index has the old name any more. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename index \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify index \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-primary-key
    summary: |
      On PostgreSQL, the check that runs after `addPrimaryKey` checks that the constraint is a primary key on the planned columns in order. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify primary key \\"(?:[^"\\]|\\.)*?\\" exists"'
  - id: postgres-postcheck-add-unique
    summary: |
      On PostgreSQL, the check that runs after `addUnique` checks that the constraint is a unique constraint on the planned columns in order. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "add unique constraint \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-add-foreign-key
    summary: |
      On PostgreSQL, the check that runs after `addForeignKey` checks the constraint's columns, referenced table and columns in order, and its delete and update actions. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify FK \\"(?:[^"\\]|\\.)*?\\" exists"'
  - id: postgres-postcheck-add-check-constraint
    summary: |
      On PostgreSQL, the check that runs after `addCheckConstraint` checks that the constraint is a check constraint. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "add check constraint \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-constraint
    summary: |
      On PostgreSQL, the check that runs after `renameConstraint` also checks that no constraint has the old name any more. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename (?:primary key|unique constraint|foreign key|check constraint) \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-create-rls-policy
    summary: |
      On PostgreSQL, the check that runs after `createRlsPolicy` checks the policy's command, roles and whether it is permissive. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create RLS policy \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify RLS policy \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-rls-policy
    summary: |
      On PostgreSQL, the check that runs after `renameRlsPolicy` also checks that no policy has the old name any more; its precheck now also refuses a policy that already has the new name. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename RLS policy \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify RLS policy \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-autoincrement-default
    summary: |
      On PostgreSQL, the check that runs after `setDefault` with `autoincrement()` also checks that the column owns the sequence of the planned name and that the sequence has the column's integer width. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - 'takes its default from an attached sequence",[^{}]*\}\s*\]'
  - id: postgres-alter-column-type-unchanged-refused
    summary: |
      On PostgreSQL, `this.alterColumnType` with `using` now refuses, with `MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE`, a column the start contract, after the earlier renames in the migration, already gives the new type. Its check compares only the type, so the runner skipped the conversion. Write the conversion as a `dataTransform`.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\balterColumnType\(\{(?:(?!\bthis\.)[\s\S])*?\busing\s*:'
  - id: postgres-autoincrement-sequence-follows-column-type
    summary: |
      On PostgreSQL, changing the integer type of an `autoincrement()` column now also changes the sequence the column owns to the new width, and checks both afterwards. Before, a column widened from `int4` to `int8` kept an `integer` sequence, which stops at 2147483647. An `ops.json` written before this change has an `alterColumnType` without the sequence step, and an `alter type of "<column>"` step that does not name the new type; run `migration.ts` again for each migration that is not applied yet. For a database where such a migration is already applied, run `ALTER SEQUENCE … AS bigint` on the sequence `pg_get_serial_sequence` names yourself.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "alter type of \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify column \\"(?:[^"\\]|\\.)*?\\" has type \\"(?:smallint|integer|bigint)\\""'
  - id: sqlite-postchecks-check-full-definition
    summary: |
      On SQLite, the checks that let the runner skip an operation whose effect is already in place now check the whole definition. `createTable` checks every column's name, type, nullability and primary key position; `addColumn` checks the column's type and nullability; `createIndex` checks the index's table, ordered columns and uniqueness; `recreateTable` checks foreign key actions and `autoincrement()`. An `ops.json` written by an earlier release still carries the old checks; write it again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*has exactly its columns)[\s\S]*"description":\s*"verify table \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*sqlite_master'
        - '(?<![\s\S])(?![\s\S]*\\" has type )[\s\S]*"description":\s*"verify column \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*pragma_table_info'
        - '(?<![\s\S])(?![\s\S]*\\" covers \()[\s\S]*"description":\s*"verify index \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*sqlite_master'
        - 'pragma_foreign_key_list\(''(?:[^''\\]|\\.)*''\) f WHERE f\.\\"table\\" = ''(?:[^''\\]|\\.)*'' GROUP BY'
  - id: mongo-postchecks-check-full-definition
    summary: |
      On MongoDB, the checks that let the runner skip an operation whose effect is already in place now check the whole definition. `createIndex` checks every index option the planner tells indexes apart by, not only the keys and `unique: true`. `collMod` with a validator that is not only a `$jsonSchema` compares the whole validator. An `ops.json` written by an earlier release still carries the old checks; write it again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*"field":\s*"sparse")[\s\S]*"description":\s*"index exists on '
        - '(?<![\s\S])(?![\s\S]*"field":\s*"options\.validator)[\s\S]*"description":\s*"validator applied on '
  - id: control-client-apply-takes-invocation
    summary: |
      `dbInit`, `dbUpdate` and `migrate` on a control client take a required `invocation` option: `{ cwd, configPath, dbGiven }`, where the commands an error's advice prints are run from, the `--config` they repeat, and whether they repeat `--db`. Pass `{ cwd: process.cwd(), configPath: undefined, dbGiven: false }` when nothing is run from a terminal. Their failures are now `CliStructuredError`s, so `DbInitFailure`, `DbUpdateFailure` and `MigrateFailure` are gone from `control-api`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.(?:dbInit|dbUpdate|migrate)\(\s*\{'
        - '\b(?:DbInitFailure|DbUpdateFailure|MigrateFailure)(?:Code)?\b'
  - id: runner-failures-report-own-codes
    summary: |
      A failed migration apply reports the runner's own code, such as `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED` or `MIGRATION.EXECUTION_FAILED`, instead of `MIGRATION.RUNNER_FAILED` with `meta.runnerErrorCode`. `MIGRATION.RUNNER_FAILED` no longer exists. The facts move into typed `meta` keys: a failed schema check lists its issues in `meta.schemaIssues` (was `meta.issues`), and a failed check is `meta.failedCheck` (`operationId`, `phase`, `description`; was `operationId`, `phase`, `stepDescription`).
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs,sh}"
      matches:
        - 'MIGRATION\.RUNNER_FAILED|\brunnerErrorCode\b'
---

# 8.0.0-rc.18 → 8.0.0-rc.19 — Extension author upgrade instructions

Run `client-takes-contract-value` first, on source files. An extension that ships a contract space then rewrites its stored contracts and contract source before it re-emits the bundled contract once; `Contract spaces an extension ships` lists the steps and their order. Make the other changes as their sections say.

## Clients

### `client-takes-contract-value`

A client, static entry or `mongoQuery()` no longer takes `contractJson`, and it needs no type argument. This applies to `postgres()`, `postgresServerless()`, `sqlite()`, `supabase()`, `mongo()`, `postgresStatic()`, `sqliteStatic()`, `mongoStatic()` and `mongoQuery()`. If your extension's code, examples or tests build one from emitted JSON, turn the JSON into a typed value with `contractFromJson<Contract>(json)` from the facade's `/static` entry (`@prisma/orm-postgres/static`, `@prisma/orm-sqlite/static`, `@prisma/orm-mongo/static`; Supabase uses the Postgres one) and pass `{ contract }`:

```ts
// Before
const db = postgres<Contract>({ contractJson, extensions: [myPack] });

// After
import { contractFromJson } from '@prisma/orm-postgres/static';

const db = postgres({ contract: contractFromJson<Contract>(contractJson), extensions: [myPack] });
```

A value is validated once however many clients use it, so build it once per module and share it. A contract written with `defineContract` is already a value: keep passing it as `{ contract }`.

`mongoQuery()` takes `{ contract }`, a value typed as the contract, and infers the type from it: `mongoQuery({ contract }).from('orders')`. A test that only needs the types can declare the value: `declare const contract: Contract;`.

#### Run the script

Run `node <path to this guide>/scripts/client-takes-contract-value/contract-from-json.ts <package root>`. The script reads source files with the TypeScript compiler from the package's `typescript`; if there is none, it changes nothing, says so and exits 1. It skips `node_modules`, `dist`, `build` and every directory whose name starts with a dot, such as `.git`, `.agents` or `.claude`; move a client in such a directory by hand. It moves each source file that passes `contractJson` to a client, static entry or `mongoQuery`: it adds the `contractFromJson` import, declares `export const contract = contractFromJson<Contract>(contractJson);` after the imports (`const contract` without `export` in a module with a default export, with a note), removes the type argument and passes `{ contract }`. Where the call's result is destructured with `contract` in it, as in a `migration.ts`, it removes `contract` from the destructuring. It prints each file it moved. It prints to stderr, with the reason, each file it did not move, and then exits 1: a test file, a file that already has another binding named `contract`, a file whose clients use different contracts, a file whose `contractJson` value uses a binding declared after the imports, a file whose `contractJson` value uses a parameter or local binding of the function that creates the client (pass `contract: contractFromJson<Contract>(<value>)` to that call instead), or a call it cannot read.

#### Then, by hand

1. **Tests.** Move each test that passes `contractJson` the same way: `postgres({ contract: contractFromJson<Contract>(contractJson) })`, or one `const contract = contractFromJson<Contract>(contractJson);` per file when several clients share it.
2. **Types.** The option types `PostgresOptionsWithContract`, `PostgresOptionsWithContractJson`, `PostgresServerlessOptionsWithContract`, `PostgresServerlessOptionsWithContractJson`, `SqliteOptionsWithContract`, `SqliteOptionsWithContractJson`, `MongoOptionsWithContract`, `MongoOptionsWithContractJson`, `SupabaseOptionsWithContract` and `SupabaseOptionsWithContractJson` are removed. Use `PostgresOptions<Contract>`, `PostgresServerlessOptions<Contract>`, `SqliteOptions<Contract>`, `MongoOptions<Contract>` or `SupabaseOptions<Contract>`.
3. **READMEs and JSDoc** that show a client called with `contractJson`: rewrite them to the new form.

### `collections-on-the-client`

This concerns extension packages whose code, examples or tests build a client and then an ORM by hand to reach custom collection classes. The client types (`PostgresClient`, `PostgresTransactionContext`, `PostgresServerlessClient`, `PostgresServerlessConnection`, `SqliteClient`, `SqliteTransactionContext`, `SupabaseDb`, `RoleBoundDb`, `ServiceRoleDb`) gained a second type parameter for the classes. It defaults to no classes, so existing references with one type argument keep their meaning.

`postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take an option, `collections`, with the same type `orm({ collections })` takes. The client types are inferred from it, and the classes reach every ORM the client offers:

```ts
// Before
import { orm } from '@prisma/orm-postgres/orm-client';
import { db } from './prisma/db';

export const posts = orm({
  runtime: db.runtime(),
  context: db.context,
  collections: { Post: PostCollection },
}).public.Post;

// After, in the module that creates the client
export const db = postgres({ contract, url, collections: { Post: PostCollection } });

await db.orm.public.Post.published().all();
await db.transaction(async (tx) => tx.orm.public.Post.published().forUpdate().all());
```

1. Pass the classes as `collections` where the client is created. If the module that defines the classes imports the client's module, import only the `Contract` type there (`import type { Contract } from './contract.d'`), so the two modules do not import each other.
2. Delete the hand-built ORM client (for example a `createOrmClient(runtime)` helper) and every `orm({ runtime, context, collections })` that only existed to reach the classes. Use `db.orm` instead. On SQLite, `db.orm` is the model collections themselves: `db.orm.Post`.
3. A function that took a `runtime` only to build an ORM no longer needs it. Inside a transaction, pass `tx.orm`, which has the classes too.
4. On a serverless client, the classes are on every connection: `await using db = await postgres.connect({ url }); db.orm.public.Post.published()`.
5. On Supabase, the classes are on `asUser`, `asAnon` and `asServiceRole` clients. Supabase's internal `.supabase` ORM does not take them.

A type written with only the contract, such as `PostgresClient<Contract>`, still describes a client without classes and accepts a client created with them. To name a client with classes, give the second type parameter: `PostgresClient<Contract, { Post: typeof PostCollection }>`.

### `client-query-and-to-sql`

Every SQL client now runs a plan itself and renders the SQL a plan would send:

```ts
const plan = db.sql.public.post.select('id', 'title').limit(10).build();
console.log(db.toSql(plan)); // { sql: 'SELECT … LIMIT 10', params: [] }
for await (const row of db.query(plan)) console.log(row);
await db.execute(db.raw.sql`UPDATE post SET pinned = false`.affectedCount().build());
```

`db.query(plan)` and `db.execute(plan)` behave as `db.runtime().query(plan)` and `db.runtime().execute(plan)` do, and have the types `tx.query` and `tx.execute` have. Replace `db.runtime().query(` with `db.query(` and `db.runtime().execute(` with `db.execute(`. Keep `db.runtime()` where the code needs `connection()`, `close()` or `telemetry()`. On Supabase, call them on a role-bound client, as before.

`toSql(plan)` needs only the adapter and the contract, so it works with no database. `params` are the plan's values before codecs encode them. Middleware rewrites (`beforeCompile`) are not applied. A plan with `prepare` bind sites throws `RUNTIME.PREPARE_BIND_ON_ADHOC`, and a plan built for another contract throws `PLAN.HASH_MISMATCH`, as running it would.

The message of `RUNTIME.PREPARE_BIND_ON_ADHOC` changed; its code did not. Code that matches the old message text ("Ad-hoc execute received a bind-site slot") must match the code instead. The details of `PLAN.TARGET_MISMATCH` and `PLAN.HASH_MISMATCH` rename `runtimeTarget` to `contractTarget` and `runtimeStorageHash` to `contractStorageHash`, and their messages changed; match the codes.

`supabase()` no longer creates its `pg.Pool`, driver or runtimes when it is called. It creates them on the first query, so creating a client with a URL opens nothing. It is still `async` and still requires `jwtSecret` or `jwksUrl`. `close()` now ends only a pool the client created from `url`; a `pg.Pool` passed in with the `pg` option stays open, as with `postgres()`, and the caller ends it.

`postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take a new `mode` option, typed `RuntimeMode`. It is `'strict'` by default, which is how every client ran before. Under `'permissive'`, a `budgets()` violation whose severity is `'warn'` goes to `log.warn` and the query runs.

### `transaction-query-members`

Inside `db.transaction(async (tx) => …)`, `tx` now has the client's query members with the same types: `sql`, `orm` (with the client's custom collection classes), `raw`, `prepare`, `query`, `execute` and `toSql`. This holds for `postgres()`, every serverless connection, `sqlite()` and every Supabase role-bound client. A Supabase role-bound client gains `prepare`, and SQLite's `db.orm` gains `fragment`. A prepared statement runs on whatever it is given, so `ps.query(tx, params)` runs inside the transaction; `tx.prepare` lets code inside a transaction prepare without the outer client.

### Test doubles of client types

Code that only reads the client types needs no change for `client-query-and-to-sql` and `transaction-query-members`. Code that creates an object of one of them, for example a test double typed `PostgresClient<Contract>` or `PostgresTransactionContext<Contract>`, must add the new members:

| Type | New or changed members |
| --- | --- |
| `PostgresClient`, `PostgresServerlessConnection` (`@prisma/orm-postgres/runtime`, `/serverless`) | `query`, `execute`, `toSql` |
| `PostgresServerlessClient`, `PostgresStaticContext`, `PostgresStaticMembers` | `toSql` |
| `PostgresQueryMembers` | new: the query members a client and its transactions share, including `query`, `execute` and `toSql`; `PostgresClient`, `PostgresServerlessConnection` and `PostgresTransactionContext` extend it |
| `PostgresTransactionContext` (`@prisma/orm-postgres/runtime`) | `raw`, `prepare`, `toSql` |
| `SqliteClient` (`@prisma/orm-sqlite/runtime`) | `query`, `execute`, `toSql`; `orm` is `SqliteOrm`, which adds `fragment` |
| `SqliteStaticContext` | `toSql` |
| `SqliteStaticMembers` (`@prisma/orm-sqlite/runtime`) | new: the static context plus `stack`, which `SqliteClient` now extends |
| `SqliteQueryMembers` | new: the query members a client and its transactions share, including `query`, `execute` and `toSql`; `SqliteClient` and `SqliteTransactionContext` extend it |
| `SqliteTransactionContext` (`@prisma/orm-sqlite/runtime`) | `raw`, `prepare`, `toSql`; `orm` is `SqliteOrm`, the namespace's models plus `fragment` |
| `RoleBoundDb` (`@prisma/orm-extension-supabase/runtime`) | `prepare`, `toSql`, and the two prepared-statement entry points a statement's `query` and `execute` call; `query` and `execute` take the plan type every SQL client shares; it extends `PostgresQueryMembers`; `transaction` passes a `SupabaseTransactionContext` instead of a plain `TransactionContext` |
| `ServiceRoleDb` (`@prisma/orm-extension-supabase/runtime`) | `toSql`; `query` and `execute` take the plan type every SQL client shares |
| `SupabaseTransactionContext` | new; has `toSql` |
| `SupabaseInternalDb` (the service role's `supabase` member) | `toSql`, over the Supabase contract |
| `OrmClientRootMembers` (ORM client) | newly exported: the members of the ORM client beside its namespaces, today `fragment` |
| `PrepareMember` (ORM client) | newly exported: the `prepare` member a client and its transactions offer |

A hand-built `RoleBoundDb`, such as a test double, must also implement the two prepared-statement entry points, keyed by the symbols `preparedStatementQuery` and `preparedStatementExecute`. Import them from `@prisma/orm-postgres/family-runtime/internal/prepared-query` (or `@prisma/orm-family-sql/runtime/internal/prepared-query`). Like every `internal/` entry, it can change without notice.

A callback typed to take a plain `TransactionContext` still compiles where a transaction context is passed, because each new context type extends it.

## Clients start their own activities, and ORM calls are activities

The runtime's middleware tree now has a third kind of activity: one a client starts for an act the runtime would not otherwise see. A client starts it with `startActivityOn(queryable, activity)` and sends statements through the returned handle. A middleware can supply such an activity's result through the new `intercept.onActivity` handler. Each SQL ORM terminal method is one such activity, of kind `orm-call`. Its statements, its own transaction (`handle.transaction()`) and the read-back after a nested write are its children, and the annotations a `configure` callback records are on the call.

### `runtime-activity-is-activity`

Replace every `RuntimeActivity` with `Activity`, imported from the same module. There is no alias:

```ts
// before
import type { RuntimeActivity } from '@prisma/orm-framework/components/runtime';
async activityStarted(activity: RuntimeActivity, ctx) {}

// after
import type { Activity } from '@prisma/orm-framework/components/runtime';
async activityStarted(activity: Activity, ctx) {}
```

### `activity-includes-client-activities`

`Activity` always includes `ClientActivity`, whose kind contains a hyphen. A hook that rules out `'transaction'` and then reads statement fields stops compiling. Test for the kind you handle instead:

```ts
// before
if (result.kind === 'transaction') return;
record(result.latencyMs);

// after
if (result.kind !== 'statement') return;
record(result.latencyMs);
```

A middleware that sees a kind it does not know should ignore it rather than fail.

### `start-a-client-activity`

An extension can start an activity for an act of its own, such as a report that sends several statements, so that middleware observe it, finalize it and can serve it from a cache.

**Dependencies.** `startActivityOn`, `planContentHashOn` and the types their signatures name, such as `StartActivity`, `ClientActivity`, `ClientActivityKind` and `ActivityInterceptResult`, are in `@prisma/orm-family-sql/runtime`. The registry, `ClientActivityRegistry`, is in `@prisma/orm-framework/components/runtime`, which also has the types. An application or extension that uses `postgres()` already depends on `@prisma/orm-postgres`, which re-exports both as `@prisma/orm-postgres/components/runtime` and `@prisma/orm-postgres/family-runtime`. Augment `ClientActivityRegistry` through the entry that exports it, `@prisma/orm-framework/components/runtime` or `@prisma/orm-postgres/components/runtime`. Augmenting it through `@prisma/orm-family-sql/runtime` or `@prisma/orm-postgres/family-runtime` registers nothing, and TypeScript reports no error.

**Register the kind.** A client kind contains a hyphen; a kind without one is rejected with `RUNTIME.ACTIVITY_KIND_RESERVED`. Registering the result type is optional. The file that augments the entry must also import from it, or TypeScript reports that the module cannot be found:

```ts
import type { ClientActivityResult } from '@prisma/orm-postgres/components/runtime';

declare module '@prisma/orm-postgres/components/runtime' {
  interface ClientActivityRegistry {
    'report-run': { result: { readonly emails: readonly string[] } };
  }
}

export type ReportResult = ClientActivityResult<'report-run'>;
```

The registry types the handle side only: `call.intercepted.result` and `call.end({ result })`. In middleware hooks the result of a client activity is `unknown`, even after `result.kind === 'report-run'`, because the hook types must accept unregistered kinds; check or cast the value there.

**Start, use and end it.** Pass a function that derives the content hash from the plan with `planContentHashOn`. The runtime calls it only when a middleware calls `activity.contentHash()`, and once per activity. It equals the digest `ctx.contentHash(exec)` returns for the statement's execution plan only when `beforeCompile` gives the same result for the plan in both places, no `beforeEncode` hook changes the parameters, and the codecs encode deterministically. (For `planContentHashOn`, `beforeCompile` runs with the scope and parent of the queryable it is called on and with fresh state, so on the runtime itself it has no parent. For the statement, it runs beneath the handle, with the state its `activityStarted` hooks wrote.) A cache should key on the activity's own content hash and not rely on the two being equal. End every handle, in a `finally`, or `close()` waits for it forever:

```ts
import { planContentHashOn, startActivityOn } from '@prisma/orm-postgres/family-runtime';
import type { SqlQueryPlan } from '@prisma/orm-postgres/relational-core/plan';
import type { PostgresClient } from '@prisma/orm-postgres/runtime';

async function runReport(db: PostgresClient<Contract>, plan: SqlQueryPlan<{ email: string }>) {
  const runtime = db.runtime();
  const call = await startActivityOn(runtime, {
    kind: 'report-run',
    contentHash: () => planContentHashOn(runtime, plan),
  });
  let outcome: 'succeeded' | 'failed' = 'failed';
  let result: { readonly emails: readonly string[] } | undefined;
  try {
    if (call.intercepted) {
      outcome = 'succeeded';
      return call.intercepted.result.emails;
    }
    const rows = await call.query(plan).toArray();
    result = { emails: rows.map((row) => row.email) };
    outcome = 'succeeded';
    return result.emails;
  } finally {
    await call.end({ outcome, ...(result === undefined ? {} : { result }) });
  }
}
```

Statements sent through `call` are the activity's children. `call.transaction()` starts a transaction beneath it, on a connection it owns; it is absent when the handle was opened under a transaction. `startActivity` on the handle nests another activity.

**Serve it from middleware.** `intercept.onActivity(activity: ClientActivity, ctx)` runs after `activityStarted`. The first handler that returns `{ result }` wins, and the handle's `intercepted` is set. The ended result carries `source: 'middleware'` when the client then ends without a result:

```ts
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';

const served = new Map<string, unknown>();

const reportCache: SqlMiddleware = {
  name: 'report-cache',
  familyId: 'sql',
  intercept: {
    async onActivity(activity) {
      if (activity.kind !== 'report-run') return undefined;
      const hit = served.get(await activity.contentHash());
      return hit === undefined ? undefined : { result: hit };
    },
  },
  async activityEnded(activity, result) {
    if (activity.kind !== 'report-run' || result.kind !== 'report-run') return;
    if (result.outcome === 'succeeded' && result.source === 'client' && result.result !== undefined) {
      served.set(await activity.contentHash(), result.result);
    }
  },
};
```

### `orm-annotations-on-the-call`

The statements an ORM call sends carry only the reserved keys the ORM sets. A middleware that reads an ORM annotation from a statement plan (`handle.read(plan)` or `plan.meta.annotations`) finds nothing. Read it from the call, in `activityStarted(activity)` or `intercept.onActivity(activity)`:

```ts
const audit: SqlMiddleware = {
  name: 'audit',
  familyId: 'sql',
  async activityStarted(activity) {
    if (activity.kind !== 'orm-call') return;
    const actor = auditAnnotation.read(activity);
    if (actor) log(actor);
  },
};
```

A middleware can answer the call through `intercept.onActivity`. The value must have the shape the terminal method returns, or the ORM rejects with `ORM.INTERCEPTED_RESULT_INVALID`.

### `cache-store-holds-cached-values`

A cache store for `@internal/middleware-cache` holds `CachedValue`, which is `{ kind: 'statement-rows', rows }` or `{ kind: 'call-result', result }`, instead of `CachedRows`. `CacheStore` and `CacheEntry` default their value type to `CachedValue`, and `createCacheMiddleware` accepts only a `CacheStore<TMeta, CachedValue>`:

```ts
import type { CachedValue, CacheStore } from '@internal/middleware-cache';

const store: CacheStore<unknown, CachedValue> = {
  // get, set and unset as before; value is now { kind: 'statement-rows', rows } or { kind: 'call-result', result }
};
```

`get` must give back a value equivalent to the one `set` was given, `kind` included. An ORM call's result holds decoded values such as `Date`, `bigint`, Temporal values and extension class instances, so a store that serializes needs a serializer that rebuilds them; JSON does not. `createInMemoryCacheStore` takes only the meta type now and always holds `CachedValue`: drop its second type argument.

### Activity sources on connections, runtimes and queryables

Activities start through an `activitySource` member of a queryable. The member is keyed by a symbol, so the public queryable types do not show it, and `startActivityOn` and `planContentHashOn` read it. The SQL ORM starts its `orm-call` activity on the queryable it holds, through this member only, and sends every statement through the activity's handle. A terminal method on a queryable without an activity source fails with `ORM.ACTIVITY_SOURCE_MISSING`: streaming terminals throw when called, and the others reject.

#### `runtime-connections-carry-an-activity-source`

Inside a `SqlRuntimeBase` subclass, a connection-like object over a raw connection gets its activity members from the base class. Add `ActivitySourceTarget` to the object's declared type. The public `RuntimeConnection` type does not require the member.

```ts
const session: RoleSession & TransactionStartTarget & ActivitySourceTarget = {
  [transactionStart]: createTransactionStart(),
  [activitySource]: self.connectionActivitySource(conn, () => session),
  // query, execute, transaction, release, destroy as before
};
```

`activitySource` and `ActivitySourceTarget` come from `@prisma/orm-family-sql/runtime`. `transactionStart`, `createTransactionStart` and `TransactionStartTarget` still come from `@prisma/orm-family-sql/runtime/internal/prepared-query`.

#### `orm-runtime-objects-carry-an-activity-source`

`db.runtime()` passed straight to `orm()` already carries an activity source. A facade, such as `postgres()`, that builds its own runtime object for the ORM, such as one that looks up its runtime on every call, gives it the member:

```ts
import { activitySource, delegatingActivitySource } from '@prisma/orm-family-sql/runtime';
import { orm } from '@prisma/orm-postgres/orm-client';

const client = orm({
  runtime: {
    query: (plan) => getRuntime().query(plan),
    execute: (plan) => getRuntime().execute(plan),
    connection: () => getRuntime().connection(),
    [activitySource]: delegatingActivitySource(() => getRuntime()),
  },
  context,
});
```

Do the same for the ORM object inside `db.transaction(fn)`, with `delegatingActivitySource(() => txCtx)`. Do not add plain `startActivity` or `planContentHash` members instead: `findActivitySource` and `startActivityOn` read only the `activitySource` member, so an object with only the plain members starts no activity.

If the facade sends its statements through sessions of its own, such as role-bound sessions, the activity's statements and transaction must go through them too. Give an activity source that does so. The plain runtime's source would run the activity's statements without the session.

#### `queryable-carries-the-activity-source`

A wrapper that copies a runtime, connection or transaction to intercept its `query` and `execute`, for example to record plans, also copies the `[activitySource]` member, so ORM statements bypass the wrapper. Wrap the activity source too: return a source whose `startActivity` wraps each handle the same way, including the transaction its `transaction()` returns. A custom queryable passed to the ORM must carry an activity source. A test stub can use `delegatingActivitySource(() => realRuntime)`, or a source whose handles send their statements to the stub.

### Pass a parent when beginning or starting a transaction

#### `begin-transaction-on-takes-a-parent`

`SqlRuntimeBase.beginTransactionOn(connection, owner)` takes a third argument, `parent`: the activity the transaction starts beneath, or `undefined`. Pass `undefined` where you began a transaction before:

```ts
// before
return self.beginTransactionOn(conn, session);
// after
return self.beginTransactionOn(conn, session, undefined);
```

#### `transaction-activity-takes-a-parent`

`startTransactionActivity` requires `parent`:

```ts
// before
await startTransactionActivity({ middleware, context, holdFinishedChildren });
// after
await startTransactionActivity({ middleware, context, parent: undefined, holdFinishedChildren });
```

An `ActivityParent` you implement yourself has `acceptsChildren()`, and its `adopt(child)` returns an `ActivityChildSlot` (`statementFailed()`, `ended(own)`, `transactionAcceptsChildren()`) instead of an end callback. `ActivityParent.activity` is an `ActivityBase`. A transaction stops accepting children with `stopAcceptingChildren()`, and adopting beneath a parent that no longer accepts children throws `RUNTIME.ACTIVITY_NOT_ACCEPTING_CHILDREN` instead of an internal error. Most runtimes only pass the parent they were given to `streamStatement`, `executeStatement`, `startTransactionActivity` or `startClientActivity` and need no change.

## `aggregate-operation-using-reserved`

A collection's new `using` member holds the collection methods that packages contribute for the model. Aggregate operations become reducer methods on the same collection, so a contributed aggregate operation named `using` would collide with it. `orm()` refuses such an operation when the client is built, with `ORM.AGGREGATE_OPERATION_RESERVED`, as it refuses `with` and `fragment`. Rename the operation in the extension's aggregate descriptors, and in the operation types the extension's contracts reference.

## Codecs read wire values and data type values

### `codecs-read-wire-and-data-type-values`

A codec converts between three forms of a value: the application's value, the value the database driver sends and returns (the wire value), and the value a contract stores, now a `DataTypeValue` of the codec's data type. Four methods replace the old four:

| Before | After | Converts |
| --- | --- | --- |
| `encode(value, ctx)` | `toWire(value, ctx)` | application value to wire value |
| `decode(wire, ctx)` | `fromWire(wire, ctx)` | wire value to application value |
| `encodeJson(value)` | `toDataTypeValue(value)` | application value to stored value |
| `decodeJson(json)` | `fromDataTypeValue(value)` | stored value to application value |

`toDataTypeValue` returns a `DataTypeValue`, and `fromDataTypeValue` receives one; its `value` is the JSON the contract stores. The data type has already read that JSON with its `read` function under the column's parameters, so `fromDataTypeValue` does not check it again. A codec builds the value it hands over with `this.dataTypeValueOf(json)`, which calls the data type's `valueFrom` and so refuses JSON the type does not hold. To make that possible, the codec's constructor passes its data type and its parameters to `CodecImpl`:

```ts
// before
export class PgVectorCodec extends CodecImpl</* … */> {
  constructor(descriptor: AnyCodecDescriptor, length: number) {
    super(descriptor);
    this.length = length;
  }

  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return `[${value.join(',')}]`;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return parseVector(wire);
  }

  encodeJson(value: number[]): JsonValue {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return [...value];
  }

  decodeJson(json: JsonValue): number[] {
    if (!Array.isArray(json) || json.length !== this.length) return this.refuseJson(json);
    return json.map(Number);
  }
}

// after
import type { DataTypeValue } from '@prisma/orm-framework/components/codec';
import { pgvectorVector } from './data-types';

export class PgVectorCodec extends CodecImpl</* … */> {
  constructor(descriptor: AnyCodecDescriptor, length: number) {
    super(descriptor, pgvectorVector, { length });
    this.length = length;
  }

  async toWire(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return `[${value.join(',')}]`;
  }

  async fromWire(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    return parseVector(wire);
  }

  fromDataTypeValue(value: DataTypeValue<readonly number[]>): number[] {
    return [...value.value];
  }

  toDataTypeValue(input: number[]): DataTypeValue {
    this.assertVector(input, 'RUNTIME.ENCODE_FAILED');
    return this.dataTypeValueOf([...input]);
  }
}
```

A codec without parameters passes only its data type: `super(descriptor, pgJsonb)`. A descriptor whose codec takes parameters passes them from `factory`:

```ts
// before
override factory(_params: GeometryParams) {
  return () => new PostgisGeometryCodec(this);
}

// after
override factory(params: GeometryParams) {
  return () => new PostgisGeometryCodec(this, params ?? {});
}
```

`DataTypeValue`, `DataTypeReader` and `refuseJsonValue` are exported from `@prisma/orm-framework/components/codec`, beside `CodecImpl`.

A Mongo codec made with `mongoCodec()` from `@prisma/orm-family-mongo/codec` takes the four options under the new names, and names its data type in a required `dataType` option, with the column's parameters in an optional `params`. Its `toDataTypeValue` returns a `DataTypeValue` too, which it builds with `dataType.valueFrom(json, params)`. It may be left out when the application value is JSON, and `fromDataTypeValue` may be left out only when the application type is exactly `JsonValue`. Declare the data type with `mongoDataType` from `@prisma/orm-family-mongo/contract/data-type`, and register it in the pack's `dataTypes` beside the codec:

```ts
// before
import { Long } from 'bson';
import { mongoCodec } from '@prisma/orm-family-mongo/codec';
import { decodeJsonString } from '@prisma/orm-framework/components/codec';
import type { JsonValue } from '@prisma/orm-framework/contract/types';

export const moneyCodec = mongoCodec({
  typeId: 'acme/money@1',
  encode: (value: bigint) => Long.fromBigInt(value),
  decode: (wire: Long) => wire.toBigInt(),
  encodeJson: (value: bigint) => value.toString(),
  decodeJson: (json: JsonValue) => BigInt(decodeJsonString('acme/money@1', json)),
});

// after
import { Long } from 'bson';
import { mongoCodec } from '@prisma/orm-family-mongo/codec';
import { mongoDataType } from '@prisma/orm-family-mongo/contract/data-type';
import { type DataTypeValue, readJsonMatching } from '@prisma/orm-framework/components/codec';

export const acmeMoney = mongoDataType('acme/money', {
  bsonTypes: ['long'],
  read: (json) => readJsonMatching('acme/money', json, /^-?\d+$/, 'decimal integer text'),
});

export const moneyCodec = mongoCodec({
  typeId: 'acme/money@1',
  dataType: acmeMoney,
  toWire: (value: bigint) => Long.fromBigInt(value),
  fromWire: (wire: Long) => wire.toBigInt(),
  toDataTypeValue: (value: bigint) => acmeMoney.valueFrom(value.toString(), {}),
  fromDataTypeValue: (value: DataTypeValue<string>) => BigInt(value.value),
});
```

### `data-types-own-parameter-limits`

A data type now reads every value a contract stores, with a `read` function that receives the JSON and the column's parameters. It returns the JSON when the type holds it and refuses it with `refuseJsonValue` when it does not. `read` is required: a data type that declared none before declares one now. It replaces `toCanonicalForm`, on the data type or on a codec descriptor, and the checks a codec made in `decodeJson` against its parameters move into it:

```ts
// before
export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
  toCanonicalForm: vectorCanonicalForm,
});

// after
const readVector: DataTypeReader = (json, params) => {
  const length = typeof params['length'] === 'number' ? params['length'] : undefined;
  const expected =
    length === undefined ? 'an array of finite numbers' : `an array of ${length} finite numbers`;
  if (!Array.isArray(json) || (length !== undefined && json.length !== length)) {
    return refuseJsonValue('pgvector/vector', expected, json);
  }
  if (!json.every(isFiniteNumber)) return refuseJsonValue('pgvector/vector', expected, json);
  return json;
};

export const pgvectorVector = sqlDataType('pgvector/vector', {
  params: pgvectorVectorParams,
  read: readVector,
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
});
```

A data type that had neither `toCanonicalForm` nor parameter checks gets a `read` that accepts the JSON it stores, as PostGIS's geometry now reads HEXEWKB text:

```ts
// before
export const postgisGeometry = sqlDataType('postgis/geometry', { params, texts });

// after
const readGeometry: DataTypeReader = (json, params) => {
  const hex = readJsonMatching('postgis/geometry', json, HEX_TEXT, 'a HEXEWKB string');
  const srid = params['srid'];
  if (typeof srid !== 'number' || sridOf(hex) === srid) return json;
  return refuseJsonValue('postgis/geometry', `a HEXEWKB string of a geometry with SRID ${srid}`, json);
};

export const postgisGeometry = sqlDataType('postgis/geometry', { params, texts, read: readGeometry });
```

A parameter that limits values, such as a geometry column's SRID, is checked the same way, in the data type's `read`. A contract that stores a value the type refuses no longer loads, so a stored default that broke the limit is reported when the contract is read, not when a query runs.

### `json-helpers-renamed`

The helpers that read a value from JSON now say so, and the one that writes a float says what it returns. Rename each call:

| Before | After |
| --- | --- |
| `decodeJsonString` | `readJsonString` |
| `decodeJsonMatching` | `readJsonMatching` |
| `decodeJsonInteger` | `readJsonInteger` |
| `decodeJsonIntegerText` | `readJsonIntegerText` |
| `decodeJsonFloat` | `readJsonFloat` |
| `decodeJsonBoolean` | `readJsonBoolean` |
| `encodeJsonFloat` | `floatToJson` |

They take the same arguments. `ToCanonicalForm` and `canonicalFormOf` are removed; a data type's `read` (`data-types-own-parameter-limits`) does their work.

### `stored-form-helpers-renamed`

The text a contract stores for a value is its stored form, and the helpers that read or write it now say so. They are exported from `@prisma/orm-family-sql/contract/data-type-support` and `@prisma/orm-family-sql/contract/sql-expression` as before. Rename each use:

| Before | After |
| --- | --- |
| `canonicalDateTime` | `dateTimeStoredText` |
| `CanonicalDateTimeOptions` | `DateTimeStoredTextOptions` |
| `canonicalNumeralText` | `storedNumeralText` |
| `sqlTextFromCanonical` | `sqlTextFromStored` |
| `canonicalSqlText` | `storedSqlText` |

They take the same arguments and return the same values.

### `projections-read-by-from-wire`

An include and an aggregate now read each column of their JSON result with the codec's `fromWire`, as a plain read does. A descriptor's `jsonProjection` therefore writes the value the driver returns for an ordinary row, not the codec's stored JSON form. For a type the database prints as text, that is usually the text:

```ts
// before
protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
  return FunctionCallExpr.of('array_to_json', [
    CastExpr.as(CastExpr.as(expression, 'real[]'), 'float8[]'),
  ]);
}

// after
protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
  return CastExpr.as(expression, 'text');
}
```

A projection that returned the column unchanged may need the cast too: a JSON constructor given a `jsonb` document that is a string, or a PostGIS geometry, writes something other than the text a row carries.

### `empty-result-json-renamed-empty-result-wire`

An aggregate descriptor that declares a value for an empty input names it `emptyResultWire` instead of `emptyResultJson`. It holds the value the driver would return for that result, and the result codec reads it with `fromWire`. Only the name changes where the value was already what the driver returns:

```ts
// before
{ ...sumIntegers, nullable: false as const, emptyResultJson: '0' }

// after
{ ...sumIntegers, nullable: false as const, emptyResultWire: '0' }
```

## Family codec templates and enum blocks

### `target-codec-adapters-take-a-factory`

A family codec template names no data type, so it cannot build a codec: the codec's constructor needs the data type (`codecs-read-wire-and-data-type-values`). The target's adapter builds it, through a `factory` that every `postgresCodec` and `sqliteCodec` call now passes. The factory receives the adapted descriptor, the `dataType` the call names, and the column's parameters:

```ts
// before
import { postgresCodec } from '@prisma/orm-postgres/target/codec-descriptor';

export const myCharDescriptor = postgresCodec(myCharTemplate, {
  dataType: pgChar,
  jsonProjection: (expression) => expression,
  factory: (descriptor, params) => () => new MyCharCodec(descriptor, params.length),
});
export const myTextDescriptor = postgresCodec(myTextTemplate, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
});

// after
import { postgresCodec } from '@prisma/orm-postgres/target/codec-descriptor';

export const myCharDescriptor = postgresCodec(myCharTemplate, {
  dataType: pgChar,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType, params) => () => new MyCharCodec(descriptor, dataType, params),
});
export const myTextDescriptor = postgresCodec(myTextTemplate, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType) => () => new MyTextCodec(descriptor, dataType),
});
```

A call that passed no `factory` used the template's own codec; pass a factory that builds that codec class with the data type. `sqliteCodec` takes the same `factory`, and no longer takes `renderTypes: false`; delete the option.

### `family-codec-templates-render-no-literals`

```ts
// before: the template renders, and postgresCodec copied it
export class MyTextTemplate extends CodecDescriptorTemplateImpl<void> {
  override renderValueLiteral(value: JsonValue): string | undefined {
    return renderTsLiteral(value);
  }
  // ...
}
export const myTextDescriptor = postgresCodec(myTextTemplate, {
  dataType: pgText,
  jsonProjection: (expression) => expression,
});

// after: the template renders nothing, and the target passes the renderer
export class MyTextTemplate extends CodecDescriptorTemplateImpl<void> {
  // ...
}
export const myTextDescriptor = postgresCodec(myTextTemplate, {
  dataType: pgText,
  renderValueLiteral: renderTsLiteral,
  jsonProjection: (expression) => expression,
  factory: (descriptor, dataType) => () => new MyTextCodec(descriptor, dataType),
});
```

Without the option, the adapted codec renders no literal, so an enum or value set on it is typed as the codec's whole output type.

### `enum-block-written-values`

1. Read `block.writtenValues?.[key]` in place of `block.numberTexts?.[key]`. A number entry is `{ kind: 'number', text }`, with the text as written.
2. Rename a `readWrittenNumber` hook to `readWrittenValueForCodec`, and read `written` in place of `text`.
3. Give every refused `WrittenValueReading` a `code`, such as `PSL_VALUE_TYPE_INCOMPATIBLE`.

```ts
// before
readWrittenNumber: ({ text, codecId, subject }) => ({ ok: false, message: `${subject}: refused` }),

// after
readWrittenValueForCodec: ({ written, codecId, subject }) => ({
  ok: false,
  code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
  message: `${subject}: refused`,
}),
```

The detection matches every file that names `WrittenValueReading`, including one that already sets `code`. Check each refused reading.

## Columns are compared by their data type

### `type-lookups-one-framework-type`

The pair of a codec lookup and a data type lookup has one type in the framework. Replace `SqlTypeLookups` and `MongoTypeLookups` with `TypeLookups`:

```ts
// Before
import type { SqlTypeLookups } from '@prisma/orm-family-sql/contract/data-type';
function storageTypeOf(codecId: string, lookups: SqlTypeLookups) {}

// After
import type { TypeLookups } from '@prisma/orm-framework/components/codec';
function storageTypeOf(codecId: string, lookups: TypeLookups) {}
```

`TypeLookups` asks only for `codecLookup.descriptorFor` and `dataTypeLookup.get`. Where your code needs the whole lookups, name them as type arguments: `TypeLookups<CodecLookupWithDescriptors, DataTypeLookup>`.

### `type-name-normalisers-removed`

`normalizeSchemaNativeType` and `normalizeSqliteNativeType` are gone. If you used them to decide whether two columns have the same type, compare the columns' data types instead, with `sqlColumnTypesEqual(a, b)` from `@prisma/orm-family-sql/schema-ir/types`: two columns have the same type when both have a `storedType`, the two are one data type, their `storedTypeParams` are equal, and both or neither are lists.

### `introspected-type-text`

```ts
// Before
const { nativeType, many, resolvedNativeType } = introspectedNativeType({
  formattedType, dataType: row.data_type, udtName, characterMaximumLength, numericPrecision, numericScale,
});

// After
const { typeText, many } = introspectedTypeText({
  formattedType, informationSchemaType: row.data_type, udtName, characterMaximumLength, numericPrecision, numericScale,
});
```

On the database side, `typeText` is the type as introspection reads it, such as `integer` or `timestamp(3) with time zone`, not a normalised name. On Postgres an enum is named as a contract names it (`mood`, or `app.status` outside `public`) and a type off the search path keeps its schema (`extensions.vector(3)`); on SQLite the declared type is lower-cased. On the contract side it is the name a migration writes.

### `schema-ir-column-type-text`

```ts
// Before
new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false, resolvedNativeType: 'int4' });

// After
import { pgInt4 } from '@prisma/orm-postgres/target/data-types';

new SqlColumnIR({
  name: 'id',
  typeText: 'int4',
  nullable: false,
  storedType: pgInt4,
  storedTypeParams: {},
});
```

A column with no `storedType` is one no data type claims, and it never compares equal to another, so a column a test builds by hand to compare needs `storedType` and `storedTypeParams`: the data type the column is stored as (the type its codec represents, unless that type is stored as another), and that type's parameters in normal form, such as `{ precision: 10, scale: 0 }` for `numeric(10)`. `storedTypeParams` is only for comparing; DDL writes the parameters as written, from `codecRef.typeParams`.

Read `column.typeText` where you read `column.nativeType`, and `column.storedType` where you read `column.dataType`; a reader that needs the type the codec represents gets it from `column.codecRef`. Code that compared `resolvedNativeType` compares types with `sqlColumnTypesEqual` instead. Code that read `codecBaseNativeType` to write DDL writes the type from `column.storedType` and the parameters in `column.codecRef.typeParams`, with `renderSqlTypeName` from `@prisma/orm-family-sql/contract/data-type`.

### `default-resolver-takes-the-column`

A resolver reads the column's `many` or `typeText` instead of a type name, and reads a default with the new readers:

```ts
// Before
import type { DefaultResolver } from '@prisma/orm-family-sql/family/control';
import { parsePostgresDefault } from '@prisma/orm-postgres/target/default-normalizer';

const resolve: DefaultResolver = (def, resolvedNativeType) =>
  def.kind === 'function' ? (parsePostgresDefault(def.expression, resolvedNativeType) ?? def) : def;

// After
import type { DefaultResolver } from '@prisma/orm-family-sql/family/control';
import { readPostgresDefault } from '@prisma/orm-postgres/target/default-normalizer';

const resolve: DefaultResolver = (def, column) => {
  if (def.kind !== 'function') return def;
  const read = readPostgresDefault(def.expression, column.many);
  return read.kind === 'function' ? read : def;
};
```

`readPostgresDefault` and `readSqliteDefault` always return a value. Where `parsePostgresDefault` or `parseSqliteDefault` returned `undefined` for an expression they could not read, the new readers return `{ kind: 'function', expression }` with the expression as reported. A literal is `{ kind: 'literal', literal }`, which the column's codec reads, not a `ColumnDefault`. `readSqliteDefault` takes the column's declared type, as `column.typeText` gives it.

A control adapter that implements `SqlControlAdapter` deletes its `normalizeDefault` member. Nothing called it.

### `control-adapters-take-declared-data-types`

```ts
// Before
import { PostgresControlAdapter } from '@prisma/orm-postgres/adapter/control';

const adapter = new PostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

// After
import { PostgresControlAdapter } from '@prisma/orm-postgres/adapter/control';
import { postgresDataTypes } from '@prisma/orm-postgres/target/data-types';

const adapter = new PostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
  postgresDataTypes,
);
```

```ts
// Before
import { SqliteControlAdapter } from '@prisma/orm-sqlite/adapter/control';

const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());

// After
import { SqliteControlAdapter } from '@prisma/orm-sqlite/adapter/control';
import { sqliteDataTypes } from '@prisma/orm-sqlite/target/data-types';

const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup(), sqliteDataTypes);
```

The adapter resolves each column the database reports to the first of these data types that claims it, in the order given. When your stack has extensions that declare data types, such as pgvector, pass `stack.declaredDataTypes.map(({ type }) => type)`, or build the adapter with the adapter descriptor's `create(stack)`, which does that for you. With only the target's types, a column of an extension's type is reported as one no data type declares.

### `resolved-sql-type-carries-the-data-type`

```ts
// Before
const resolved = resolveReportedSqlType(reported, dataTypes);
const type = dataTypes.find(({ id }) => id === resolved?.dataType);

// After
const resolved = resolveReportedSqlType(reported, dataTypes);
const type = resolved?.dataType;
```

The resolver already found the data type, so there is no second lookup, and no case where the id names no type in the list.

### `alter-type-postcheck-by-data-type`

```ts
// Before
const checkText = alterTypeCheckText('"app"."status"', dataTypes, where); // 'app.status'

// After
const check = alterTypeCheck('"app"."status"', dataTypes, where);
// { kind: 'identity', typeName: '"app"."status"', many: false }
```

A check of kind `catalog-text` holds the text `buildExpectedFormatType` gave for the same type. Code that read `AlterColumnTypeCall`'s `checkType` as a string reads `call.checkType.text` for a `catalog-text` check and `call.checkType.typeName` for an `identity` check.

## Type-constructor arguments are values of data types

### `value-arguments-name-a-data-type`

An argument is read as a value of its data type, through the same read and cast as an attribute argument (ADR 254), in PSL and in the TypeScript builder. Name the data type the argument takes:

```ts
// Before
Vector: {
  kind: 'typeConstructor',
  args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, maximum: 16000 }],
  output: { codecId: 'pg/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
},

// After
Vector: {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
  output: { codecId: 'pg/vector@1', typeParams: { length: { kind: 'arg', index: 0 } } },
},
```

Move any bound the argument carried to the data type's `params` schema, which the codec's `paramsSchema` references. A string argument becomes a value of the data type it names; an argument that holds SQL, such as a type name, is a value of `sql/expression`, written ``sql`...` ``. The data type must be registered in the stack and written by some authoring entry, itself or through a type it casts from: assembly refuses a value argument otherwise, with `CONTRACT.DATA_TYPE_UNREGISTERED` or `CONTRACT.DATA_TYPE_NOT_WRITABLE`. A type constructor argument still declared with another kind, `option` and `object` included, is refused when the stack is assembled, with `CONTRACT.PACK_CONTRIBUTION_INVALID` naming the constructor and the argument.

A field preset's `number`, `option` and `object` arguments are unchanged; convert only a type constructor's arguments. Detection cannot tell the two apart, so it also reports a field preset's arguments: leave those as they are, including the properties of an `object` argument.

### `value-argument-types-in-typescript`

A target or extension that registers a data type its arguments take declares the TypeScript value in its pack's type, beside `__codecTypes`:

```ts
export const myTargetPack: typeof myTargetPackBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __dataTypeArguments?: {
    readonly 'my/int': { readonly argument: number; readonly parameter: number };
  };
} = myTargetPackBase;
```

`argument` is what an author passes to the helper, and `parameter` is the type parameter the data type's reader gives for it, which the column's type is built from. An extension whose arguments take the target's types, such as `pg/int4`, declares nothing.

To type a descriptor of a value argument on its own, use `AuthoringValueArgument` from `components/authoring`; it now includes `name` and `optional`.

### `psl-and-print-helpers-take-data-types`

Pass the stack's `DataTypeSupport` to `mapPslHelperArgs({ ..., dataTypes })` and `instantiatePslFieldPreset({ ..., dataTypes })`. Replace `parsePslPositionalArgs` with the values of the call you built; to write a call's arguments back as PSL text, use `writtenTypeArguments(descriptor, args, dataTypes)`. A SQL target spreads `sqlTargetTypeConstructors({ sizeType: '<its size data type>' })` from `@prisma/orm-family-sql/family/pack` into its type namespace, and passes the same `sizeType` to `temporalCodecPresetWithPrecision`. Import `temporalCodecPresetWithPrecision` and `temporalStringAuthoringPresets` from `family/pack` too; `family/control` no longer exports them. The size type is the data type of a length or a precision: `pg/int4` on Postgres.

Import `assembleAuthoringDataTypes` from `components/authoring` instead of `components/control`. To build the data types a set of components reads values with, call `assembleDataTypeSupport(components, dataTypeOfCodec)`; it refuses a duplicate data type or entry, and a value argument whose data type is unregistered or that nothing writes.

### `composed-helpers-take-no-data-type-lookup`

Drop `dataTypeLookup` from the options of `createComposedAuthoringHelpers`:

```ts
// Before
createComposedAuthoringHelpers({ family, target, extensions, codecLookup, dataTypeLookup });

// After
createComposedAuthoringHelpers({ family, target, extensions, codecLookup });
```

The helpers read value arguments, and build entity helpers, with the data types the packs register. An argument whose data type no pack in the stack registers now fails with `CONTRACT.DATA_TYPE_UNREGISTERED`. Register it, with an `authoring.dataTypes` entry, in the pack that owns it. An extension whose arguments take a target's data type, such as `pg/int4`, registers nothing: the target already does, and a second registration is refused as a duplicate.

### `helper-codec-invariants`

Rename the call and pass the type constructors and field presets as `helpers`:

```ts
// Before
enforceDataTypeInvariants({ lookup, declaredTypes, codecs, authoringEntries, constructors, codecDescriptorFor });

// After
enforceHelperCodecInvariants({ lookup, helpers, codecDescriptorFor });
```

The checks on data types, entries, casts and written forms now run when you build data types with `assembleDataTypeSupport(components, dataTypeOfCodec)` from `components/authoring`; call it with the same components instead of passing `declaredTypes`, `codecs` and `authoringEntries`.

## Client generators are generator functions

`@default(fn())` now means a database default only. A value the client generates is written `@onCreate(fn())` or `@onUpdate(fn())`, and in TypeScript `.onCreate(gen.fn())`. The function resolves through the stack's generator function registry, by the column's codec.

### `default-functions-lower-to-database-defaults-only`

A default function whose `lower` returned `{ kind: 'execution', generated }` no longer compiles. Move it to a generator function on the pack ref (`src/exports/pack.ts`) and the control descriptor of the extension. One component declares the function's `signature`, a `FuncCallSig` as for a default function, or a function of the stack's data types that returns one (`generator-signature-from-data-types`). A binding maps codec ids to a `resolve` that turns the call's arguments and the column into a generator, and to `printArguments`, the reverse that `contract print` uses. `singleGeneratorBinding` from `@prisma/orm-framework/components/components` builds a binding for a function that takes no arguments:

```ts
// Before
const slugidEntry: ControlMutationDefaultEntry = {
  signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
  lower: () => ({
    ok: true,
    value: { kind: 'execution', generated: { kind: 'generator', id: 'slugid' } },
  }),
  usageSignatures: ['slugid()'],
};

const slugidPack = {
  // ...
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map([['slugid', slugidEntry]]),
    generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
  },
};

// After
import {
  type ExtensionPackRef,
  singleGeneratorBinding,
} from '@prisma/orm-framework/components/components';

const slugidPack = {
  // ...
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'slugid' }],
  },
  generatorFunctions: [
    {
      name: 'slugid',
      signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
      bindings: [singleGeneratorBinding({ codecIds: ['pg/text@1'], generatorId: 'slugid' })],
    },
  ],
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;
```

Put `generatorFunctions` and the generator descriptors on both the pack ref, which the TypeScript builder reads, and the control descriptor, which `contract emit`, `contract print` and the language server read. Every stack, the TypeScript builders included, checks that each binding produces a generator a descriptor registers. Declare the pack ref with `as const satisfies`, not a type annotation: the `gen` of a `defineContract` callback is built from the packs' declared functions and their signatures, so `gen.slugid()` exists only when the pack ref keeps its literal type. A binding's `resolve` may return only a generator id the binding lists in `generatorIds`; any other id throws `InternalError`. To bind a function another component declares, such as `uuid`, to a codec your extension adds, contribute a binding without a `signature`. Composing a stack fails with `CONTRACT.PACK_CONTRIBUTION_INVALID` when two components declare one function, when a binding names a function no component declares, when two bindings cover one function and codec, when two functions write one generator for one codec, when a binding produces a generator no generator descriptor registers, or when two components register one generator id.

### `sql-family-registers-identifier-generators`

The component that defines a generator registers it, and the SQL family now defines and registers `uuidv4`, `uuidv7`, `cuid2`, `ulid`, `nanoid` and `ksuid`. A SQL target, adapter or extension that registers any of them, for example by spreading `builtinGeneratorRegistryMetadata` into `generatorDescriptors`, must remove those entries; `builtinGeneratorRegistryMetadata` is removed. Two components that register one generator id make every stack fail with `CONTRACT.PACK_CONTRIBUTION_INVALID`: `Generator "uuidv4" is registered by both "sql" and "<your component>". Register each generator once, in the component that defines it.` An extension that binds `uuid` to a codec it adds keeps the binding and registers nothing for it. Register only the generators your component defines, such as `slugid`.

A default function that lowers to a database default, such as one that writes a SQL expression, does not change.

### `applicable-codec-ids-and-build-phases-removed`

`applicableCodecIds` on a generator descriptor is removed: a binding's `codecIds` say which codecs a generator fills, and `contract print` reads the `printArguments` of the binding. `buildPhases` had no caller. Delete both.

## Generator function arguments and column length

### `sql-target-declares-integer-argument-generators`

Add `generatorFunctions` to the target's pack ref and control descriptor, beside `authoring`:

```ts
import {
  idGeneratorFunctionBindings,
  sqlIntegerArgumentGeneratorFunctions,
} from '@prisma/orm-family-sql/family/pack';

generatorFunctions: [
  ...sqlIntegerArgumentGeneratorFunctions({ integer: myInt4.id }),
  ...idGeneratorFunctionBindings({ text: [MY_TEXT_CODEC_ID] }),
],
```

`integer` is the id of your target's 32-bit integer data type. An argument such as the `7` of `uuid(7)` is read and cast as a value of that type, as a column default is, then checked by the function: `uuid` takes 4 or 7, `cuid` takes 2, and `nanoid` takes 2 through 255. The `gen` helpers of a TypeScript contract keep their argument types.

### `generator-signature-from-data-types`

```ts
// Before
const arms = [...defaultFunctionRegistry.entries()].map(([name, entry]) =>
  funcCall(name, entry.signature as FuncCallSig),
);

// After
import { defaultFunctionCall } from '@prisma/orm-family-sql/contract-psl/attribute-specs';

const arms = [...defaultFunctionRegistry.entries()].map(([name, entry]) =>
  defaultFunctionCall(name, entry, dataTypes),
);
```

A generator function, new in this release (`default-functions-lower-to-database-defaults-only`), is read the same way with `generatorFunctionCall(contribution.name, contribution.signature, dataTypes)` from `@prisma/orm-framework/psl-parser`. A function you declare can keep a plain `FuncCallSig`. Write it as `(dataTypes) => FuncCallSig` when an argument is a value of a data type, read with `dataTypeValue(type, dataTypes)`.

### `generator-function-field-length`

Code that calls the registry passes the column's length:

```ts
import { sqlCodecColumnLength } from '@prisma/orm-family-sql/contract/data-type';

generatorFunctions.resolve(call, {
  codecId,
  typeParams,
  length: sqlCodecColumnLength(dataTypes, codecId, typeParams),
});
```

A binding of your own reads the length:

```ts
const binding: GeneratorFunctionBinding = {
  codecIds: ['pg/text@1', 'sql/char@1'],
  generatorIds: ['slugid'],
  resolve: ({ field }) =>
    field.length !== undefined && field.length < 22
      ? { ok: false, message: `slugid() writes 22 characters, which does not fit a column of ${field.length} characters.` }
      : { ok: true, generator: { kind: 'generator', id: 'slugid' } },
  printArguments: () => ({ args: {}, text: '' }),
};
```

### `build-contract-definition-takes-lookups`

```ts
// Before
const definition = buildContractDefinition({ family, target, createNamespace, models });

// After
const definition = buildContractDefinition({
  family,
  target,
  createNamespace,
  codecLookup,
  dataTypeLookup,
  models,
});
```

### `arg-binding-spec-label`

```ts
// Before
interpretArgs(args, { name: 'rel', positional, named }, ctx, span, node);

// After
interpretArgs(args, { label: 'Attribute "rel"', positional, named }, ctx, span, node);
```

### `one-of-refuses-data-type-value`

```ts
// Before
type: oneOf(str(), dataTypeValue(pgInt4.id, dataTypes)),

// After: a value of a data type is its own parameter
type: dataTypeValue(pgInt4.id, dataTypes),
```

### `text-data-types`

```ts
authoring: {
  textDataTypes: [citext.id],
},
```

## Contract types: one field type generic, and packs typed for `defineContract`

The emitted `contract.d.ts` of every family, and a contract built with `defineContract` in either family, now type their fields with one generic, `FieldTypesFromDomain` from `@prisma/orm-framework/contract/types`. A contract built with `defineContract` now has the same types as the `contract.d.ts` that `prisma contract emit` writes for it. The emitter reads a pack's codecs and descriptors at run time. A contract written in TypeScript has only the pack's types, so a pack states as types what the emitter derives. `QueryOperationTypesFunction` is exported from `@prisma/orm-family-sql/contract/types`, and `ParameterizedOutputTypesFunction` from `@prisma/orm-framework/contract/types`.

### `field-types-expression-removed`

Code written against 8.0.0-rc.18 never had `fieldTypesExpression`, so there is nothing to delete. The framework declares `FieldTypeOverrides` and `ParameterizedOutputTypeFunctions` itself and writes:

```ts
type FieldTypeOverrides = {
  readonly public: {
    readonly models: { readonly User: { readonly role: { readonly output: 'admin' | 'user'; readonly input: 'admin' | 'user' } } };
    readonly valueObjects: { readonly Address: { readonly kind: { readonly output: 'home' | 'work'; readonly input: 'home' | 'work' } } };
  };
};
export type FieldOutputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, 'output'>;
```

### `field-types-generic-moved`

8.0.0-rc.18 had no `FieldTypesFromDomain`, so code written against it needs no change. Code written against a development build after it imports `FieldTypesFromDomain` and `ValueTypeSide` from `@prisma/orm-framework/contract/types` instead of the SQL family's contract types entry. The generic now types value object and union fields itself, from the namespace's `valueObjects`. Its arguments are `FieldTypesFromDomain<DomainNamespaces, CodecTypes, ParameterizedOutputs, Overrides, Side>`, where `Overrides` is one map keyed like the domain, `[namespace]['models' | 'valueObjects'][owner][field]`, each entry `{ output?, input? }`; `ValueObjectTypesFromDomain` takes the same map. `ColumnTypesFromStorage` stays in the SQL family. For a storage map, apply `StoredValueType` from `@prisma/orm-framework/contract/types` to each entry, as `ColumnTypesFromStorage` does.

### `resolve-field-value-set-renamed`

Rename `EmissionSpi.resolveFieldValueSet` to `resolveStorageValueSet` in a family emitter, and drop any handling of domain enum references from it. The framework emitter now reads a field's value set itself when the field references a domain enum (`valueSet.plane` is `'domain'`), for model and value object fields alike, and no longer calls the hook for those fields. It calls `resolveStorageValueSet` only for other model fields, whose values the family keeps in its storage, such as a SQL column's value set.

### `typescript-contract-pack-type-slots`

A third-party SQL pack is typed fully for a `defineContract` contract only when it declares what an emitted `contract.d.ts` would get from its codecs and descriptors. Nothing breaks for a pack that does none of this; its operations, refined output types and aggregates are missing from a `defineContract` contract's types, as before.

**Query operations: `__queryOperationTypes`.** If your pack contributes query operations and exports a `QueryOperationTypes<CodecTypes>` type for its emitted `contract.d.ts`, declare it as a type-level function of the contract's codec types and add it to the pack metadata's type:

```ts
import type { QueryOperationTypesFunction } from '@prisma/orm-family-sql/contract/types';

export interface QueryOperationTypesForCodecs extends QueryOperationTypesFunction {
  readonly queryOperationTypes: QueryOperationTypes<this['codecTypes']>;
}

export const myPackMeta: typeof myPackMetaBase & {
  readonly __codecTypes?: CodecTypes;
  readonly __queryOperationTypes?: QueryOperationTypesForCodecs;
} = myPackMetaBase;
```

**Aggregates: literal `types.aggregateDescriptors`.** The aggregate result types of a `defineContract` contract are settled from the `types.aggregateDescriptors` of the target, the adapter and every extension, against the contract's codecs, as emission settles them. Only descriptors whose `operation`, input codec ids or traits, output codec id and `nullable` are literal types take part. Declare the list with `as const` and no annotation that widens it:

```ts
export const myAggregateDescriptors = [
  {
    operation: 'bitOr',
    input: { kind: 'codec', codecId: 'pg/int4@1' },
    output: { kind: 'codec', codecId: 'pg/int8@1' },
    nullable: true,
  },
] as const;
```

If you build descriptors with helper functions, make the helpers generic with `const` type parameters and do not use `satisfies` inside them: TypeScript widens a generic helper's result to its constraint when its returned object has a `satisfies` clause. Check the list against the descriptor type where you use it, for example `types: { aggregateDescriptors: myAggregateDescriptors satisfies ReadonlyArray<SqlAggregateDescriptor> }`.

**Index helpers: say what the build writes.** A contract built with `defineContract` types each index from the `IndexConstraint` a helper returns, so code reads it by name and passes it to query operations. `IndexConstraint` takes a third type parameter, the index's `map` name, type and options as the build writes them. If your pack adds an index helper, return `IndexConstraint<FieldNames, Name, { readonly map: Map; readonly type: 'yourType'; readonly options: Options }>` with literal types. When the options name fields that the build turns into column names, give an interface extending `IndexOptionsFunction` from `@prisma/orm-family-sql/contract-ts/contract-builder`, whose `options` reads `this['columnOf']`, the model's field-to-column map. See `fullTextIndex` in the Postgres pack.

**Declaration output: export what a contract names.** An application that exports a contract and builds with `declaration: true` needs TypeScript to name every type the contract's inferred type mentions. Export from your pack's `/pack` entry, as types, the types that end up there: your `CodecTypes`, the output types your type function gives (such as `Vector`), `QueryOperationTypesForCodecs`, `ParameterizedOutputTypesForTypeParams`, and the value types your codec types name (such as a GeoJSON `Geometry`). Naming `CodecTypes` also keeps TypeScript from inlining codec classes with private members, which fails with TS4094. Compile a small application that imports only your published package and the public `@prisma/orm-postgres` with `declaration: true` to check.

### Output types that depend on type parameters: one type function

This covers `parameterized-output-types-declared-once` (SQL packs) and `mongo-parameterized-output-types` (Mongo-family packs). If a codec's output type depends only on the column's type parameters, such as `Vector<3>` for `vector(3)`, write that mapping once, as a type-level function of the type parameters, and export it from your pack's `codec-types` entry:

```ts
import type { ParameterizedOutputTypesFunction } from '@prisma/orm-framework/contract/types';

type OutputTypeMap<TypeParams> = {
  readonly 'my/vector@1': TypeParams extends { readonly length: infer N extends number }
    ? Vector<N>
    : never;
};

export interface ParameterizedOutputTypesForTypeParams extends ParameterizedOutputTypesFunction {
  readonly outputTypes: OutputTypeMap<this['typeParams']>;
}
```

Name it in two places:

- In the pack metadata's type, as `readonly __parameterizedOutputTypes?: ParameterizedOutputTypesForTypeParams`. A contract built with `defineContract` reads it there.
- In the metadata of the component that contributes the codecs, next to the codec types import, as `types.codecTypes.parameterizedOutputTypes`. The emitted `contract.d.ts` imports it and types each column with type parameters through it:

```ts
types: {
  codecTypes: {
    import: { package: 'my-pack/codec-types', named: 'CodecTypes', alias: 'MyTypes' },
    parameterizedOutputTypes: {
      package: 'my-pack/codec-types',
      named: 'ParameterizedOutputTypesForTypeParams',
      alias: 'MyParameterizedOutputTypes',
    },
  },
},
```

Declare both. With only `__parameterizedOutputTypes`, the emitted `contract.d.ts` types such a column by the codec's plain output type; with only `types.codecTypes.parameterizedOutputTypes`, a contract built with `defineContract` does. Nothing reports the gap, so check a column on both paths.

Then delete the codec's `renderOutputType`, and the `typeImports` entry that existed only so the emitted file could name its result (such as `Vector`). A codec the map leaves out, or maps to `never` for some type parameters, keeps its plain output type. On SQL, a `renderOutputType` that writes such a type still works for the emitted file but is ignored by `defineContract`; keep `renderOutputType` only for a type that no type function can compute from the type parameters, such as the text of an arktype schema. On Mongo, `renderOutputType` is no longer used for such codecs: Mongo's vector codec no longer implements it, and a Mongo `defineContract` contract ignores it.

```diff
  class MyVectorDescriptor extends PostgresCodecDescriptor<{ readonly length: number }> {
    override readonly codecId = 'my/vector@1' as const;
-   override renderOutputType({ length }: { length: number }) {
-     return `Vector<${length}>`;
-   }
  }
```

A column helper that returns a column spec, built with `column(factory, codecId, typeParams)`, needs no entry: a `defineContract` contract reads the field's output type and codec id from the codec the factory builds.

Export `CodecTypes`, `ParameterizedOutputTypesForTypeParams` and the types they name from the pack's `/pack` entry, so an application that exports a contract can build declarations.

### `psl-interpreter-contract-capabilities`

`interpretPslDocumentToSqlContract` now puts the enabled capabilities you pass in `capabilities`, usually the composed stack's, into the contract's `capabilities`, together with the target's and the extensions'. Before, it used them only to check the schema and left them out of the contract. If you call it directly, expect the adapter's capabilities in the result, and pass the stack's capabilities if you build a contract to compare with one written in TypeScript or emitted by `prisma contract emit`.

## MongoDB fields have stored names

### `mongo-model-storage-fields`

```ts
// before
const keys = Object.keys(model.fields);
const hasId = Object.hasOwn(model.fields, '_id');

// after
import { ownDocumentIdFieldOf, ownStoredNamesOf } from '@internal/mongo-contract';

const keys = Object.values(ownStoredNamesOf(model));
const hasId = ownDocumentIdFieldOf(model) !== undefined;
```

`ownStoredNamesOf(model)` maps each of a model's own fields to its stored name; `valueObjectStoredNamesOf(valueObject)` maps each field of a value object, which has no storage block, to its own name. `storedNamesOf(models, name)` adds the fields a variant inherits from its base, and `modelAndBasesOf(models, name)` walks a model and its bases. A model built by hand, for example in a test, adds `fields` to its storage:

```ts
// before
{ fields: { _id: objectIdField, email: stringField }, relations: {}, storage: { collection: 'users' } }

// after
{
  fields: { _id: objectIdField, email: stringField },
  relations: {},
  storage: { collection: 'users', fields: { _id: { field: '_id' }, email: { field: 'email' } } },
}
```

## MongoDB validator derivation moves to the contract package

### `mongo-validator-derivation-moves-to-mongo-contract`

```ts
// before
import type { FieldValueSets } from '@internal/mongo-contract-psl';

// after
import type { FieldValueSets } from '@internal/mongo-contract';
```

Through the public package, import from `@prisma/orm-family-mongo/contract` instead of `@prisma/orm-family-mongo/contract-psl`.

### `mongo-derive-json-schema-replaced-by-derive-collection-validators`

`deriveJsonSchema` took the fields of one model and ignored its relations, so its validator could differ from the one a contract emits. `deriveCollectionValidators` takes the contract's models and derives the validator of every collection that stores a root model, with each variant as a `oneOf` branch.

```ts
// before
import { deriveJsonSchema } from '@internal/mongo-contract-psl';

const validator = deriveJsonSchema(
  ns.models['Account'].fields,
  { codecLookup, dataTypeLookup },
  ns.valueObjects,
  valueSets,
);

// after
import { collectionControlPoliciesOf, deriveCollectionValidators } from '@internal/mongo-contract';

const validator = deriveCollectionValidators({
  models: ns.models,
  lookups: { codecLookup, dataTypeLookup },
  valueObjects: ns.valueObjects ?? {},
  valueSets,
  controlPolicies: collectionControlPoliciesOf(contract),
})['accounts'];
```

`ns` is `contract.domain.namespaces[namespaceId]`, and `valueSets` is the storage namespace's `entries.valueSet`, as before. `controlPolicies` is required: only a collection whose control policy is `managed` gets a validator, as in an emitted contract. `collectionControlPoliciesOf(contract)` reads the policies a built contract declares. A call to `derivePolymorphicJsonSchema` becomes the same call: the validator of a root model with variants already has one `oneOf` branch per variant.

## Generated checks can no longer be waived

Prisma 8 adds a check to a list column of a managed table so that its elements cannot be null, and a check to an enum-typed column so that it holds only the enum's values. `@noCheck` in PSL and `.noCheck()` in TypeScript used to skip these checks while the field kept its non-null element type. The client type then said the elements could not be null while the database accepted null. Both are removed, from an extension's contract source as from an application's.

### `psl-nocheck-removed`

Write a list whose elements may be null as `T?[]`:

```prisma
// Before
scopes String[] @default([]) @noCheck(elementNotNull)

// After
scopes String?[] @default([])
```

The database does not change: neither form has a check. The element type in the extension's `contract.d.ts` gains `| null`, so code in the extension and in applications that read the list must handle null elements.

If you want the check instead, delete the attribute and keep `T[]`. An application that installs the extension then gets the check in its next migration of the extension's contract space. Applying it fails if a stored list already holds a null element.

Delete `@noCheck(membership)`. The next migration adds the membership check to the enum column. Applying it fails if a stored value is not one of the enum's values.

A bare `@noCheck` waived every check the column had. Apply both rules above.

On a table the extension does not manage (`@@control(external)` or a contract-level policy other than `managed`), no check is derived either way. Only the element type changes.

Re-emit the bundled contract with the extension's own emit script, and ship the new `contract.json` and `contract.d.ts` together.

### `ts-nocheck-method-removed`

The same rules apply to the TypeScript builder:

```ts
// Before
scopes: field.text().many().noCheck('elementNotNull'),

// After
scopes: field.text().many({ elementsNullable: true }),
```

Delete `.noCheck('membership')` the same way. Re-emit the bundled contract.

### `stored-contracts-drop-nocheck`

Migration snapshots that an extension ships, and any other stored `contract.json` written by an earlier release, may have a `noCheck` key on a column. This release refuses such a contract and says to re-emit it. A historical snapshot cannot be re-emitted from today's source, so run the script instead. Do this before you re-emit the bundled contract, and commit your work first so the script's changes can be reviewed and undone with git. Run it from the extension's package root:

```sh
node <guide>/scripts/remove-nocheck/remove-nocheck.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It removes the `noCheck` key from every column of every SQL contract under the root, in any `*.json` file, skipping `node_modules`, `dist`, `build` and every directory whose name starts with a dot, such as `.git`, `.agents` or `.claude`. It follows links to files and directories, also outside the root; commit or back up the files there too. That includes a test fixture of an old contract: if you keep one on purpose, restore it with git afterwards. Where the key waived the element check of a list, the script also makes the column, the field that maps it and their types in `contract.d.ts`, the row types such as `ReadonlyArray<CodecTypes['pg/text@1']['output'] | null>` included, lists whose elements may be null, which is what the source says after `psl-nocheck-removed`. The script does not change which checks a contract declares. In each PostgreSQL contract it also writes each literal default in the form this release stores, for example `"1.5"` on `numeric(10,2)` as `"1.50"`, because this release refuses a contract that stores another form, a snapshot included. The script carries this release's rules for each PostgreSQL built-in data type and for `postgis/geometry` and `pgvector/vector`, so its result does not depend on the installed packages. A geometry default is written as the upper-case little-endian HEXEWKB PostGIS prints, whatever case and byte order it had. It leaves a default of any other data type, such as one the extension defines, as it is. Besides the project root, it takes one option, `--default`, described below.

The storage hash changes, so the script also renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`.

When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A package with no `noCheck` key and no default in another form is left unchanged, and the script says so. It changes no file and exits 1, naming the file, when a `contract.json`, `migration.json` or ref is not valid JSON, when the `ops.json` of a migration whose hashes change is not valid JSON, when a contract's stored storage hash or snapshot directory name does not match its content (restore that file from version control, or re-emit it, and run the script again), or when a renamed snapshot directory already exists with different content, or when this release refuses a PostgreSQL default. If it stops partway, for example on a full disk, it says so; run it again to finish.

This release refuses a default that is not a value of its column's type, for example a time with more fraction digits than its column holds, a `pgvector/vector` element that `real` cannot hold exactly (`0.123456789` is stored as `0.12345679`), or a `postgis/geometry` in another SRID than its column's, and a list column's default that is not a list. The script names the file and column of each. Do not edit the stored file: that breaks its storage hash, and the next run refuses it. Choose the value the database stores, and run the script again with that value as JSON:

```sh
node <guide>/scripts/remove-nocheck/remove-nocheck.ts --default 'public.product.opensAt="12:34:00.123457"'
```

`--default` names the column as `<namespace>.<table>.<column>`, as the script's message does, and can be given once for each column. The script stores the value in every stored contract where that column's default is refused, migration snapshots included, checks it by the same rules and refreshes the hashes. It stops when the value is refused too, or when a `--default` names a column whose default it does not refuse. Then change the default in the contract source to the same value, so that re-emitting writes it.

Then re-emit the bundled contract. The extension's storage hash changes, so tell the applications that use it, in your release notes, to run `prisma db sign` against every database after they upgrade, and name the old and new hash. The app upgrade guide for this release has such a note for the Supabase extension, `supabase-contract-lists-allow-null-elements`. Tell them too that `prisma migration status` no longer marks the extension's migrations applied before the upgrade as applied, because each rewritten migration has a new hash and their databases' migration history keeps the old ones. `prisma db migrate` runs none of them again, and `prisma db verify` passes. A database that has not applied every migration yet is refused by a plain `prisma db sign`, and `prisma db migrate` stops on it with `MIGRATION.MARKER_MISMATCH`: tell them to sign it with `prisma db sign --contract <the last migration it applied>` and then run `prisma db migrate`. `--contract` takes the migration's directory name, or the new hash that migration goes to. `prisma migration status` prints the start of the old hash the database's marker holds, and the `<old> -> <new>` list in your release notes gives the new hash to sign with.

## Contract spaces an extension ships

An extension that ships a contract space, with its own `contract.json`, migration snapshots and contract source, upgrades them as an application upgrades its own. The sections of this guide named in the steps below explain each one. The scripts are under `scripts/` next to this guide. Run each script from the extension's package root.

Do the steps in this order, and skip a step that does not apply to the extension's contract space:

1. Commit your work, so every script's changes can be reviewed and undone with git.
2. Rewrite the stored contracts: `stored-contracts-drop-nocheck` above, then, for a SQLite contract space, `sqlite-contracts-name-datetime-and-json-data-types` (`scripts/data-type-values/data-type-values.ts`).
3. Change the contract source: `psl-nocheck-removed` and `ts-nocheck-method-removed` above, `date-time-interval-and-bytes-defaults-use-tags` and `client-functions-move-from-default-to-on-create` (`scripts/default-generators-to-on-create/rewrite-default-generators.mjs`, given the extension's Prisma 8 schema files).
4. Re-emit the bundled contract. That also writes PostgreSQL defaults in the new form (`postgres-defaults-stored-in-another-spelling`); `stored-contracts-drop-nocheck` in step 2 has already brought the migration snapshots to it. For a MongoDB contract space, then run `scripts/mongo-field-storage-names/mongo-field-storage-names.ts` (`mongo-contracts-record-stored-field-names`).
5. For each migration package of the contract space, change its `migration.ts` and write its `ops.json` again as `Migrations` below says.

For example, with `<guide>` the directory that holds this guide:

```sh
node <guide>/scripts/data-type-values/data-type-values.ts
node <guide>/scripts/mongo-field-storage-names/mongo-field-storage-names.ts
```

Each step that changes a storage hash changes the hash of the extension's contract space. Tell the applications that use the extension, in your release notes, to run `prisma db sign` against every database after they upgrade, and name the old and new hash, as `stored-contracts-drop-nocheck` says.

### `sqlite-contracts-name-datetime-and-json-data-types`

A SQLite contract stores the data type of each column. This release gives datetime and JSON values their own data types, and stores a datetime as `toISOString()` writes it, with exactly three fraction digits. A contract emitted by the previous release still names `sqlite/text`, so the CLI of this release refuses it with `CONTRACT.VALIDATION_FAILED`:

```text
storage.namespaces.__unbound__.entries.table.events.columns.at: codec sqlite/datetime@1 represents sqlite/datetime, not sqlite/text
```

Commit your work first, then run the script from the extension's package root:

```sh
node <guide>/scripts/data-type-values/data-type-values.ts
```

Node 24 or later runs the TypeScript script directly. It reads and writes files only. It rewrites every `*.json` file under the root that parses as a SQLite contract in the previous release's form, skipping `node_modules`, `dist`, `build` and every directory whose name starts with a dot, and follows links to files and directories, also outside the root. A test fixture of a contract in the previous release's form is rewritten too; restore it with git afterwards if you keep it on purpose. In each contract it changes:

- the `dataType` of each column and named type whose codec is `sqlite/datetime@1` or `sqlite/json@1`, from `sqlite/text` to `sqlite/datetime` or `sqlite/json`;
- each literal default of a `sqlite/datetime@1` column, and each value of an enum typed by `sqlite/datetime@1`, to three fraction digits: `"2024-01-01T00:00:00Z"` becomes `"2024-01-01T00:00:00.000Z"`. A JSON default keeps its value.

It then writes the storage hash each contract now has, renames the snapshot directory under `migrations/snapshots/` to that hash, and replaces the old hash in every `migration.json` (recomputing its `migrationHash`), every ref, every `migration.ts` and every `contract.d.ts`. The planned SQL does not change.

It prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`); put that list in your release notes. A package already in the new form, or with no SQLite contract, is left unchanged, and the script says so. It prints `<file>: stored hash did not recompute; rehashed from content` for a contract whose stored hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a `contract.json`, `migration.json` or ref is not valid JSON, when the `ops.json` of a migration whose hashes change is not valid JSON, or when a renamed snapshot directory already exists with different content. If it stops partway, for example on a full disk, run it again to finish. Run your formatter afterwards.

### `date-time-interval-and-bytes-defaults-use-tags`

In a Prisma 8 schema, a default of a date, time, interval or bytes column is written with the tag of the column's type. `contract emit` refuses a quoted string and shows the tag to write:

```text
Field "Event.at": Expected timestamptz`...`; write timestamptz`2024-01-01T00:00:00Z`
```

```prisma
// before
at      DateTime  @default("2024-01-01T00:00:00Z")
local   Timestamp @default("2024-01-01 12:34:56.500")
day     Date      @default("2024-03-15")
clock   Time      @default("12:34")
zoned   Timetz    @default("12:34:56+02")
span    Interval  @default("P1D")
payload Bytes     @default("AQID")

// after
at      DateTime  @default(timestamptz`2024-01-01T00:00:00Z`)
local   Timestamp @default(timestamp`2024-01-01 12:34:56.500`)
day     Date      @default(date`2024-03-15`)
clock   Time      @default(time`12:34`)
zoned   Timetz    @default(timetz`12:34:56+02`)
span    Interval  @default(interval`P1D`)
payload Bytes     @default(bytea`\x010203`)
```

On PostgreSQL the tag is named after the column's type: `timestamptz` for `DateTime`, `timestamp`, `date`, `time`, `timetz` and `interval` for the types of those names, and `bytea` for `Bytes`. A date or time tag takes the text you wrote. A `bytea` tag takes the bytes as hexadecimal after `\x`, not base64: `"AQID"` is the bytes 01 02 03, so write `bytea`\x010203``. For a quoted base64 string, `contract emit` names only the tag, because it cannot tell base64 from hex text; convert the bytes to hex yourself. On SQLite, a `DateTime` default uses the `datetime` tag, and a `Bytes` default the `blob` tag, whose body is the hex digits the quoted string held before.

### `mongo-contracts-record-stored-field-names`

A MongoDB contract now records each field's stored name in `model.storage.fields`, and names fields by their names in the schema: a field `id ObjectId @id @map("_id")` is `id` in the contract's `fields`, with `"storage": { "collection": "users", "fields": { "id": { "field": "_id" } } }`. Relations and a base model's `discriminator` name fields the same way. Indexes, validators and `execution` keep naming stored names, so the storage hash does not change.

1. Commit your work first.
2. Re-emit the bundled contract and commit the regenerated `contract.json` and `contract.d.ts`.
3. Run the script from the extension's package root:

   ```sh
   node <guide>/scripts/mongo-field-storage-names/mongo-field-storage-names.ts
   ```

   It rewrites every `*.json` file under the root that is a MongoDB contract with a model whose `storage` has no `fields`, skipping `node_modules`, `dist`, `build`, every directory whose name starts with a dot and every link it cannot follow, and the `contract.d.ts` next to it. These are the snapshots under `migrations/snapshots/<hash>/`, which no command regenerates. A snapshot cannot be rebuilt as a re-emit would write it, because the old contract does not say what the schema called a field, so the script keeps every field's name and records it as stored under that name: `"_id"` stays the field `_id`, stored as `_id`. Planning from such a snapshot to the re-emitted contract plans nothing. The script prints each file it rewrote, or that nothing changed. It edits the type of `storage` in each `contract.d.ts` on one line; run your formatter afterwards. If it cannot find a model's storage type in a `contract.d.ts`, it says so and exits 1: add `readonly fields: { readonly <field>: { readonly field: '<field>' }; ... }` inside that model's `readonly storage: { ... }` by hand.

## Migrations

### `setdefault-operation-class-derived`

`this.setDefault` on the PostgreSQL `Migration` class used to take `operationClass`, and `migration plan` wrote `operationClass: 'widening'` when a migration changed an existing default. The option is gone. The method reads the migration's start contract: the operation is widening when the start contract gives the column a default, and additive otherwise, including in a migration with no start contract. A `migration.ts` that passes the option no longer type-checks. Delete the option:

```typescript
// before
this.setDefault({ schema: 'public', table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }), operationClass: 'widening' })
// after
this.setDefault({ schema: 'public', table: 'user', column: col('role', 'text', { default: lit('member'), codecRef: { codecId: 'pg/text@1' } }) })
```

`node migration.ts` does not check types, so a file that still passes `operationClass` runs and ignores it. An applied migration needs nothing: `prisma db migrate` applies `ops.json`.

### Postchecks check the whole definition

The runner checks an operation's postchecks before it runs the operation. When they all hold, it records the operation as already applied and skips it. On MongoDB, which has no transaction, a run that fails part way relies on this skip when it runs again. Several postchecks held for an object of the planned name with another definition, so the runner skipped an operation whose effect was not in place, and the run failed later or left the object as it was. On PostgreSQL, SQLite and MongoDB these checks now check the whole definition.

The checks are written into `ops.json` when the migration package is written, so a package written by an earlier release still carries the old checks. Each detection below matches the old check of one operation. A matched `ops.json` needs action only when its migration is not applied yet: write its `ops.json` again before you apply it. Run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing; its operations do not run again. This applies to the migration packages an extension ships for its contract space as well.

#### PostgreSQL: the `postgres-postcheck-*` entries

Each of these operations now checks the object's definition in the catalog: kind, table, columns in order, types, referenced table and actions, access method, command and roles. It never compares text that PostgreSQL prints in its own form, such as expressions, predicates, check and policy bodies, or defaults. Renames now also check that the old name is gone.

- `postgres-postcheck-create-table`: `createTable` checks that the relation is a table, not a view, sequence or index of the same name.
- `postgres-postcheck-add-column`: `addColumn` checks the column's type, and that it is NOT NULL when the column is declared NOT NULL.
- `postgres-postcheck-add-column-with-temporary-default` and `postgres-postcheck-add-required-column-to-empty-table`: `addColumnWithTemporaryDefault` and `addRequiredColumnToEmptyTable` check the column's type.
- `postgres-postcheck-create-index`: `createIndex` checks that the relation is an index on the planned table, with the planned uniqueness, access method and columns in order, and with an expression and a predicate only where the call has them.
- `postgres-postcheck-rename-index`: `renameIndex` also checks that no index has the old name any more.
- `postgres-postcheck-add-primary-key` and `postgres-postcheck-add-unique`: `addPrimaryKey` and `addUnique` check that the constraint is a primary key or a unique constraint on the planned columns in order.
- `postgres-postcheck-add-foreign-key`: `addForeignKey` checks the constraint's columns, referenced table and columns in order, and its delete and update actions.
- `postgres-postcheck-add-check-constraint`: `addCheckConstraint` checks that the constraint is a check constraint.
- `postgres-postcheck-rename-constraint`: `renameConstraint` also checks that no constraint has the old name any more.
- `postgres-postcheck-create-rls-policy`: `createRlsPolicy` checks the policy's command, roles and whether it is permissive.
- `postgres-postcheck-rename-rls-policy`: `renameRlsPolicy` also checks that no policy has the old name any more, and its precheck now also refuses a policy that already has the new name.
- `postgres-postcheck-autoincrement-default`: `setDefault` with `autoincrement()` also checks that the column owns the sequence of the planned name and that the sequence has the column's integer width.

#### `postgres-autoincrement-sequence-follows-column-type`

An `autoincrement()` column takes its values from a sequence it owns. `ALTER COLUMN … TYPE` does not change that sequence, so a column widened from `int4` to `int8` kept a sequence `AS integer`, and inserts failed once it reached 2147483647. An `alterColumnType` on such a column, planned or hand-written in `migration.ts`, now also runs `ALTER SEQUENCE … AS <new width>`. It first refuses, before any step, when the sequence has already handed out a value past a narrower width. Its postcheck asks for both the column type and the sequence width. A column whose `nextval(...)` default reads a sequence it does not own changes type as before, and that sequence is left alone.

The detection matches every integer `alterColumnType` written before this change, and none written after it. Only those on an `autoincrement()` column need action:

- Migration not applied yet: write its `ops.json` again before you apply it, as above.
- Migration already applied: the sequence still has the old width. Change it to the column's width yourself, for example `ALTER SEQUENCE "public"."user_id_seq" AS bigint`. `pg_get_serial_sequence('"public"."user"', 'id')` names the sequence.

#### `setdefault-has-no-postcheck`

A `setDefault` operation without `autoincrement()` checked afterwards that the column has a default. The old default passes that check, so the runner skipped the operation. From 8.0.0-rc.15 until this release, only an additive `setDefault` carried the check, and a hand-written `this.setDefault` was additive unless it passed `operationClass: 'widening'`. Such a call on a column that already had a different default was skipped, and `prisma db migrate` then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`. Such a `setDefault` operation now carries no check afterwards; the final schema verification compares the default's value, and setting a default twice changes nothing. A `setDefault` with `autoincrement()` keeps its checks (`postgres-postcheck-autoincrement-default`).

A matched `ops.json` needs action only when its migration is not applied yet and a hand-written `setDefault` in its `migration.ts` changes a default the column already has. A package the planner wrote for a column with no default needs nothing.

#### `postgres-alter-column-type-unchanged-refused`

`this.alterColumnType({ schema, table, column, type, using })` to the type the migration's start contract, after its earlier renames, already gives the column, used to build an operation whose check, the column's type, already held. The runner skipped it and `using` never ran. `migration.ts` now refuses the call with `MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE`. Write the conversion as a `dataTransform`, which checks the rows themselves:

```typescript
// before
this.alterColumnType({ schema: 'public', table: 'user', column: 'email', type: 'text', using: 'lower(email)' })
// after
this.dataTransform(endContract, 'Lower-case user emails', {
  check: () => /* a query for the users whose email is not lower-case */,
  run: () => /* an update that lower-cases those emails */,
})
```

A matched `migration.ts` needs action only when the call converts a column to the type the start contract already gives it.

#### `sqlite-postchecks-check-full-definition`

- `createTable` checked only that a table of that name exists, whatever its columns. It now checks every column's name, type, nullability and primary key position.
- `addColumn` checked only that a column of that name exists. It now checks the column's type and nullability.
- `createIndex` checked only that an index of that name exists. It now checks the index's table, ordered columns and uniqueness.
- `recreateTable` did not check foreign key actions (`onDelete`, `onUpdate`) or `autoincrement()`. A migration that changed only those was skipped, and `prisma db migrate` then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`. It now checks them.

A `recreateTable` written for an `autoincrement()` change has no text to detect; write it again as well when its migration is not applied yet.

#### `mongo-postchecks-check-full-definition`

- `createIndex` checked only the index keys, and `unique: true` when the index is unique. An index on the same keys with other options, such as `sparse`, a TTL, a partial filter, a collation, a wildcard projection, or other text weights or languages, passed the check. It now checks `unique` and `sparse` both ways, `expireAfterSeconds`, `partialFilterExpression`, `wildcardProjection`, the collation fields the call gives (MongoDB fills in the others) or no collation when it gives none, and a text index's fields, `weights`, `default_language` and `language_override`.
- `collMod` with a validator that is not only a `$jsonSchema`, such as `{ status: { $in: [...] } }`, checked only the collection's validation level and action. It now compares the whole validator.

### Migration apply failures report the runner's own code

#### `control-client-apply-takes-invocation`

`dbInit`, `dbUpdate` and `migrate` on a control client write advice that names commands to run, and that advice needs to know where it will be run from. Pass it as the required `invocation` option, `{ cwd, configPath, dbGiven }`:

```ts
// Before
await control.dbUpdate({ contract, mode: 'apply', migrationsDir: 'migrations', answerQuestions });

// After
await control.dbUpdate({
  contract,
  mode: 'apply',
  migrationsDir: 'migrations',
  answerQuestions,
  invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
});
```

Add the same `invocation` to every `dbInit`, `dbUpdate` and `migrate` call. Set `configPath` to the config path your tool passes to `prisma`, and `dbGiven` to `true` when it passes `--db`. Pass `{ cwd: process.cwd(), configPath: undefined, dbGiven: false }` when nothing is run from a terminal.

A failure of these three operations is a `CliStructuredError`, so `DbInitFailure`, `DbUpdateFailure` and `MigrateFailure` are gone from `control-api`. Replace any use of them or their code types with `CliStructuredError`, and branch on `failure.code`, a dotted code such as `MIGRATION.PLANNING_FAILED`, instead of `'PLANNING_FAILED'`, `'RUNNER_FAILED'` or `'MIGRATION_PATH_NOT_FOUND'`.

The failure's fields change too:

| Before | After |
| --- | --- |
| `failure.summary` | `failure.message` |
| `failure.code === 'PLANNING_FAILED'`, `failure.conflicts` | `failure.code === 'MIGRATION.PLANNING_FAILED'`, `failure.meta.conflicts` |
| `failure.warnings` on a failed `dbInit` or `dbUpdate`, and `value.warnings` on a successful one | the `onPlannerWarnings(warnings)` option, called once per run when planning raised warnings, whether the apply then succeeds or fails |
| `failure.rowsWithoutValue`, `failure.failedTypeChange` | the runner's facts in `failure.meta`: `rowsWithoutValue` and `failedTypeChange`, and `schemaIssues` and `failedCheck` when the runner found them. A field in them is a subject object, not text such as `"User.age"` |
| `failure.failedMigration`, `failure.databaseStorageHash` | removed; the advice in `failure.fix` names the migration directory and the `--from` hash |

In `--json` output, `db init` and `db update` print the planner's warnings of a failed apply as `warn` messages before the error, instead of in the error's `meta.plannerWarnings`.

#### `runner-failures-report-own-codes`

`MIGRATION.RUNNER_FAILED` no longer exists. Code that reads `prisma db migrate`, `db init` or `db update` output with `--json`, or a control client's failure, and matches `MIGRATION.RUNNER_FAILED` or `meta.runnerErrorCode`, now matches the runner's code itself:

```ts
// Before
if (error.code === 'MIGRATION.RUNNER_FAILED' && error.meta.runnerErrorCode === 'MIGRATION.SCHEMA_VERIFY_FAILED') {
  report(error.meta.issues);
}

// After
if (error.code === 'MIGRATION.SCHEMA_VERIFY_FAILED') {
  report(error.meta.schemaIssues);
}
```

A check that matched `MIGRATION.RUNNER_FAILED` alone, meaning "the apply failed", matches every code the runner reports: `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED`, `MIGRATION.EXECUTION_FAILED`, `MIGRATION.POLICY_VIOLATION`, `MIGRATION.MARKER_ORIGIN_MISMATCH`, `MIGRATION.MARKER_CAS_FAILURE`, `MIGRATION.DESTINATION_CONTRACT_MISMATCH`, `MIGRATION.FOREIGN_KEY_VIOLATION` and, on MongoDB, `MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY`. `db init` and `db update` also report an extension space they cannot plan as `MIGRATION.PATH_UNREACHABLE` or `MIGRATION.NO_INVARIANT_PATH`, with `meta.spaceId`.

Read the facts from these `meta` keys:

| Before | After |
| --- | --- |
| `meta.issues` | `meta.schemaIssues` |
| `meta.operationId`, `meta.phase`, `meta.stepDescription` of a failed check | `meta.failedCheck.operationId`, `meta.failedCheck.phase`, `meta.failedCheck.description` |
| `meta.runnerErrorCode` | `code` |

`meta.failingSpace` is unchanged. `MIGRATION.PATH_UNREACHABLE` for a database with no marker now has `'empty'`, the empty contract's hash, in `meta.fromHash`, where it had `'<empty>'`. A failure also carries `meta.failedTypeChange` and `meta.rowsWithoutValue` when the runner found them.
