---
changes:
  - id: mongo-query-takes-context
    summary: |
      `mongoQuery` (`@internal/mongo-query-builder`, published as `@prisma/orm-family-mongo/query-builder` and `@prisma/orm-mongo/query-builder`) takes `{ context }`, a `MongoExecutionContext`, instead of `{ contract }`, and reads the contract from it. Code that builds the builder itself passes the execution context it already has, for example `mongoQuery({ context })` after `createMongoExecutionContext({ contract, stack })`; code that has a client or a static context uses `db.query` or `mongoStatic({ contract }).query`. The detection matches files that call `mongoQuery` with a `contract` option, import it under another name, or call it through a namespace import.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongoQuery\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoQuery\s+as\s+[\w$]+'
        - '(?<![\s\S])(?=[\s\S]*\bimport\s*\*\s*as\s+([\w$]+)\s+from\s*[\x27\x22](?:@prisma/orm-(?:family-)?mongo/query-builder|@internal/mongo-query-builder)[\x27\x22])[\s\S]*(?<![\w$.])\1\s*\.\s*mongoQuery\s*\('
  - id: mongo-orm-takes-context
    summary: |
      `mongoOrm()` and `mongoRaw()` (`@internal/mongo-orm`, published as `@prisma/orm-family-mongo/orm` and `@prisma/orm-mongo/orm`) take `{ context }`, a `MongoExecutionContext`, instead of `{ contract }`, and read the contract from it. `MongoOrmOptions` loses `contract` and `mutationDefaults`: `mongoOrm({ context, executor, enums })` fills execution defaults through `context.applyMutationDefaults`. The error code `ORM.MUTATION_DEFAULTS_MISSING` is removed. The detection matches files that call `mongoOrm` or `mongoRaw` with a `contract` option, pass `mutationDefaults`, or name `ORM.MUTATION_DEFAULTS_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongo(?:Orm|Raw)\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$])mutationDefaults\s*:'
        - 'MUTATION_DEFAULTS_MISSING'
  - id: mongo-runtime-takes-adapter
    summary: |
      `MongoRuntimeOptions` is `{ context, adapter, driver, middleware?, mode? }`, as the SQL runtime's options are: the caller creates the adapter with `stack.adapter.create(stack)`, and the runtime checks middleware against `context.contract.target`, so `context` is a `MongoExecutionContext<MongoContract>`. `MongoExecutionContext` is declared in `@prisma/orm-family-mongo/query-ast/execution` (`@internal/mongo-query-ast/execution`), still exported from the runtime entry; it has no `stack` member and no second type parameter (`TTargetId`). `MongoExecutionStack` has no `driver` member, and `createMongoExecutionStack()` takes no `driver` option. The detection matches files that call `createMongoRuntime(`, read `.stack` from a context, give `MongoExecutionContext` two type arguments, or pass a driver to `createMongoExecutionStack`.
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
