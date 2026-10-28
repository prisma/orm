---
changes:
  - id: mongo-query-takes-context
    summary: |
      `mongoQuery({ contract })` from `@prisma/orm-mongo/query-builder` no longer compiles: `mongoQuery` takes `{ context }`, an execution context. Replace `mongoQuery({ contract })` with `mongoStatic({ contract }).query` from `@prisma/orm-mongo/static`, or with `db.query` when you have a client from `mongo({ contract })`. Both validate the contract once. The detection matches files that call `mongoQuery` with a `contract` option, import it under another name, or call it through a namespace import.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongoQuery\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoQuery\s+as\s+[\w$]+'
        - '(?<![\s\S])(?=[\s\S]*\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*[\x27\x22](?:@prisma/orm-(?:family-)?mongo/query-builder|@internal/mongo-query-builder)[\x27\x22])[\s\S]*(?<![\w$.])\1\s*\.\s*mongoQuery\s*\('
  - id: mongo-orm-takes-context
    summary: |
      `mongoOrm()` and `mongoRaw()` take `{ context }`, an execution context, instead of `{ contract }`, as the SQL ORM does. `mongoOrm()` no longer has a `mutationDefaults` option: it fills generated fields such as `temporal.CreatedAt` through the context. The error code `ORM.MUTATION_DEFAULTS_MISSING` is gone, because the ORM can no longer be built without them. Use `db.orm` and `db.raw` from `mongo({ contract })`, or `mongoStatic({ contract }).raw`; code that builds the ORM itself passes `mongoOrm({ context, executor, enums })`. The detection matches files that call `mongoOrm` or `mongoRaw` with a `contract` option, pass `mutationDefaults`, or name `ORM.MUTATION_DEFAULTS_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongo(?:Orm|Raw)\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$])mutationDefaults\s*:'
        - 'MUTATION_DEFAULTS_MISSING'
  - id: mongo-runtime-takes-adapter
    summary: |
      `createMongoRuntime()` takes `{ context, adapter, driver }`, as the SQL runtime does: create the adapter with `stack.adapter.create(stack)` and pass it beside the context. The runtime reads the target from `context.contract.target`, so build the context over the validated contract. `MongoExecutionContext` no longer has a `stack` member or a second type parameter: write `MongoExecutionContext<Contract>`. `MongoExecutionStack` no longer has a `driver` member, and `createMongoExecutionStack()` no longer takes a `driver` option. The detection matches files that call `createMongoRuntime(`, read `.stack` from a context, give `MongoExecutionContext` two type arguments, or pass a driver to `createMongoExecutionStack`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])createMongoRuntime\s*\('
        - '(?<![\w$])[\w$]*[cC]ontext\s*\.\s*stack(?![\w$])'
        - '(?<![\w$])MongoExecutionContext\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*,'
        - '(?<![\w$.])createMongoExecutionStack\s*(?:<[^>()]*>)?\s*\(\s*\{(?:[^{}]|\{[^{}]*\})*\bdriver\b'
---

# The MongoDB query surfaces and runtime take an execution context

`mongoQuery`, `mongoRaw` and `mongoOrm` take `{ context }`, a MongoDB execution context, instead of `{ contract }`, as `sql({ context })` and the SQL ORM do. The context comes from `mongoStatic({ contract })` or `mongo({ contract })`, which validate the contract once.

```ts
// Before
import { mongoQuery } from '@prisma/orm-mongo/query-builder';
const query = mongoQuery({ contract });
const raw = mongoRaw({ contract });

// After
import mongoStatic from '@prisma/orm-mongo/static';
const { query, raw } = mongoStatic({ contract });

// Or, with a client
const db = mongo({ contract, url });
db.query.from('orders');
```

Code that builds the ORM itself passes the context, which also fills generated fields:

```ts
// Before
const orm = mongoOrm({ contract, executor, mutationDefaults: context, enums });

// After
const orm = mongoOrm({ context, executor, enums });
```

The runtime takes an adapter beside the context, as the SQL runtime does, and reads the target from the context's contract:

```ts
// Before
const runtime = createMongoRuntime({ context, stack, driver });

// After
const stack = createMongoExecutionStack({ target, adapter });
const context = createMongoExecutionContext({ contract, stack });
const runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });
```

`MongoExecutionContext` takes one type parameter, the contract: `MongoExecutionContext<Contract>`.
