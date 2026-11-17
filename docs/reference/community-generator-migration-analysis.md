# Community Generator → Prisma 8 Extension Analysis

## Purpose

Prisma ORM's community generator ecosystem reflects real user needs that exist independently of code generation. This document catalogs every community generator, identifies the underlying user need, determines how each maps to the Prisma 8 architecture, and sketches a design direction where applicable.

The goal is to inform which interfaces must be stable before approaching community authors.

## How Prisma 8 changes the picture

In Prisma ORM, generators receive the internal DMMF AST and produce files. In Prisma 8, there is no code generation step. Instead, the **contract IR** — a typed, validated runtime object — is the primary interface between the data model and everything that consumes it.

Generator use cases map to **consumer libraries** — functions that accept the contract IR and derive something from it. They follow the same pattern as query lanes (accept context, return a handle) and need no special pack SPI or plugin hook. They differ only in how much of the stack they need:

- **Runtime context** — for integrations that need the contract plus operations and codecs (validators, GraphQL resolvers, tRPC routers, test factories)
- **Contract only** — for tools that only need the schema graph (visualization, JSON Schema, OpenAPI, cross-language models, cross-ORM type derivation)

Both receive the contract IR, which is authoring-agnostic — it doesn't matter whether the schema was written in PSL or via the TypeScript builders. This avoids coupling external tools to PSL syntax or parser internals.

| Input level | What's available | Examples |
|---|---|---|
| Runtime context | Contract IR + operations + codecs | Validators, GraphQL, tRPC, test factories |
| Contract only | Schema graph (models, fields, relations, storage) | ERD, DBML, OpenAPI, Dart models, Drizzle types |

For reference, **pack extensions** (pgvector, PostGIS) change how Prisma 8 *behaves* via the extension descriptor SPI. No generator use cases fall into this category.

**Important caveat**: Today, the only implemented target family is SQL. The runtime context is `ExecutionContext` (SQL-specific), and the contract type is `SqlContract`. A `ContractBase` type and a `DocumentContract` stub exist in the framework layer, but the document family has not been implemented — no document target, no document execution context, no document ORM client. Many of the user needs cataloged here (validators, GraphQL, visualization, cross-language models) are conceptually family-agnostic — they care about models, fields, and relations, not SQL tables specifically. But the cross-family extension story is unvalidated. See [Cross-family support](#cross-family-support-and-fragmentation-risk) below.

---

## Categories and analysis

### 1. Schema Validation (runtime input/output validation)

**User need**: Validate data at application boundaries (HTTP request bodies, form submissions, API responses, message payloads) against the shape of database models. Users want type-safe validators that stay in sync with their schema without manual maintenance.

| Generator | Validation library | Adoption signal |
|---|---|---|
| [zod-prisma](https://github.com/CarterGrimmeisen/zod-prisma) | Zod | High |
| [prisma-zod-generator](https://github.com/omar-dulaimi/prisma-zod-generator) | Zod | Moderate |
| [prisma-joi-generator](https://github.com/omar-dulaimi/prisma-joi-generator) | Joi | Moderate |
| [prisma-yup-generator](https://github.com/omar-dulaimi/prisma-yup-generator) | Yup | Moderate |
| [prisma-class-validator-generator](https://github.com/omar-dulaimi/prisma-class-validator-generator) | class-validator | Moderate |
| [prismabox](https://github.com/m1212e/prismabox) | TypeBox | Lower |

This is a natural fit for a **consumer library**. Validation happens at runtime, and the contract on `ExecutionContext.contract` already contains everything needed — model names, field names and types, nullability, enum values, relation structure. A consumer library accepts the context and returns typed validators:

```typescript
import { createValidators } from '@internal/extension-validators/arktype';

const validators = createValidators(context);

// Type-safe: validators.user.create is an arktype validator matching UserCreateInput
const parsed = validators.user.create(requestBody);
```

This is the highest-value category — 6 generators addressing a universal need, and the contract IR already has all the required metadata. The type parameter pattern on `ExecutionContext<TContract>` ensures full type safety for the derived validators. Ready to build today.

---

### 2. GraphQL API Surface

**User need**: Automatically derive a GraphQL schema and resolvers from the data model. Users want to stand up a type-safe GraphQL API without manually writing every type definition, input type, and CRUD resolver.

| Generator | GraphQL framework | Notes |
|---|---|---|
| [typegraphql-prisma](https://github.com/MichalLytek/typegraphql-prisma) | TypeGraphQL | CRUD resolvers |
| [typegraphql-prisma-nestjs](https://github.com/EndyKaufman/typegraphql-prisma-nestjs) | TypeGraphQL + NestJS | Fork of above |
| [prisma-typegraphql-types-gen](https://github.com/YassinEldeeb/prisma-tgql-types-gen) | TypeGraphQL | Types only, editable |
| [nexus-prisma](https://github.com/prisma/nexus-prisma/) | GraphQL Nexus | Prisma-maintained |
| [prisma-nestjs-graphql](https://github.com/unlight/prisma-nestjs-graphql) | NestJS `@nestjs/graphql` | Types, inputs, args |
| [prisma-appsync](https://github.com/maoosi/prisma-appsync) | AWS AppSync | Full API including auth |
| [prisma-pothos-types](https://github.com/hayes/pothos/tree/main/packages/plugin-prisma) | Pothos | Types + n+1 solving |
| [prisma-generator-pothos-codegen](https://github.com/Cauen/prisma-generator-pothos-codegen) | Pothos | Full CRUD codegen |
| [prisma-generator-graphql-typedef](https://github.com/mavvy22/prisma-generator-graphql-typedef) | Schema-first (SDL) | Raw `.graphql` output |
| [nestjs-prisma-graphql-crud-gen](https://github.com/mk668a/nestjs-prisma-graphql-crud-gen) | NestJS + GraphQL | CRUD resolvers |

This is the largest category (10 generators). It splits into two sub-problems, both addressed by **consumer libraries**:

**A. Schema / type derivation** — derive GraphQL type definitions from the contract. Direct transformation: model → ObjectType, field → FieldDefinition, enum → EnumType, relation → nested type.

```typescript
import { createGraphQLSchema } from '@internal/extension-graphql';

const schema = createGraphQLSchema(context, {
  include: ['User', 'Post'],
  exclude: { User: ['password'] },
});
```

**B. Resolver derivation** — wire CRUD operations from the ORM client to GraphQL resolvers:

```typescript
import { createGraphQLResolvers } from '@internal/extension-graphql';

const resolvers = createGraphQLResolvers(context, {
  User: { queries: ['findMany', 'findUnique'], mutations: ['create', 'update'] },
});
```

Schema derivation (A) is straightforward — the contract metadata is sufficient. Resolver derivation (B) wires the ORM client's operations (`findMany`, `create`, `update`, `delete`) to resolvers. The framework-specific variants (Pothos, TypeGraphQL, NestJS, etc.) would each be a separate library. Pothos has the most modern API and would be a good starting point.

---

### 3. Schema Visualization & Documentation

**User need**: Understand, visualize, and communicate the data model. ERD diagrams, documentation sites, DBML for diagram tools, markdown docs with embedded diagrams.

| Generator | Output format | Notes |
|---|---|---|
| [prisma-dbml-generator](https://notiz.dev/blog/prisma-dbml-generator/) | DBML | For dbdiagram.io |
| [prisma-docs-generator](https://github.com/pantharshit00/prisma-docs-generator) | HTML docs | API reference |
| [prisma-erd-generator](https://github.com/keonik/prisma-erd-generator) | ERD image | Mermaid/Graphviz |
| [prisma-generator-plantuml-erd](https://github.com/dbgso/prisma-generator-plantuml-erd) | PlantUML / Markdown | Embedded diagrams |
| [prisma-markdown](https://github.com/samchon/prisma-markdown) | Markdown + ERD | With `@namespace` |
| [prisma-models-graph](https://github.com/dangchinh25/prisma-models-graph) | Graph visualization | Bidirectional relations |

Contract-only consumer libraries — they only need the schema graph (models, fields, relations, storage), not operations or codecs. A tool author writes a function like `contractToDbml(contract)` and the user calls it from a script, passing the contract loaded from either PSL or the TypeScript authoring surface. This need is conceptually family-agnostic (ERD diagrams work for any data model), though today the only available contract type is `SqlContract`.

---

### 4. Machine-Readable Schema Descriptions (JSON Schema, OpenAPI)

**User need**: Produce standard schema descriptions for interoperability. JSON Schema for form builders, documentation generators, and cross-language validation. OpenAPI specs for REST API documentation and client generation.

| Generator | Output format |
|---|---|
| [prisma-json-schema-generator](https://github.com/valentinpalkovic/prisma-json-schema-generator) | JSON Schema |
| [prisma-openapi](https://github.com/nitzano/prisma-openapi) | OpenAPI 3.x |

Same pattern as category 3 — contract-only consumer libraries. A `contractToJsonSchema(contract)` or `contractToOpenApi(contract)` function, with no Prisma 8 runtime dependency. Conceptually family-agnostic.

Note: runtime JSON Schema *validation* (validating a request body against a model shape) is a different use case — that's category 1 (schema validation), which needs the runtime context.

---

### 5. REST / RPC API Surface

**User need**: Automatically create REST endpoints or RPC routers (tRPC, Express) from the data model with CRUD operations.

| Generator | Framework | Notes |
|---|---|---|
| [prisma-trpc-generator](https://github.com/omar-dulaimi/prisma-trpc-generator) | tRPC | Full routers |
| [prisma-trpc-shield-generator](https://github.com/omar-dulaimi/prisma-trpc-shield-generator) | tRPC + Shield | Auth/permissions |
| [prisma-generator-express](https://github.com/multipliedtwice/prisma-generator-express) | Express | CRUD routes |
| [prisma-json-server-generator](https://github.com/omar-dulaimi/prisma-json-server-generator) | json-server | Mock API |
| [prisma-generator-nestjs-dto](https://github.com/vegardit/prisma-generator-nestjs-dto) | NestJS | DTOs + Swagger |

Same pattern as GraphQL — **consumer libraries** that accept `ExecutionContext` and wire contract metadata + ORM client operations to framework-specific API surfaces.

```typescript
import { createTrpcRouter } from '@internal/extension-trpc';

const appRouter = createTrpcRouter(context, {
  user: { procedures: ['list', 'get', 'create', 'update', 'delete'] },
  post: { procedures: ['list', 'get', 'create'] },
});
```

---

### 6. Cross-ORM / Query Builder Interop

**User need**: Use Prisma's schema definition as the source of truth for types, but query through a different query builder (Kysely, Drizzle).

| Generator | Target | Notes |
|---|---|---|
| [prisma-kysely](https://github.com/valtyr/prisma-kysely) | Kysely | Type definitions |
| [prisma-generator-drizzle](https://github.com/farreldarian/prisma-generator-drizzle) | Drizzle ORM | Schema definitions |

Users who want to query through Kysely or Drizzle are opting out of Prisma 8's runtime, guardrails, and plan model. They only need the schema graph. A consumer library accepting the contract can derive Kysely type definitions or Drizzle schema objects from the contract IR, regardless of how the schema was authored (PSL or TypeScript). This is one of the few categories that's inherently SQL-specific — Kysely and Drizzle are SQL query builders.

---

### 7. TypeScript Type Utilities

**User need**: Get clean TypeScript types/interfaces/classes representing data models, for DTOs, Swagger responses, serialization, or sharing between frontend and backend.

| Generator | Output | Notes |
|---|---|---|
| [prisma-generator-typescript-interfaces](https://github.com/mogzol/prisma-generator-typescript-interfaces) | Plain TS interfaces | Zero-dependency |
| [prisma-json-types-generator](https://github.com/arthurfiorette/prisma-json-types-generator) | Enhanced JSON field types | Type overlay |
| [prisma-class-generator](https://github.com/kimjbstar/prisma-class-generator) | TS classes | DTO/Swagger/TypeGraphQL |
| [prisma-custom-models-generator](https://github.com/omar-dulaimi/prisma-custom-models-generator) | Repository scaffolding | Empty wrapper stubs |

Already addressed:

- **Plain TS interfaces / types**: `contract.d.ts` provides zero-dependency typed model definitions.
- **Typed JSON fields** (`prisma-json-types-generator`): Prisma 8 has a more capable built-in solution. Library-bound JSON codecs (e.g. `@internal/extension-arktype-json`) accept a typed schema (arktype, zod, etc.), serialize the schema's IR into the contract, and validate inline inside the resolved codec's `decode` body — used for both compile-time typing (emitted into `contract.d.ts` as a concrete type expression) and runtime validation. Strictly more capable than the overlay approach.
- **Repository / custom models** (`prisma-custom-models-generator`): The ORM client's `Collection` subclassing is this pattern done properly — custom collections add domain methods that compose with all built-in query methods and propagate through includes. No scaffolding generator needed.
- **Class-based DTOs** (`prisma-class-generator`): Low relevance in Prisma 8's functional/interface-oriented design.

---

### 8. Cross-Language Model Definitions

**User need**: Generate data model representations in non-TypeScript languages for cross-platform apps (Dart/Flutter mobile apps sharing models with a Node.js backend).

| Generator | Target language |
|---|---|
| [prisma-generator-dart](https://github.com/FredrikBorgstrom/abcx3/tree/master/libs/prisma-generator-dart) | Dart / Flutter |

Same pattern as categories 3 and 4 — a contract-only consumer library. A `contractToDart(contract)` function produces Dart classes, and the same approach works for Swift structs, Kotlin data classes, or any other language target. Conceptually family-agnostic. No PSL parser dependency, no Prisma 8 runtime dependency.

---

### 9. Test Data Generation

**User need**: Generate realistic-looking fake data conforming to model structure for unit tests, integration tests, seeding, and demos.

| Generator | Notes |
|---|---|
| [prisma-generator-fake-data](https://github.com/luisrudge/prisma-generator-fake-data) | Uses faker.js patterns |

A natural fit for a **consumer library** — accepts `ExecutionContext` and derives factory functions from the contract's model/field metadata (types → appropriate faker functions, constraints → valid data, relations → linked factory chains, defaults → respected).

```typescript
import { createFactories } from '@internal/extension-test-factories';

const factories = createFactories(context);

const user = factories.user.build();
// { id: 1, email: 'user_1@example.com', name: 'John Doe', createdAt: '2024-01-15T...' }

const user2 = factories.user.build({ email: 'custom@example.com' });
```

Could also integrate with the ORM client for `seed` workflows (build factory data, then insert via ORM). Ready to build today.

---

## Summary matrix

| # | Category | Count | Input level | Family-agnostic? | Blocker |
|---|---|---|---|---|---|
| 1 | Schema Validation | 6 | Runtime context | Yes — models + fields | None — ready today (SQL) |
| 2 | GraphQL API Surface | 10 | Runtime context | Yes — models + fields + CRUD | ORM client API |
| 3 | Schema Visualization | 6 | Contract only | Yes — models + relations | None — ready today (SQL) |
| 4 | JSON Schema / OpenAPI | 2 | Contract only | Yes — models + fields | None — ready today (SQL) |
| 5 | REST / RPC API Surface | 5 | Runtime context | Yes — models + fields + CRUD | ORM client API |
| 6 | Cross-ORM Interop | 2 | Contract only | No — SQL-specific | None — ready today (SQL) |
| 7 | TS Type Utilities | 4 | Already addressed | — | — |
| 8 | Cross-Language Models | 1 | Contract only | Yes — models + fields | None — ready today (SQL) |
| 9 | Test Data Generation | 1 | Runtime context | Yes — models + fields | None — ready today (SQL) |

**Pattern observation**: All 37 generators are consumer libraries at two levels of the stack:

- **Runtime context consumers** (22 generators — categories 1, 2, 5, 9): Need the contract plus operations and codecs. Today this means `ExecutionContext` (SQL-specific).
- **Contract-only consumers** (11 generators — categories 3, 4, 6, 8): Need only the schema graph. Today this means `SqlContract`.
- **Already addressed** (4 generators — category 7): Needs covered by `contract.d.ts`.

Of the 33 non-trivial generators, **31 address family-agnostic needs** (models, fields, relations, CRUD). Only category 6 (cross-ORM interop — Kysely, Drizzle) is inherently SQL-specific. This makes cross-family support a significant concern for the extension story — see below.

None require the pack extension architecture (codecs, operators, migration ops). The pack architecture serves a different class of extensions (new column types, database features, etc.).

## Interface stability priorities

All 33 non-trivial generators (excluding category 7) depend on one or more of these interfaces:

1. **Contract type** — the schema graph (models, fields, relations, storage, capabilities). All 33 generators need this. Today this is `SqlContract`; a family-agnostic contract surface does not yet exist (see [cross-family support](#cross-family-support-and-fragmentation-risk)).

2. **Runtime context** — the full context including operations and codecs. The 22 runtime-context-level generators (categories 1, 2, 5, 9) depend on this. Today this is `ExecutionContext` (SQL-specific).

3. **ORM client API** — `findMany`, `create`, `update`, `delete` signatures. Categories 2 and 5 (GraphQL and REST/RPC — 15 generators) need stable ORM operations to wire resolvers/handlers.

**Already stable**: `contract.d.ts` type surface — already generated, already consumed by all lanes. Category 7 (TS type utilities) is essentially already addressed.

## Gaps identified

1. **No reference consumer library extension in the repo**: The consumer library pattern (accept context or contract, return a handle) is the same pattern that query lanes already follow — `sql({ context })`, `schema(context)`, `orm(context)` all accept `ExecutionContext` and return a surface for the user. Consumer libraries for validators, GraphQL, etc. would follow this same shape. However, there's no example in the repo that demonstrates this pattern for non-lane use cases. A small reference extension — one at the runtime context level and one at the contract-only level — would show community authors the minimal integration and make it obvious they don't need to learn the pack SPI.

2. **ORM client API stability**: Categories 2 and 5 (GraphQL, REST/RPC — 15 generators combined) need to wire CRUD operations from the ORM client. The ORM client exists and its API should be reliable, but we should confirm it's considered stable for external consumers.

3. **Contract type as a public API surface**: 11 generators (categories 3, 4, 6, 8) only need the schema graph. They should be able to accept the contract type directly without taking a dependency on the full runtime context. Today this means `SqlContract`, but see gap 4 — ideally this would be a family-agnostic type so these tools work with any target family.

4. **Cross-family support and fragmentation risk**: 31 of 33 non-trivial generators address family-agnostic needs, but every interface extensions would consume today is SQL-specific. Without validating the cross-family story, we risk stabilizing the wrong interfaces or creating an extension ecosystem fragmented by target and family. See [dedicated section below](#cross-family-support-and-fragmentation-risk).

## Cross-family support and fragmentation risk

Today, every interface an extension would consume is SQL-specific: `SqlContract`, `ExecutionContext`, the ORM client. This is the only implemented target family. A `ContractBase` type and `DocumentContract` stub exist in the framework layer, but the document family has not been built — there is no document target, no document execution context, no document ORM client.

This matters because **31 of 33 non-trivial generator use cases are conceptually family-agnostic**. A Zod validator for a User model, an ERD diagram, a Dart class generator — none of these inherently care whether the underlying database is Postgres or MongoDB. Only category 6 (cross-ORM interop — Kysely, Drizzle) is genuinely SQL-specific.

If we invite extension authors to build against `SqlContract` and `ExecutionContext` today, we risk two forms of fragmentation:

1. **Across database families**: Extensions that only work with SQL because they were built against SQL-specific interfaces. When the document family ships, these extensions would need rework — or users on MongoDB would have no access to the extension ecosystem.

2. **Across database targets**: Even within SQL, extensions could fragment by target. An extension that depends on Postgres-specific storage details (e.g. `jsonb` column metadata, Postgres-specific type params) would silently fail or produce incorrect results on MySQL or SQLite.

**Recommendation**: Before broad community outreach, validate the cross-family story with at least a document family proof of concept. Key questions to answer:
- What does a family-agnostic contract surface look like? Is `ContractBase` sufficient, or does it need to evolve?
- How does an extension detect what kind of contract it received?
- Can a single extension realistically target both SQL and document families?
- What does the runtime context look like for a document target?
- How should extensions declare which targets/families they support?
- Is there a lint or test pattern that catches accidental target-specific coupling?

Without answers to these questions, we risk stabilizing the wrong interfaces.

## Recommended prioritization for community outreach

### Tier 1 — Approach first (high value, high readiness, validates the consumer library pattern)

1. **Schema Validation** — zod-prisma / prismabox authors. Universal need, contract IR is ready. We'd build a reference implementation (arktype, per repo conventions) and let authors build for other validation libraries. This validates the core consumer library pattern.
2. **Test Data Generation** — prisma-generator-fake-data author. Clean consumer library pattern.

### Tier 2 — Approach after confirming ORM client API stability

3. **GraphQL API Surface** — prisma-pothos-types author (most modern, best architecture). Depends on ORM client operations.
4. **tRPC / REST Integration** — prisma-trpc-generator author. Same ORM client dependency.

### Tier 3 — Contract-only consumer libraries (ready today for SQL, lighter integration)

5. **Schema Visualization** — prisma-erd-generator / prisma-dbml-generator authors. Accept the contract, produce DBML / ERD / docs. Straightforward transformations. Conceptually family-agnostic.
6. **JSON Schema / OpenAPI** — Same pattern. Conceptually family-agnostic.
7. **Cross-ORM Interop** — Kysely, Drizzle type derivation. Inherently SQL-specific.
8. **Cross-Language Models** — Dart, etc. Conceptually family-agnostic. Community-driven.

### Not prioritized

9. **TS Type Utilities** — Already addressed by `contract.d.ts`.
10. **Class-based DTOs** — Low relevance in Prisma 8's design.
11. **json-server / mock API** — Very niche.

## Appendix: Complete generator inventory

| # | Generator | Category | User need summary |
|---|---|---|---|
| 1 | prisma-dbml-generator | Visualization | Visual schema representation via DBML |
| 2 | prisma-docs-generator | Visualization | API reference documentation |
| 3 | prisma-json-schema-generator | JSON Schema / OpenAPI | Standard JSON Schema for interop |
| 4 | prisma-json-types-generator | TS Type Utilities | Strongly typed JSON fields |
| 5 | typegraphql-prisma | GraphQL API | TypeGraphQL CRUD resolvers |
| 6 | typegraphql-prisma-nestjs | GraphQL API | TypeGraphQL + NestJS resolvers |
| 7 | prisma-typegraphql-types-gen | GraphQL API | TypeGraphQL types (editable) |
| 8 | nexus-prisma | GraphQL API | GraphQL Nexus projections |
| 9 | prisma-nestjs-graphql | GraphQL API | NestJS GraphQL types/inputs |
| 10 | prisma-appsync | GraphQL API | AWS AppSync full API |
| 11 | prisma-kysely | Cross-ORM Interop | Kysely type definitions |
| 12 | prisma-generator-nestjs-dto | REST / RPC API | NestJS DTOs + Swagger |
| 13 | prisma-erd-generator | Visualization | Entity relationship diagrams |
| 14 | prisma-generator-plantuml-erd | Visualization | PlantUML ER diagrams |
| 15 | prisma-class-generator | TS Type Utilities | Classes for DTO/Swagger/TypeGraphQL |
| 16 | zod-prisma | Schema Validation | Zod schemas from models |
| 17 | prisma-pothos-types | GraphQL API | Pothos types + n+1 solving |
| 18 | prisma-generator-pothos-codegen | GraphQL API | Pothos full CRUD codegen |
| 19 | prisma-joi-generator | Schema Validation | Joi schemas from models |
| 20 | prisma-yup-generator | Schema Validation | Yup schemas from models |
| 21 | prisma-class-validator-generator | Schema Validation | class-validator models |
| 22 | prisma-zod-generator | Schema Validation | Zod schemas (alternative) |
| 23 | prisma-trpc-generator | REST / RPC API | tRPC routers |
| 24 | prisma-json-server-generator | REST / RPC API | json-server mock API |
| 25 | prisma-trpc-shield-generator | REST / RPC API | tRPC auth/permissions |
| 26 | prisma-custom-models-generator | TS Type Utilities | Repository scaffolding stubs |
| 27 | nestjs-prisma-graphql-crud-gen | GraphQL API | NestJS GraphQL CRUD |
| 28 | prisma-generator-dart | Cross-Language | Dart/Flutter models |
| 29 | prisma-generator-graphql-typedef | GraphQL API | GraphQL SDL output |
| 30 | prisma-markdown | Visualization | Markdown + ERD docs |
| 31 | prisma-models-graph | Visualization | Bidirectional relation graph |
| 32 | prisma-generator-fake-data | Test Data | Realistic fake data |
| 33 | prisma-generator-drizzle | Cross-ORM Interop | Drizzle schema |
| 34 | prisma-generator-express | REST / RPC API | Express CRUD routes |
| 35 | prismabox | Schema Validation | TypeBox schemas |
| 36 | prisma-generator-typescript-interfaces | TS Type Utilities | Zero-dep TS interfaces |
| 37 | prisma-openapi | JSON Schema / OpenAPI | OpenAPI specification |
