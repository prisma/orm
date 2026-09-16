# ADR 252 — A frozen earlier Prisma dialect is a contract source

Status: **Accepted**

Related: [ADR 163 — Provider-invoked source interpretation packages](<./ADR 163 - Provider-invoked source interpretation packages.md>) is the mechanism this decision uses: a contract source is a provider-invoked authoring package whose `load` returns a contract or diagnostics, and the CLI stays source-agnostic. [ADR 239 — Errors are structural envelopes with dotted namespace codes](<./ADR 239 - Errors are structural envelopes with dotted namespace codes.md>) and [ADR 245 — Errors are structured at origin](<./ADR 245 - Errors are structured at origin; results carry one ok discriminator.md>) govern the codes this source reports.

## The decision, in a config file

A project whose database is still owned and migrated by Prisma 7 points Prisma 8 at the Prisma 7 `schema.prisma` it already has:

```ts
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`prisma contract emit`, `prisma db sign`, and `prisma db verify` then work as they do for any other source. There is no second schema file, and nothing is hand-edited.

**An earlier Prisma schema language is a first-class contract source of Prisma 8, interpreted straight into the contract.** It is not converted to Prisma 8 PSL first, and it is not inferred from the database. The dialect is frozen: the source reads what that Prisma version accepts and nothing more.

## Why interpret the earlier dialect directly

Prisma 8 reads a contract; earlier Prisma versions read a schema. During a side-by-side period the earlier version still owns the database and its migrations, so its schema is the only description that stays current. Every alternative drifts. Inferring a contract from the database loses relation field names, ORM-side defaults, and automatic timestamps, and needs hand edits after every migration. Converting the schema once produces a second file that goes stale the next time the earlier version migrates.

Interpreting the schema on every `contract emit` makes the earlier schema the single source of truth for as long as the project keeps it, and removes the hand-editing step entirely.

## Every construct is described exactly, or it is a hard error

There is no third outcome. A construct is either lowered to a contract that describes the database exactly, or it is refused with a located diagnostic naming the construct and stating an edit that is valid in the earlier version. The source never guesses, never approximates, and never changes behaviour silently, because a contract that quietly describes something other than the live database is worse than a refusal: it passes `db sign` and fails later.

Two rules follow from that, and they set this source apart from a compatibility shim:

- **Prisma 8's own checks are not relaxed to admit a construct.** Where Prisma 8 PSL cannot spell a shape — an optional generated field, an update generator combined with a storage default — the source reports a hard error rather than loosening the parser or the interpreter that refuses it.
- **A construct Prisma 8 cannot express is a reason to build the feature.** The refusal records a gap in Prisma 8's own authoring surface, to be designed on its own terms. It is not a defect of the reader.

## Fidelity means what `db verify` compares

"Describes the database exactly" is defined by the comparison `db verify` performs against the database the earlier version built, not by how closely the contract resembles the schema text. `db verify` compares column native type and nullability, column defaults structurally, primary key columns but not the name, foreign key referential actions but not the name, unique constraints by columns, indexes by name plus uniqueness, type and columns, check constraints by name, and native enums by type name and ordered member list.

That definition decides several lowering rules on its own. Index names are reproduced exactly, because they are compared; foreign key and primary key names are left to Prisma 8, because they are not. Referential actions are always written explicitly. Enum member order is preserved. The measure of the work is a real database, built by the earlier version's own migrations, that verifies with zero findings.

## Where the pieces live

**The parser is shared, and the older grammar is opt-in.** `@internal/psl-parser` reads both languages. The differences the older dialect needs — attributes on enum members, and field lines inside a `view` block read as a model body so the interpreter can refuse the view with a span — are behind the `grammar: 'prisma7'` parse option. The default grammar is unchanged, so a Prisma 8 PSL schema keeps rejecting exactly what it rejected before, and no shared-parser change reaches a user who never adopts the older source.

**Dialect rules live in the family authoring package.** `@internal/sql-contract-prisma7` holds everything that is true of the dialect for the SQL family: block and attribute handling, relation pairing, junction tables, defaults, and the diagnostics. It has no target-specific knowledge and depends on no Prisma 7 package; nothing of the dialect enters the framework layer.

**Target facts arrive through a binding the target pack supplies.** `Prisma7TargetBinding` is the whole list of what a target must answer: the target pack and namespace factory, the datasource providers it accepts, the type map of what the earlier version creates for each scalar and native-type attribute, the native enum entity kind, the index types, the identifier byte limit, the junction relation field names, the "now" generator for each column codec, and how a literal default is read for a column whose codec does not take the written value. The Postgres target exports one instance of it.

```ts
// the facade wires the two together and publishes one function
export function prisma7Schema(schemaPath: string): ContractConfig {
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding });
}
```

A second family or target adds a package and a binding. Neither adds a branch to the CLI, the control plane, or the framework.

## Public names

One version-specific name per facade, and no aliases:

- `prisma7Schema(path)` from `@prisma/orm-postgres/config` reads a Prisma 7 PostgreSQL schema.
- `prisma6Schema(path)` from `@prisma/orm-mongo/config` names the MongoDB reader, whose dialect is Prisma 6, because Prisma 7 has no MongoDB connector.
- `prisma7Contract(path, { binding })` is the family-level factory the facades wrap. The facade name says `Schema` because a user points it at their schema file; the family name says `Contract` because it returns a `ContractConfig`.

A single version-free name across both facades was rejected: it would tell a MongoDB user nothing about which Prisma version's schema is accepted, and the accepted dialect differs per family. An alias giving one function two names was rejected for the usual reason — two spellings in guides and examples for one thing.

## Diagnostic codes

Codes are dotted `PSL.PRISMA7_*`, in the existing `PSL` namespace, declared as a typed union by the package that raises them. `PSL` therefore has three owning modules — the parser, the Prisma 8 PSL interpreter, and this source — each with its own local union; ADR 239's namespace table records all three.

**A named exception to ADR 245's rule 1:** `CONTRACT.SOURCE_DIAGNOSTIC` survives as the carrier for source diagnostics whose codes are not yet dotted. `contract emit` puts a dotted source code straight into the finding's `code`; an undotted legacy `PSL_*` code is wrapped as `CONTRACT.SOURCE_DIAGNOSTIC` with the original code in `meta.code` and in the summary. The exception ends when those codes convert, and no new undotted code may be added.

## How long this surface lives

For as long as the earlier version it reads is supported. It is a transition surface, not a permanent second authoring language: a project is expected to convert its schema to Prisma 8 PSL at cutover and drop the source. Retiring a reader is a separate decision, made when that Prisma version's support ends.

## Consequences

- A project mid-transition keeps one schema file. After each migration by the earlier version, `contract emit` and `db sign` bring Prisma 8 back in step; nothing else changes.
- The set of refusals is a standing list of gaps in Prisma 8's authoring surface, each with a real user behind it.
- Every lowering rule must be checked against SQL that the earlier version's own toolchain generated, not against its documentation. The committed proof schemas carry that SQL.
- Prisma 8 ships no dependency on any earlier Prisma package. The reader is built on the shared parser.

## Alternatives considered

**Convert the schema once, and author in Prisma 8 PSL from then on.** This is the cutover step, not the transition. As the primary shape it fails because the converted file drifts the next time the earlier version migrates, and because every Prisma 8 PSL spelling limit becomes a lossy conversion rule instead of a visible refusal.

**Read the earlier version's schema through its own WebAssembly parser.** Its processed output drops ignored fields and models, presents views as ordinary models, and can omit implicit referential actions — the exact details fidelity depends on. It also puts a multi-megabyte synchronous load on the emit path and a dependency on an earlier Prisma package into the product.

**Infer the contract from the database, then hand-edit.** The status quo it replaces. It cannot recover names or ORM-side behaviour that exist only in the schema, and the hand edits must be repeated after every migration.

**Relax the Prisma 8 checks that refuse the unspellable shapes.** Rejected. It would make the transition reader the reason Prisma 8's own language accepts something it was designed to refuse, and would hide the missing feature instead of recording it.

**Fill the capability gaps as part of the reader.** Views, opaque columns, and the MongoDB gaps are each their own piece of work with their own design. Bundling them would tie the transition surface to features that are not needed for it.
