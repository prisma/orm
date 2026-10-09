# Brief: mixin-inclusion D2, second part — bind each member once

## Task

Complete the slice spec's "Binder" section. The operator chose how a mixin reaches spec factories and the family callbacks: the binder passes the `MixinSymbol` itself, the three context types are widened to accept it, and the family callbacks word their messages for a mixin. The spec's Binder section now states this.

## Changes

1. Widen `AttributeSpecContext.model`, `UnsupportedAttribute.owner` and `UnresolvedTypeReference.owner` to accept a `MixinSymbol`. Build no model-shaped object around a mixin.
2. Bind every mixin body once, whether or not anything includes it: field types in the mixin's namespace, field names in its attributes against its own `fields`, entries and block attributes of a `key = value` mixin against that keyword's block descriptor.
3. When binding a model, composite type or generic block, bind only the members written in it. Its own attributes still resolve field names against all of its fields, mixed-in ones included.
4. `describeUnsupportedSqlAttribute`, `describeUnsupportedMongoAttribute` and `describeUnresolvedMongoType`: for an owner that is a mixin, say `Mixin "<name>"` where the message says `Model "<name>"`; for a mixin whose keyword is `type`, do what the callback does for a composite type. Change nothing else in those files.

## Completed when

- [ ] The binder tests listed in `02-binder.md` that the first part did not cover: the cross-namespace type, the mixin attribute naming a field it does not declare, the model attribute naming a mixed-in field, one mixin included by three models reporting each binder diagnostic once, a mixin nothing includes still bound.
- [ ] An unsupported attribute in a `model` mixin is reported once, in the mixin, with `Mixin` in the message (SQL and Mongo); in a `type` mixin the binder reports what it reports for a composite type.
- [ ] `pnpm typecheck` passes apart from `prisma7-adoption`; `test` and `lint` pass for `psl-parser`, `language-server`, SQL `contract-psl` and Mongo `contract-psl`; `psl-parser` is rebuilt.

## Halt conditions

- Telling own members from mixed-in ones needs a change to a symbol's public shape that an interpreter could read.
- A family callback needs more than the wording change and the `type`-mixin branch.
- An existing binder or interpreter test needs its assertions changed.
