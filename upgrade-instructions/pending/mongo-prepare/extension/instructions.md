---
changes:
  - id: mongo-runtime-has-prepare
    summary: |
      `MongoRuntime`, from `@prisma/orm-mongo/family-runtime`, has `prepare(declaration, callback)`, and the `MongoClient` that `mongo()` returns has it too. An object you type as `MongoRuntime` or `MongoClient` yourself, such as a test double, needs a `prepare` method.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - ':\s{0,20}(?:MongoRuntime|MongoClient<[^<>]{0,200}>)\s{0,20}=\s{0,20}\{'
        - '\bas\s{1,20}(?:unknown\s{1,20}as\s{1,20})?MongoRuntime\b'
        - '\bimplements\s{1,20}MongoRuntime\b'
  - id: mongo-limit-skip-take-placeholders
    summary: |
      `MongoLimitStage.limit` and `MongoSkipStage.skip`, from `@prisma/orm-mongo/query-ast/execution`, are `number | MongoPreparedParamRef`, and `MongoValue` includes `MongoPreparedParamRef`, the placeholder a `prepare` callback receives. Code that reads `stage.limit` or `stage.skip` as a number, or that handles every kind of `MongoValue`, must handle the placeholder.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongo(?:Limit|Skip)Stage\b'
        - '\bMongoValue\b'
---

# MongoDB prepared statements

## `mongo-runtime-has-prepare`

Give a hand-written `MongoRuntime` or `MongoClient` a `prepare` method. A test double that never prepares can throw:

```ts
const runtime: MongoRuntime = {
  query,
  execute,
  close: async () => {},
  prepare: () => Promise.reject(new Error('not used in this test')),
};
```

## `mongo-limit-skip-take-placeholders`

Where you read a `$limit` or `$skip` count from a stage, check for a placeholder before using it as a number:

```ts
const count = typeof stage.limit === 'number' ? stage.limit : undefined;
```

A placeholder's value is known only when a prepared statement runs.
