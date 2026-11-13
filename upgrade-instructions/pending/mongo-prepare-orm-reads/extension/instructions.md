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
  - id: mongo-prepare-member-removed
    summary: |
      `MongoPrepareMember`, from `@prisma/orm-mongo/family-runtime`, is removed. `prepare` is declared on `MongoRuntime` itself, and `MongoClient`, from `@prisma/orm-mongo/runtime`, declares its own `prepare`, which also takes an ORM read and returns `MongoPreparedFrom<Params, Q>`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongoPrepareMember\b'
  - id: mongo-where-filter-takes-placeholders
    summary: |
      `MongoWhereFilter`, from `@prisma/orm-mongo/orm`, lets each scalar field's value also be a `MongoPreparedParamRef`, the placeholder a `prepare` callback receives. Code that takes a `MongoWhereFilter` and reads a field's value as the field's type must handle the placeholder first.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bMongoWhereFilter\b'
  - id: compile-mongo-query-has-no-row-type
    summary: |
      `compileMongoQuery`, from `@prisma/orm-mongo/orm`, takes no type argument and returns `MongoQueryPlan<Record<string, unknown>>`. A call that passed a row type, `compileMongoQuery<Row>(...)`, no longer compiles.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bcompileMongoQuery\s{0,20}<'
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

## `mongo-prepare-member-removed`

Replace `MongoPrepareMember` with the type that has the `prepare` you call: `MongoRuntime` for a runtime, `MongoClient<Contract>` for a `mongo()` client. To name only the method, write `MongoRuntime['prepare']`.

## `mongo-where-filter-takes-placeholders`

Where you read a value out of a `MongoWhereFilter`, check for a placeholder before using it as the field's type:

```ts
import { isMongoPreparedParamRef } from '@prisma/orm-mongo/value';

const name = filter.name;
const label = name === undefined || isMongoPreparedParamRef(name) ? undefined : name.toUpperCase();
```

A placeholder's value is known only when a prepared statement runs.

## `compile-mongo-query-has-no-row-type`

Drop the type argument from `compileMongoQuery(...)`. Where you need a row type, type the rows where you read them.
