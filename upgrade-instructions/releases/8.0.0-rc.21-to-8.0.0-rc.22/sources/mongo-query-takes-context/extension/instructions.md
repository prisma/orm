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
      `mongoOrm()` (`@internal/mongo-orm`, published as `@prisma/orm-family-mongo/orm` and `@prisma/orm-mongo/orm`) takes `{ context, runtime }`, as the SQL `orm({ context, runtime })` does. `MongoOrmOptions` loses `contract`, `executor`, `enums` and `mutationDefaults`: the ORM reads the contract, the codecs it builds enum accessors from, and the execution defaults from the context, and `runtime` is the executor. `mongoRaw()` takes `{ context }`. `createMongoCollection()` takes `({ context, runtime }, modelName)` (`MongoCollectionContext`, as the SQL ORM's `CollectionContext`) and always fills execution defaults. `MongoOrmEnums` and `ORM.MUTATION_DEFAULTS_MISSING` are removed, and the ORM no longer raises `ORM.ARGUMENT_INVALID` for missing enum accessors. The detection matches files that call `mongoOrm` or `mongoRaw` with a `contract` option, call `mongoOrm` with `executor` or `enums`, call `createMongoCollection` without a context object, pass `mutationDefaults`, or name `MongoOrmEnums` or `ORM.MUTATION_DEFAULTS_MISSING`.
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
      `MongoRuntimeOptions` is `{ context, adapter, driver, middleware?, mode? }`, as the SQL runtime's options are: the caller creates the adapter with `stack.adapter.create(stack)`, and the runtime checks middleware against `context.contract.target`, so `context` is a `MongoExecutionContext<MongoContract>`. `MongoExecutionContext` is declared in `@prisma/orm-family-mongo/query-ast/execution` (`@internal/mongo-query-ast/execution`), still exported from the runtime entry; it has no `stack` member and no second type parameter (`TTargetId`), and its type parameter is constrained as SQL's `ExecutionContext` is: `MongoExecutionContext<TContract extends MongoContract = MongoContract>`, and `createMongoExecutionContext` takes the same constraint. `MongoExecutionStack` has no `driver` member, and `createMongoExecutionStack()` takes no `driver` option. `buildMongoEnums()` and `MongoEnumAccessors` are removed, and `MongoExecutionContext` has no `enums` member, as SQL's `ExecutionContext` has none: the static context builds `db.enums` with the framework's `buildNamespacedEnums`, as `postgresStatic()` does, and the ORM builds the accessors it checks writes against from the context, once per client. The detection matches files that call `createMongoRuntime(`, read `.stack` from a context, give `MongoExecutionContext` two type arguments or a non-contract type argument, pass a driver to `createMongoExecutionStack`, or name `buildMongoEnums` or `MongoEnumAccessors`.
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
