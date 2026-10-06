# ADR 260 — The PSL binder binds, the caller builds it, and interpreters read its resolutions

**Status:** Accepted
**Date:** 2026-10-06
**Builds on:** [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md), [ADR 255 — Block specs bind top-level block values](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md)

---

## At a glance

The binder answers one question for every PSL consumer: which declaration does this name denote? Several consumers ask it. The SQL and Mongo interpreters ask it while they build a contract. The language server asks it to color tokens, show hover text, and jump to a declaration. If each consumer built its own binder, or looked names up on its own, two of them could disagree about the same name, and the editor could jump to a declaration that a diagnostic says the name does not denote.

So the binder is built once per snapshot, by the code that also builds the symbol table, and every consumer reads that one binder. This is what a PSL provider's `load()` does:

```ts
const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({ documents, sources });
const { binder, diagnostics: binderDiagnostics } = createBinder({ symbolTable, sources, context });

const interpreted = withSeedDiagnostics(
  this.interpret({ documents, sources, symbolTable, binder }, context),
  [...seedDiagnostics, ...mapPslDiagnostics([...symbolTableDiagnostics, ...binderDiagnostics], sources)],
);
```

Notice three things:

- `createBinder` takes the symbol table, the sources, and the same `ContractSourceContext` the interpreter receives. Nothing family-specific is passed separately.
- The binder reaches `interpret` as an input, next to the symbol table.
- The caller reports the binder's diagnostics, together with the parser and symbol-table diagnostics. `interpret` never reports them.

The language server does the same: its project artifacts build one binder per snapshot with `createBinder`, pass it to `interpret`, and read the same instance for semantic tokens, hover, and go-to-definition. Given this schema:

```prisma
namespace auth {
  model User {
    id Int @id
  }
}

model Post {
  id       Int       @id
  authorId Int
  author   auth.User @relation(fields: [authorId], references: [id])
}
```

the interpreter takes the type of `author` from the binder's resolution of `auth.User`, and go-to-definition on `User` or on `auth` reads that same resolution to find `model User` or the `namespace auth` block.

---

## Decision

The binder binds identifiers to symbols and does nothing else. The caller builds it and reports its diagnostics. Interpreters and the language server never look up a name written in the schema; they read the binder's resolutions. The sections below state each rule and why it holds.

### 1. The caller builds the binder

`createBinder({ symbolTable, sources, context })` is the only binder factory. The code that builds the symbol table builds the binder right after it, once per snapshot, and passes it to `interpret` through `PslInterpretInput.binder`:

```ts
export interface PslInterpretInput {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly binder: Binder;
}
```

`context` is the part of `ContractSourceContext` the binder needs: the authoring contributions (type constructors, field presets, attribute specs, block descriptors, data types), the mutation-default registry, and the family's diagnostic wording (section 4). `createBinder` derives every binding input from it, so the CLI passes its context unchanged. The language server passes its interpretation's context, or builds one from its control stack when no interpreter is configured, so it has a binder either way.

The SQL provider, the Mongo provider, and the language server all call `createBinder` the same way. Neither interpreter builds a binder.

The caller reports the binder's diagnostics. The CLI adds them to the seed diagnostics through `withSeedDiagnostics`; the language server adds them to each document's diagnostic list, filtered by file. This is the same rule that already applies to parser and symbol-table diagnostics: the code that runs a pass reports what the pass found.

**Why.** The language server needs the binder for navigation, and it needs it to be the binder interpretation used. When `interpret` builds its own binder, that binder is gone when `interpret` returns, and the language server would have to build a second one that could resolve names differently. Building the binder before `interpret`, in family-blind code, gives every consumer of a snapshot one binder, and makes the CLI and the language server produce the same binder diagnostics without either knowing which family is configured.

### 2. The binder only binds

The binder maps each identifier that mentions a declaration to a resolution: a model, a composite type, a named type, a block, a field, a namespace, a contributed type or namespace, a cross-space reference, or `unresolved`. It reports names it cannot resolve and attributes no spec claims. It does not check whether a resolved name is valid where it is written.

Validation belongs to the interpreters:

- a field preset used as a field type without a call is reported as `PSL_PRESET_NOT_CALLED`;
- a type constructor that needs arguments, written bare, is reported as `PSL_TYPE_CONSTRUCTOR_NOT_CALLED`;
- a name that resolves but that the family cannot store (a `types { }` binding in Mongo, for example) gets the family's `PSL_UNSUPPORTED_FIELD_TYPE`, with a message that says what the name is.

**Why.** Whether a resolved name is acceptable depends on the family and on the position it is written in. The binder is family-blind and shared by every consumer, so a validation rule placed in it either encodes one family's rules for all families or needs a family switch. Keeping the binder to binding also keeps its diagnostics to one kind of failure — a name that denotes nothing — which is what lets every consumer report them unchanged.

### 3. Interpreters and the language server read resolutions; they never look names up

An interpreter takes a field's type, an enum's members, and a discriminator's type from `binder.symbolForNode(...)` and from the declaration nodes of the resolved symbols. It never looks up a name it reads from the schema text, in the symbol table or anywhere else. The language server follows the same rule: semantic tokens, hover, and go-to-definition walk up from the cursor to the nearest node the binder resolved and read that resolution.

The attribute-spec construction context follows from this. `FieldAttributeSpecContext` carries the field's `typeResolution`, the binder's resolution of the field's type reference. SQL's `@default` takes the enum whose members it accepts from that resolution, and the discriminator check identifies `String` by the codec id of the resolved contributed type, so a named type based on `String` is accepted.

Two consequences hold for every consumer:

- **A consumer may assume the binder already reported an unresolved name.** When a type reference is `unresolved`, the binder's `PSL_UNRESOLVED_REFERENCE` is the only diagnostic. An interpreter reports its own unsupported-type diagnostic only for a reference that resolved.
- **Nobody filters binder diagnostics.** Every diagnostic the binder produces is reported as produced.

**Why.** A second lookup is a second scoping rule. Each place that resolves a name on its own can resolve it differently from the binder — ignoring a namespace, or finding a declaration the binder's scope chain hides — and then the contract, the diagnostics, and the editor disagree. Reading resolutions makes the binder the single answer, and makes it impossible for an interpreter to accept a name the binder reported as unresolved.

### 4. Family-specific diagnostic wording comes from the family descriptor

Two binder diagnostics need family wording: an attribute no spec claims (SQL and Mongo have different codes and migration hints), and an unresolved field type (Mongo names the current spelling of a type from an earlier Prisma version and lists its scalar types). The family descriptor declares both describers:

```ts
readonly pslDiagnostics?: {
  readonly describeUnsupportedAttribute?: unknown;
  readonly describeUnresolvedType?: unknown;
};
```

The CLI and the language server copy `stack.family.pslDiagnostics` into `ContractSourceContext.pslDiagnostics`, and `createBinder` restores the erased types and calls the describers. The fields are typed `unknown` because framework core cannot name parser types, the same erasure ADR 249 describes for attribute specs. No code branches on the family id.

**Why.** A control stack has exactly one family, so the family descriptor has one value for each describer by construction. Both callers already hold the stack, so both produce the same wording without knowing which family it is.

### 5. A named type's base resolves in a scope without the named types

In `types { Uuid = Uuid }`, the base `Uuid` resolves in a scope that holds the top-level declarations and the contributed types, but no named types. The base therefore binds to the contributed `Uuid`, and the named type refines it.

**Why.** A named type's base is the type it refines, so it cannot be a named type in the same `types` block, itself included. Removing named types from the base's scope states that rule once, in the binder, and gives every consumer the same answer for `Uuid = Uuid`.

### 6. Every qualifier gets its own resolution

For every qualified name the binder resolves — a type reference such as `auth.User`, or a qualified entity reference in an attribute argument or a block value — the binder records a resolution on the whole name and a separate resolution on the qualifier segment: `namespace` when `auth` is a user namespace (its symbol lists every block that declares it), and `contributedNamespace` for a namespace an extension contributes. A qualifier that is not a namespace, or does not resolve, records nothing on its segment.

The qualifier is bound by scope lookup, independently of which `oneOf` alternative the binder chooses. When every alternative of a `oneOf` fails, the binder keeps only the `unresolved` member resolutions from the failed attempts; the qualifier's resolution is kept because it was committed outside the alternatives.

Go-to-definition, hover, and semantic tokens read the qualifier's resolution. Go-to-definition on `auth` in `auth.User` returns every `namespace auth { … }` block, across files. Hover shows the namespace. Semantic tokens color the qualifier as a namespace when its resolution is a namespace, without looking the qualifier up in a scope.

**Why.** A qualifier denotes a declaration of its own, and a consumer that needs to know what it denotes would otherwise inspect `QualifiedName` segments and look the qualifier up, which section 3 rules out. Binding the qualifier outside the `oneOf` alternatives makes its resolution independent of how the member lookup ends: `auth.ghost` still has `auth` resolved, so the editor can navigate to the namespace while reporting the missing member.

### 7. Go-to-definition on a declaration's own name returns `null`

The binder records a declaration on its own name node, so `model User {` has a resolution at `User`. Go-to-definition returns `null` there.

**Why.** Navigating from a declaration's name to itself does nothing useful. The position gets a result once find references gives it one: a declaration's name is where editors conventionally list its uses.

---

## Consequences

- **One answer per name.** The contract, the CLI diagnostics, and every language-server feature read the same resolution for the same reference, because they read the same binder instance for a snapshot.
- **Callers do more.** Every caller of `interpret` — providers, the language server, and tests — builds the symbol table and the binder first. Tests use `bindPslSchema` from `@internal/psl-parser/test`, which returns the documents, sources, symbol table, binder, and seed diagnostics for one schema.
- **Diagnostics describe what was written.** An unknown name gets one diagnostic, from the binder. A preset or type constructor written bare, or a resolved name the family cannot store, gets a specific interpreter diagnostic instead of a catch-all.
- **Adding a resolution kind is a binder change.** A consumer that needs to know what a new kind of identifier denotes extends the binder; it does not add a lookup of its own.
- **Named types cannot be based on named types.** A base that names another named type does not resolve.

---

## Alternatives considered

**`interpret()` returns the binder it built.** The language server would read the binder from the interpretation result. Rejected: it changes the result type every caller of `interpret` uses, it gives the language server no binder when no interpreter is configured, and the binder would still be built inside family code, out of reach of the family-blind callers that report its diagnostics.

**Family-specific binder wrappers** (one SQL and one Mongo function that assemble `createBinder`'s inputs). Rejected: a family-blind caller cannot pick the right wrapper without knowing the family, and two wrappers can drift in what they pass to the binder, for example one including contributed model-attribute specs and the other not.

**A language-server binder built from framework parts only.** Rejected: without the family's contributions (type constructors, field presets, attribute specs, describers), it resolves names differently from the binder interpretation uses, so navigation and diagnostics disagree — the outcome this ADR exists to prevent.

**Guessing that an unknown qualifier is an extension pack missing from the configuration.** Every unresolved prefix before `.` would be reported as an uncomposed extension namespace. Rejected: the guess does not know whether such a pack exists, or whether the prefix is a namespace declared in the schema. An unresolved name gets the diagnostic for what it is: the binder's `Cannot find type "X.Y"` for a type reference, and the family's unsupported-attribute diagnostic for an attribute.

**Filtering binder diagnostics in the interpreter.** Each interpreter would drop the binder diagnostics it restates in its own words. Rejected: a family-blind caller reports binder diagnostics, so it cannot filter them by family, and a diagnostic that needs filtering is a diagnostic the binder should not produce, or should word differently through the family's describer.

**A `typeReferenceResolved` flag passed to interpreters.** The interpreter would skip its own unsupported-type diagnostic when the flag says the binder reported the name. Rejected: the flag repeats one bit of the binder's answer and leaves the interpreter looking up the name itself. Reading the resolution gives the interpreter both whether the name resolved and what it denotes.

**Family wording through authoring contributions.** The describers would be contributed through `authoring`, like attribute specs. Rejected: authoring contributions come from the family, the target, and every extension pack, so a value with one owner would need a check rejecting a second contributor. The family descriptor has one value by construction.

**Plain lookup for a named type's base.** Rejected: the base `Uuid` in `Uuid = Uuid` finds the named type itself and becomes a self-reference.

**Retrying the lookup when a base resolves to its own named type.** Rejected: it handles one case of a general rule. A base that names any named type, itself or another, is not a valid base, and a scope without named types states that directly.

---

## References

- [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md) — the combinator kit whose reference combinators read binder resolutions
- [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md) — the construction-time contexts, including `FieldAttributeSpecContext.typeResolution`, and the type erasure through framework core
- [ADR 255 — Block specs bind top-level block values](ADR%20255%20-%20Block%20specs%20bind%20top-level%20block%20values.md) — block references bound by the snapshot's binder
- `packages/1-framework/2-authoring/psl-parser/README.md` § Binder — scope chain, resolution kinds, and `oneOf` binding
