---
changes:
  - id: mongo-collection-has-prepared
    summary: |
      `MongoCollection`, from `@prisma/orm-mongo/orm`, has a `prepared` member (`all()`, `first()`, `firstOrThrow()`), and its `limit` and `offset` take a number or a prepared placeholder. An object you type as `MongoCollection` yourself, such as a test double, needs `prepared`, and its `limit` and `offset` must accept the wider argument.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - ':\s{0,20}MongoCollection<[^<>]{0,200}(?:<[^<>]{0,200}>[^<>]{0,200}){0,4}>\s{0,20}=\s{0,20}\{'
        - '\bimplements\s{1,20}MongoCollection\b'
  - id: mongo-client-prepare-is-its-own
    summary: |
      `MongoClient.prepare`, from `@prisma/orm-mongo/runtime`, also takes an ORM read and returns `MongoPreparedFrom<Params, Q>`. `MongoClient` no longer extends `MongoPrepareMember`, so a client assigned to a variable typed `MongoPrepareMember` no longer type-checks.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongoPrepareMember\b'
---

# MongoDB prepared ORM reads

## `mongo-collection-has-prepared`

Give a hand-written `MongoCollection` a `prepared` member, and widen `limit` and `offset`. A test double that never prepares can throw:

```ts
const users: MongoCollection<Contract, 'User'> = {
  // ...
  limit: (n) => users,
  offset: (n) => users,
  prepared: {
    all: () => { throw new Error('not used in this test'); },
    first: () => { throw new Error('not used in this test'); },
    firstOrThrow: () => { throw new Error('not used in this test'); },
  },
};
```

## `mongo-client-prepare-is-its-own`

Type a value that holds a `mongo()` client as `MongoClient<Contract>`, not `MongoPrepareMember`. `MongoPrepareMember` is the `prepare` of a `MongoRuntime`, which takes plans only.
