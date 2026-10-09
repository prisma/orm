# Slice: mixin-completion

Parent project `projects/psl-mixins/`. Outcome this slice contributes: the editor helps a user write an inclusion and write inside a mixin, and the project's remaining Definition of Done items (the ADR, the RC feature list, manual QA) are met.

## At a glance

Completion after `+` offers the mixins that may be included there. Inside a mixin body, completion and signature help behave as inside a block of the mixin's keyword; today they offer declaration keywords such as `model` and `namespace` at every position. A block that includes a mixin is no longer offered the keys the mixin already provides.

## Chosen design

### Completion after `+`

| Cursor | Offered |
|---|---|
| `+|` or `+Tim|` in a model, composite type, enum or `key = value` block | Each mixin whose keyword equals the block's keyword and that an unqualified inclusion at this position would resolve to (the block's namespace, then the top level), except mixins the block already includes; and each namespace that has such a mixin, so a qualified name can be written, as entity-reference completion offers only namespaces with a matching member |
| `+auth.|` or `+auth.Tim|` | Each mixin in namespace `auth` whose keyword equals the block's keyword, except mixins the block already includes |
| after `+` inside a mixin body | Nothing: a mixin cannot include a mixin |

- A mixin item's label is its name, and its detail is `<keyword> mixin`. Its completion kind is `Interface`, which no other PSL item uses.
- `+` is a completion trigger character.
- Nothing new is offered at the start of an empty member line. Completion offers nothing there in a model body today, and keys in a struct block; that is unchanged.

### Inside a mixin body

A mixin body gets what a block of its keyword gets, at every position the classifier distinguishes:

| Position | `model` mixin | `type` mixin | Any other keyword |
|---|---|---|---|
| Field type | as in a model | as in a composite type | n/a |
| After `@` and in a field attribute's arguments | as in a model | as in a composite type | n/a |
| After `@@` and in a block attribute's arguments | as in a model | as in a composite type | as in a block of that keyword |
| Entry key and entry value | n/a | n/a | as in a block of that keyword |
| Signature help inside attribute parentheses or at an entry value | as above | as above | as above |

Where a candidate list is a block's own fields (a field name in `@@index([|])` or `@relation(fields: [|])`), a mixin offers the mixin's own fields. That matches what the binder accepts there.

Declaration keywords are no longer offered inside a mixin body.

### Keys a block already has

For a struct block, the keys already present are read from the block's symbol, so keys provided by an included mixin are not offered again.

### Project close-out items

- **ADR.** One ADR in `docs/architecture docs/adrs/` recording the mixin syntax, the resolve-where-written rule, replacement in the symbol table, and the alternatives the team considered. It follows the `write-architecture-docs` skill and takes the next free ADR number.
- **RC feature list.** `projects/prisma-8-rc1/feature-surface.md` item 6 shows `<keyword> mixin <Name> { … }` and `+<Name>`, and no longer `@@include`.
- **Manual QA.** A script under `projects/psl-mixins/qa/` in the form of `projects/lsp-rename/qa/manual-qa.md`, covering every editor behaviour of this slice and `mixin-navigation`, and one run report.

## Coherence rationale

The first three parts teach one classifier and one provider about two new places a cursor can be. The close-out items are documents with no code, kept in this PR because it is the project's last.

## Scope

**In:** `completion-context.ts`, `completion-provider.ts`, `completion-scope.ts`, `completion-symbols.ts`, `completion-values.ts`, `signature-context.ts`, `signature-help.ts`, `attribute-spec-resolution.ts`, `server.ts` (the trigger character), their tests, the language-server README; the ADR; the RC feature list; the QA script and run report.

**Out:** anything in `psl-parser` or an interpreter. New completion items at the start of an empty member line. Snippets.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `+` in a struct block is classified today as an entry key | Must be classified as an inclusion before the entry-key rule | Otherwise `key = ` items are offered after `+`. |
| A top-level mixin body has no preceding declaration, which is why the classifier falls through to declaration keywords | Covered by recognising a mixin as an enclosing declaration | The existing test only asserts that completion does not throw. |
| A mixin for an extension block kind whose descriptor is not registered | Nothing offered; no error | As for an unknown block keyword today. |
| A mixin the user is still typing (`model mixin T {` with no closing brace) | Completion inside it works as in an unclosed model | |

## Slice-specific done conditions

- [ ] A test for each row of the "after `+`" table, including that a mixin for another keyword, an already-included mixin, and a mixin in an unrelated namespace are not offered.
- [ ] For each cell of the "inside a mixin body" table, a test that the items (or signature) equal those at the same position in an ordinary block of that keyword.
- [ ] A struct block that includes a mixin providing one of its keys is not offered that key.
- [ ] The ADR exists, and `rg "@@include" projects/prisma-8-rc1 docs` finds no description of mixins using it outside the ADR's alternatives.
- [ ] The QA run report shows every scenario passing, or lists the failures.

## Open Questions

1. **The ADR number.** Working position: the next free number in `docs/architecture docs/adrs/` at the time of writing.

## References

- Parent project: `projects/psl-mixins/spec.md` (Definition of Done)
- `projects/lsp-rename/qa/manual-qa.md` and its driver, as the QA model
- `packages/1-framework/3-tooling/language-server/README.md`
