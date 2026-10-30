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
      `mongoOrm()` takes `{ context, runtime }`, as the SQL `orm({ context, runtime })` does: pass the execution context instead of the contract, rename `executor` to `runtime`, and drop `enums` and `mutationDefaults`, which the ORM now reads from the context. `mongoRaw()` takes `{ context }` instead of `{ contract }`. `createMongoCollection()` takes `({ context, runtime }, modelName)`. The `MongoOrmEnums` type and the error code `ORM.MUTATION_DEFAULTS_MISSING` are gone. Use `db.orm` and `db.raw` from `mongo({ contract })`, or `mongoStatic({ contract }).raw`. The detection matches files that call `mongoOrm` or `mongoRaw` with a `contract` option, call `mongoOrm` with `executor` or `enums`, call `createMongoCollection` without a context object, pass `mutationDefaults`, or name `MongoOrmEnums` or `ORM.MUTATION_DEFAULTS_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])mongo(?:Orm|Raw)\s*(?:<[^>()]*>)?\s*\(\s*\{\s*contract\b'
        - '(?<![\w$.])mongoOrm\s*(?:<[^>()]*>)?\s*\(\s*\{(?:[^{}]|\{[^{}]*\})*\b(?:executor|enums)\b'
        - '(?<![\w$.])createMongoCollection\s*(?:<[^>()]*>)?\s*\(\s*(?!\{)'
        - '(?<![\w$])mutationDefaults\s*:'
        - '(?<![\w$])MongoOrmEnums(?![\w$])'
        - 'MUTATION_DEFAULTS_MISSING'
  - id: mongo-runtime-takes-adapter
    summary: |
      `createMongoRuntime()` takes `{ context, adapter, driver }`, as the SQL runtime does: create the adapter with `stack.adapter.create(stack)` and pass it beside the context. The runtime reads the target from `context.contract.target`, so build the context over the validated contract. `MongoExecutionContext` no longer has a `stack` member or a second type parameter, and its contract must be a MongoDB contract, as SQL's `ExecutionContext` requires a SQL contract: write `MongoExecutionContext<Contract>`, and build it with `createMongoExecutionContext({ contract, stack })` over a validated contract. `MongoExecutionStack` no longer has a `driver` member, and `createMongoExecutionStack()` no longer takes a `driver` option. `buildMongoEnums()` is removed: read the contract's enum accessors from `db.enums`, from `mongo({ contract })` or `mongoStatic({ contract })`. `MongoExecutionContext` has no `enums` member. The detection matches files that call `createMongoRuntime(`, read `.stack` from a context, give `MongoExecutionContext` two type arguments or a non-contract type argument, pass a driver to `createMongoExecutionStack`, or name `buildMongoEnums` or `MongoEnumAccessors`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\w$.])createMongoRuntime\s*\('
        - '(?<![\w$])[\w$]*[cC]ontext\s*\.\s*stack(?![\w$])'
        - '(?<![\w$])MongoExecutionContext\s*<(?:[^<>]|<(?:[^<>]|<[^<>]*>)*>)*,'
        - '(?<![\w$])MongoExecutionContext\s*<\s*(?:unknown|\{)'
        - '(?<![\w$.])(?:buildMongoEnums|MongoEnumAccessors)(?![\w$])'
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
const users = createMongoCollection(contract, 'User', executor, enums, context);

// After, as the SQL orm({ context, runtime })
const orm = mongoOrm({ context, runtime: executor });
const users = createMongoCollection({ context, runtime: executor }, 'User');
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

`MongoExecutionContext` takes one type parameter, a MongoDB contract: `MongoExecutionContext<Contract>`.
