# ADR 269 — PSL mixins

**Status:** Accepted.
**Date:** 2026-10-10
**Builds on:** [ADR 104 — PSL extension namespacing & syntax](ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md), [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md), [ADR 262 — Block specs bind top-level block values](ADR%20262%20-%20Block%20specs%20bind%20top-level%20block%20values.md)

---

## At a glance

A mixin is a named set of block members, written once and included in any number of blocks of one kind:

```prisma
model mixin Timestamps {
  createdAt DateTime @default(now())
  updatedAt DateTime @default(now())
  @@index([createdAt])
}

enum mixin BaseRoles {
  ADMIN
  USER
}

enum Role {
  @@type("pg/text@1")
  +BaseRoles
  GUEST
}

namespace public {
  model Profile {
    id     Int    @id
    +Timestamps
    userId String

    @@rls
  }

  model Document {
    id     Int    @id
    userId String
    +Timestamps

    @@rls
  }

  policy_select mixin OwnerRead {
    roles = [authenticated]
    using = sql`"userId"::uuid = auth.uid()`
  }

  policy_select profile_owner_read {
    target = Profile
    +OwnerRead
  }

  policy_select document_owner_read {
    target = Document
    +OwnerRead
  }
}
```

- `Profile` has the fields `id`, `createdAt`, `updatedAt`, `userId`, in that order, and an index on `createdAt`. `Document` has `id`, `userId`, `createdAt`, `updatedAt` and an index on its `createdAt`.
- `Role` has `ADMIN`, `USER`, `GUEST`.
- Each policy has `target`, `roles` and `using`.

The emitted contract is the same as if every member had been written in the block that includes it.

## Problem

A schema repeats members: the same timestamp fields in many models, the same values in several enums, the same roles and predicate in every row-level security policy. Authors need to write such a set once and reuse it in models, composite types, enums and the block kinds extensions define ([ADR 126](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md)).

An earlier team decision covered models only: `mixin Name { … }`, included with `@@include(Name)`. That declaration does not say which kind of block the mixin is for, and the parser needs to know. It chooses how to read a body from the block's keyword: fields for `model` and `type`, bare members for `enum`, `key = value` entries for any other keyword. One grammar for all three cannot tell a bare enum member from a field whose type is missing.

## Decision

**Declaration: `<keyword> mixin <Name> { … }`.** A mixin starts with the keyword of the block it is for, and its body is read exactly as the body of a block with that keyword. A mixin is for one keyword and always has a name. The keyword may be any block keyword except `namespace` and `types`.

**Inclusion: `+<Name>` as a body member.** The mixin's keyword must equal the keyword of the including block: `OwnerRead` above can be included only in `policy_select` blocks, and a `policy_update` block needs a mixin of its own. `+` is a new token that no member could start with before, so no existing schema changes meaning. Directly before a digit it is still the sign of a number: `@default(+1)` is `1`.

**`mixin` is reserved as a block keyword and as a block name.** `mixin X { … }` and `model mixin { … }` are errors that say what a mixin declaration needs, and no extension can define a block kind named `mixin`. Field names, entry keys and attribute arguments spelled `mixin` are unaffected. PSL syntax freezes at the release candidate: reserving the word before then breaks nothing, and reserving it later would be a breaking change.

**Mixins are namespace members.** A mixin shares its namespace's names with models, composite types and blocks, so a mixin and a model of one name are a duplicate declaration. An unqualified inclusion is looked up in the namespace of the including block, then at the top level. `+auth.Timestamps` is looked up in the namespace `auth` only.

**Position decides order.** The mixin's members are placed where the inclusion is written, and that is the order the symbol table, the binder and the interpreters read. Where the contract keeps order, the position shows: an enum's members are an ordered list, so moving an inclusion in an enum changes the emitted contract, and `contract print` lists fields in this order. A model's fields and a table's columns are keyed and sorted in the emitted `contract.json`, and tables are created with their columns in that order, so moving an inclusion in a model changes neither, with or without mixins.

The grammar that reads the schema of an earlier Prisma version ([ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version%27s%20schema%20is%20a%20contract%20source.md)) has neither form: there `model mixin { … }` is a model named `mixin`.

## Semantics

**A block behaves as if the mixin's members were written at the inclusion.** For every block kind, a schema that uses a mixin and the same schema written inline emit the same contract. The contract does not record mixins.

**Names in a mixin body are resolved where the mixin is written.** A field's type is looked up from the mixin's namespace, not from the namespace of a block that includes it. A field named in one of the mixin's attributes must be a field the mixin declares. This rules out a mixin attribute that names a field of the including model: `@@unique([tenantId, id])`, where `tenantId` comes from the mixin and `id` from the model, is written in the model. An attribute written in a block can name any of the block's fields, including one a mixin provides.

**A member provided twice is an error.** There is no precedence and no override. The first member in source order is kept and the later one is reported. When a field name or entry key is already present as an inclusion is reached, from the block itself or from an earlier inclusion, the error is at the inclusion, and the mixin's other members are still included. When the block's own member follows the inclusion that provided the name, the error is at that member. Including one mixin twice in a block is an error at the second inclusion. Attributes are not compared: whether a block may carry two `@@index` attributes is each interpreter's rule.

**A mixin cannot include a mixin**, and **a mixin is not a type**: a field whose type names a mixin is an unresolved reference.

## Where inclusions are replaced

The parser builds a syntax tree, the symbol table collects every declaration with its members, and the binder decides what each written name refers to. Family interpreters read the symbol table and the binder.

**Inclusions are replaced while the symbol table is built.** Once the declarations of all files are collected, each including block receives the mixin's fields or entries and its attributes at the inclusion's position. The binder and the family interpreters therefore read ordinary blocks. No interpreter tests whether a member came from a mixin, and a block kind an extension defines supports mixins with no work in the extension.

**A mixin body is bound once**, whether or not anything includes it, and an including block binds only the members written in it. A name in a mixin has one meaning, and a binder error in a mixin is reported once, in the mixin.

**Mixed-in members are shared, not copied.** A mixin's field is one symbol however many blocks include it. A reference to it from an including block resolves to the mixin's field, so go-to-definition and rename work across all including blocks.

**One exception: family code is handed a mixin while its body is bound.** The family's attribute specifications for a `model` mixin's body are built with the mixin in the place of the model. Each family also words the binder's messages for an unsupported attribute and an unresolved type; it receives the mixin as the member's owner and may check for it, to say `Mixin "Timestamps"` where it would say `Model "User"`. Only that wording depends on the check.

## Consequences

- An error a family interpreter raises on a mixin's member is reported once per including block, and every report points at the member in the mixin. Errors raised while inclusions are replaced point at the inclusion.
- A mixin that nothing includes is checked by the parser, the symbol table and the binder. No family interpreter reads it, so an error only an interpreter would find is not reported until a block includes the mixin. There is no unused-mixin warning.
- Code that reads a block's members reads them from the block's symbol; the block's syntax node does not contain mixed-in members.

## Alternatives considered

- **Attributes: `mixin <Name> { @@for(<keyword>) … }` with `@@include(<Name>)`.** Not chosen. An attribute's meaning comes from a specification a family or an extension contributes. `@@for` and `@@include` would be the only attribute names the core language resolves itself, and no extension could use them. `@@for` would have to be the first member, because the parser cannot read the body before it knows the keyword, and `@@include` would be the only attribute whose position matters.
- **`mixin <Name> for <keyword> { … }` with a spread, `...<Name>`.** Not chosen. It carries the same information with one more header word. The chosen form puts the keyword first, where every block has it and where the parser already reads it to choose the body grammar.
- **A keyword member, `include Timestamps`.** Not chosen. That text is already a field named `include` of type `Timestamps`.
- **Resolving names where a mixin is included.** Not chosen. One written name would mean different things in different including blocks, and hover and go-to-definition inside a mixin body would have no single answer.
- **Copying members into each including block.** Not chosen. A reference to a mixed-in field would resolve to a different symbol in each block, so rename would not reach the mixin. Copies would let interpreter errors point at the inclusion, but would also move errors that are the mixin's own fault.
- **A marker attribute on an ordinary block.** Not chosen. Every reader of models, enums or blocks would have to learn to skip marked ones. A declaration of its own kind is skipped by readers that know nothing about mixins.
- **Expansion in each interpreter.** Not chosen. Every family interpreter and every extension's block kind would have to implement inclusion, and they could disagree on order and duplicates.

## References

- [ADR 104 — PSL extension namespacing & syntax](ADR%20104%20-%20PSL%20extension%20namespacing%20%26%20syntax.md)
- [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md)
- [ADR 129 — Tagged literals write values of data types](ADR%20129%20-%20Template-Tagged%20Literals%20for%20Extensions.md)
- [ADR 252 — An earlier Prisma version's schema is a contract source](ADR%20252%20-%20An%20earlier%20Prisma%20version%27s%20schema%20is%20a%20contract%20source.md)
- [ADR 262 — Block specs bind top-level block values](ADR%20262%20-%20Block%20specs%20bind%20top-level%20block%20values.md)
