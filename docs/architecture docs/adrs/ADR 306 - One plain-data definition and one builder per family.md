# ADR 306 — One plain-data definition and one builder per family

## At a glance

A MongoDB contract can be written in TypeScript, in Prisma 8 PSL, or read from a Prisma 6 schema. All three build through the same two steps:

```text
defineContract(...)    ─┐
Prisma 8 PSL           ─┼─>  ContractDefinition (plain data)  ─>  buildMongoContractFromDefinition  ─>  Contract
Prisma 6 schema        ─┘
```

```ts
import { buildMongoContractFromDefinition } from '@internal/mongo-contract-ts/contract-builder';

const built = buildMongoContractFromDefinition(definition, codecLookup, dataTypes);
if (!built.ok) {
  for (const refusal of built.failure.refusals) {
    // refusal.key names the part of the definition it is about, such as
    // { kind: 'index', model: 'User', position: 1 }
  }
}
```

**Decision.** Each family has one plain-data definition of a contract and one builder that turns it into a contract. Every contract source of the family produces the definition and calls the builder. Every family rule is checked once, in the builder, and each refusal comes back as data that names its subject by a key the definition carries. Each source reports the refusals in its own terms. SQL's definition and builder are those of [ADR 181](ADR%20181%20-%20Contract%20authoring%20DSL%20for%20SQL%20TS%20authoring.md); this ADR applies the same shape to every family and records MongoDB's.

## Why

When each source assembles its own contract, each also checks its own rules. The rules then drift: one source refuses what another accepts, the two word the same refusal differently, and the same schema written two ways gives two storage hashes. One builder makes a rule one piece of code. A parity test can then prove that a contract written two ways emits the same `contract.json`.

## How

### The definition

A definition is plain data with every name resolved. MongoDB's `ContractDefinition` holds:

- the target pack and the extension packs, which the contract records, and the default control policy;
- models, each with its collection, owner, storage relations, control policy, collection options and indexes, in the order the source wrote them;
- fields, each with its stored name, type, nullability, list shape, enum by name, the generated values its type gives, the generated values the source already resolved, and the generator calls it writes;
- relations, with cardinality and join fields;
- polymorphism: the base's discriminator field and listed variants, and each variant's base and its value as the source wrote it;
- value objects, enums, optional explicit roots, whether collections get validators, and the warnings the source collected.

MongoDB's definition carries polymorphism; SQL's does not yet, so SQL PSL still adds discriminators and variants to the built contract. SQL's builder also still throws its first refusal instead of returning refusals as data.

### The builder

The builder takes the definition, the codec lookup and the stack's data types. It returns either the contract with its warnings, or every refusal it found with its warnings. A refusal's key is one of: a model, a value object, a field (owner and name), an enum or enum member, an index (model and position in its list), a relation, a discriminator, a variant's base, or a model's collection settings.

Most refusals carry names and values, and each source words them. Some carry a sentence the builder wrote (`reason`, `message`, `signature`), which the sources pass through as written; where a source needs its own wording, the refusal carries a closed set of reasons instead, as the index shape rules do.

The builder checks the assembled contract last. Those refusals (kind `validator`) come back only when nothing else was refused, so a user sees them in a second round, after fixing the others.

### The sources

- **TypeScript.** `defineContract` lowers its builder objects to the definition, calls the builder, and throws the first refusal as a `CONTRACT.*` error. It still checks its own input, such as the packs it is given.
- **PSL.** The interpreter reads the schema into the definition. It keeps the rules about how a schema is written, such as attribute arguments, `@id` placement, back-relation pairing and unresolved references. It reports each refusal as a diagnostic at the place its key names, with PSL's codes and wording.
- **Prisma 6.** The reader builds with `writesCollectionValidators: false`, because a Prisma 6 database has none. It reports each refusal in its own diagnostics.

**The builder builds the definition it is given.** It checks the definition and refuses what is invalid, but it does not merge, drop or tidy what a source wrote. Tidying is a convenience of the authoring surface the user writes in. For example, Prisma 8 PSL and TypeScript `defineContract` merge an index the user wrote twice without a name to tell the two apart, and they do it before they call the builder. A source that reads an earlier Prisma version's schema exists to produce the contract of the database that version built, so `db sign` accepts it unchanged (ADR 252). It tidies nothing, and the builder keeps everything it describes, even an index the database holds that is redundant, such as an index on `[email, name]` beside one on `[email]`. Prisma 6 itself refuses two indexes on the same fields, so a Prisma 6 database never holds such a pair. MongoDB's builder still merges identical and redundant indexes itself, for every source, the Prisma 6 reader included; TML-3774 moves the merge into PSL and TypeScript and makes the Prisma 6 reader refuse two indexes on the same fields, as Prisma 6 does. SQL's builder still merges duplicate and redundant unnamed indexes itself, and the Prisma 7 reader escapes that only by naming every index; TML-3770 moves the merge into SQL's authoring sources.

## Consequences

- One rule, one implementation. A rule added to the builder applies to every source.
- A source can report every refusal at once, at its own position, because refusals are data, not thrown errors.
- Sources cannot differ in what they accept. A parity suite writes each case in TypeScript and in PSL and checks that the two emitted `contract.json` files are byte-identical.
- Index order is the source's own. The builder does not reorder indexes, because the storage hash depends on their order. When two indexes in one collection are identical, or one is a non-unique index made redundant by a unique index on the same keys and otherwise identical options, the builder removes one and keeps the survivor where it was written. That merge leaves the builder with TML-3774.

SQL does not follow this ADR fully yet. Its builder throws its first refusal, so SQL PSL places only the errors it catches and matches (TML-3730). SQL PSL also adds polymorphism to the contract after the builder runs, instead of carrying it in the definition (TML-2228).

## Alternatives considered

- **Each source keeps its assembly, and a shared function checks the built contract.** The contract has lost what the source wrote: the position of an index, the value a variant wrote, which type alias typed a field. Refusals could not be placed, and some rules could not be checked at all.
- **The builder throws its first refusal.** PSL would then report one problem per run, and could not place it without catching and parsing the error.
- **One definition shared by every family.** A definition is a family-layer type in the three-layer IR pattern: MongoDB's names collections and indexes, SQL's names tables and columns. Each family has its own definition, built the same way.
- **Copy SQL's definition exactly, and add polymorphism to the built contract afterwards.** MongoDB's `defineContract` already resolved polymorphism in its builder, and a step after the builder cannot place a refusal at a source position. A family's definition holds what the reference still lacks, and the reference catches up (TML-2228).
- **Each source keeps its assembly and calls shared helpers,** as MongoDB did with `deriveCollectionValidators` and `buildMongoStorage`. Model assembly, polymorphism, generated values and enum checks were still written once per source, and each new rule needed another helper and a call in every source.

## Related ADRs

- [ADR 181 — Contract authoring DSL for SQL](ADR%20181%20-%20Contract%20authoring%20DSL%20for%20SQL%20TS%20authoring.md) — SQL's definition and builder
- [ADR 173 — Polymorphism via discriminator and variants](ADR%20173%20-%20Polymorphism%20via%20discriminator%20and%20variants.md)
- [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md) — the discriminator rule and how written values are read
