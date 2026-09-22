# @internal/ts-render

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

TypeScript source-text rendering utilities shared by any Prisma 8 component that has to emit hand-editable `.ts` files — today the Postgres and Mongo migration-authoring surfaces, later any new target that ships a migration-authoring experience.

## Overview

Two small pieces:

- **`TsExpression`** — abstract base class for any node that renders as a TypeScript expression in a generated source file. Subclasses supply `renderTypeScript(): string` and `importRequirements(): readonly ImportRequirement[]`. Hierarchical so that composite nodes (e.g. a `DataTransformCall` containing slot expressions) can recurse into their children.
- **`jsonToTsSource(value)`** — pure JSON-to-TypeScript-source printer. Accepts `unknown` for ergonomics with structural types whose fields happen to be JSON-compatible, and throws at runtime on anything that is not a JSON primitive / array / object.

## Codec → TS pipeline

`jsonToTsSource` is deliberately the **second** stage of a two-stage pipeline:

```text
jsValue  →  codec.encodeJson  →  JsonValue  →  jsonToTsSource  →  TS source text
```

Stage 1 (`codec.encodeJson`) is a codec responsibility — date serialization, opaque domain types (vector, bigint, uuid), JSON canonicalization. Stage 2 (this module) is a pure printer that must never grow type-specific branches. To render a non-JSON JS value (`Date`, `Vector`, `BigInt`, `Buffer`, …), encode it through the relevant codec's `encodeJson` first.

## Usage

```ts
import { type ImportRequirement, TsExpression, jsonToTsSource } from '@internal/ts-render';

class CreateTableCall extends TsExpression {
  constructor(
    readonly schema: string,
    readonly table: string,
    readonly columns: ReadonlyArray<{ name: string; typeSql: string; nullable: boolean }>,
  ) {
    super();
  }

  override renderTypeScript(): string {
    return `createTable(${jsonToTsSource(this.schema)}, ${jsonToTsSource(this.table)}, ${jsonToTsSource(this.columns)})`;
  }

  override importRequirements(): readonly ImportRequirement[] {
    return [{ moduleSpecifier: '@internal/postgres/migration', symbol: 'createTable' }];
  }
}
```
