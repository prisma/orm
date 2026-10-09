# PSL mixins: syntax decision brief

2026-10-09

## Decision needed

The team needs to choose how PSL mixins are spelled: with dedicated syntax, as the new spec proposes, or with attributes, as the July 20 decision recorded.

PSL syntax freezes at the release candidate, so whichever spelling ships is permanent. The spec is [`spec.md`](./spec.md); the work is tracked as [TML-3055](https://linear.app/prisma-company/issue/TML-3055/psl-mixins-named-field-set-reuse-retire-field-presets-type-aliases-and).

## What changed since July 20

The July 20 decision covered shared field sets for models: `mixin WithTimestamps { … }`, included with `@@include(WithTimestamps)`.

The requirement is now wider. A mixin targets one kind of block (a model, a composite type, an enum, or a block kind defined by an extension) and can contain anything a block of that kind can contain.

That widening means a mixin has to say what it targets. The parser chooses how to read a block body from the block's keyword: fields for `model` and `type`, bare keys for `enum`, `key = value` entries for everything else. A `mixin` body can be any of those, so the parser needs the target before it reads the members. Both options below name the target; they differ in where.

## The two options

**Option A, dedicated syntax** (the spec's proposal). A `mixin` declaration names its target, and a spread member includes it.

```prisma
mixin Timestamps for model {
  createdAt DateTime @default(now())
  @@index([createdAt])
}

model User {
  id Int @id
  email String
  ...Timestamps
}
```

**Option B, attributes.** The July 20 spelling, with one attribute added to name the target. An attribute includes the mixin.

```prisma
mixin Timestamps {
  @@for(model)

  createdAt DateTime @default(now())
  @@index([createdAt])
}

model User {
  id Int @id
  email String
  @@include(Timestamps)
}
```

| | A: dedicated syntax | B: attributes |
| --- | --- | --- |
| Declaration | `mixin <Name> for <keyword> { }` | `mixin <Name> { @@for(<keyword>) … }` |
| Inclusion | `...<Name>` as a body member | `@@include(<Name>)` |
| Tokenizer | One new token (`...`) | No change |
| Parser | A `mixin` declaration whose header selects the body grammar | A `mixin` declaration whose first member, `@@for`, selects the body grammar |
| Words reserved | `mixin` as a block keyword; `for` in that header | `mixin` as a block keyword; `for` and `include` as attribute names |
| Who gives the form its meaning | The language core | The core, inside a namespace otherwise owned by attribute specs |
| Relation to July 20 | Replaces both spellings | Keeps both spellings; adds `@@for` |

A mixed form is also possible: the `mixin … for` declaration from A with `@@include` from B.

## The case for dedicated syntax

- **Mixins become part of the language, independent of any interpreter.** This is the main argument. We want PSL to describe more than database models. A mixin written in core syntax works the same way for every block kind and every interpreter, present or future, because it is resolved before any interpreter runs and none of them has to know it exists. Spelled as attributes, the feature sits in the part of the language that interpreters define.
- **Attribute names belong to families and extensions.** An attribute's meaning comes from a spec that a family or an extension contributes, and the binder reports any attribute no spec claims. `@@for` and `@@include` would be the only attribute names the core resolves itself, before any spec sees the block. They need an exemption from that check, and no extension could use `@@include` in its own block kinds.
- **The target is known before the body.** The parser needs the target to read the members. Under A it is in the header. Under B it is a member, so `@@for` has to come first, an ordering rule no other attribute has, and a mixin with `@@for` missing or misplaced has a body the parser cannot read.
- **Position has meaning for a member, not for an attribute.** The mixin's members are placed where the inclusion is written, which decides field and column order. A spread is a body member, so that is expected. `@@include` would be the only attribute whose position in the block matters.
- **`@@base` is not a precedent.** It composes models as an attribute, but polymorphism is defined by each family's interpreter. Mixins are replaced by their members before any interpreter runs.
- **The cost is small.** One token, one declaration form, and `...` cannot start any body member today, so no existing schema changes meaning.

## The case for attributes

- **Less new grammar before the freeze.** There is no new token, and inclusion needs no parser change: `@@` attributes already parse in every block kind. Only the `mixin` declaration is new, and it is new under either option.
- **It is what users already know.** Everything in a block body that is not a member is an attribute, and `@@base(Post, "article")` already expresses model composition that way. `...` is punctuation PSL has never had, borrowed from JavaScript and GraphQL.
- **Every tool that reads PSL keeps working.** A tool that tokenizes schemas sees only forms it already handles.
- **It keeps the July 20 decision**, declaration and inclusion both, along with anything already communicated on that basis. The only addition is `@@for`.
- **Attributes take arguments.** If inclusion ever needs options, `@@include(Timestamps, …)` has room for them. A spread has none.
- **The core already claims words.** `model`, `type` and `namespace` are reserved by the parser; reserving two attribute names is the same kind of act.

## What does not depend on the choice

These hold under either option, so they need not be argued in this discussion:

- A mixin targets exactly one block keyword, and can be included only in a block with that keyword.
- Mixins can be declared inside a `namespace` and referenced with a qualified name.
- Names inside a mixin are resolved where the mixin is written. A mixin's attributes can name only fields the mixin declares.
- A member provided twice, by the block and a mixin or by two mixins, is an error. There is no override.
- A mixin cannot include another mixin.
- Inclusions are replaced by members while the symbol table is built. Family interpreters see ordinary blocks, and the emitted contract is the same as if the members were written inline.
- Most of the work is the same: extension blocks and enums must expose their members through the symbol table before any inclusion can reach their consumers.

## Recommendation and questions

The spec recommends option A. The deciding argument is generality: PSL is meant to grow beyond database model definitions, and a mixin in core syntax is a language construct that every block kind and interpreter gets without doing anything. Attribute names are the space families and extensions define; a core construct that takes names from it needs exemptions that A avoids.

Questions for the team:

1. Is making mixins a core construct, independent of interpreters, worth a new token and a declaration header before the freeze?
2. If not, is the mixed form acceptable: the `mixin … for` declaration with `@@include` for inclusion?
3. Has the July 20 spelling been communicated outside the team, in docs, talks or to early users?
4. Does anyone expect inclusion to need options later? That is the one capability B has and A lacks.
