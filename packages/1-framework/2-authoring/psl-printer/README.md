# @internal/psl-printer

> **Internal package.** This package is an implementation detail of Prisma 8 and is published only to support its runtime. Its API is unstable and may change without notice. Do not depend on this package directly; install `@prisma/cli` and a database facade (e.g. `@prisma/orm-postgres`) instead.

Prints Prisma Schema Language (PSL) from `PslDocumentAst` (`@internal/framework-components/psl-ast`).

## Overview

`@internal/psl-printer` renders deterministic PSL text from a `PslDocumentAst` (defined in `@internal/framework-components/psl-ast`). The package is target-agnostic: SQL → AST construction lives in the SQL family (`@internal/family-sql`'s `inferPslContract` capability).

## Responsibilities

- Convert structured AST (`model`, `field`, `enum`, `types`) into valid PSL output.
- Preserve `@map` / `@@map` and relation attributes from AST nodes.
- Generate deterministic output so snapshot-based tests remain stable.
- Open every printed file with the `// use prisma-8` marker. A caller adds one line saying where the file came from with the `description` option; `contract infer` and `contract print` each pass their own.

## Related Docs

- `docs/Architecture Overview.md`
- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
