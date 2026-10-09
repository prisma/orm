# Slice: mixin-navigation

Parent project `projects/psl-mixins/`. Outcome this slice contributes: in the editor a mixin is a symbol like a model: it can be jumped to, hovered, found and renamed, and its body is coloured.

## At a glance

The binder already resolves every mixin position. The language server stops at two switches that have no case for a mixin and at one function that assumes a field's owner is a model. This slice fills those in, and makes semantic tokens cover mixin bodies and inclusions. All changes are in `packages/1-framework/3-tooling/language-server`.

## Chosen design

Each behaviour is the model's behaviour applied to a mixin.

| Feature | Cursor on | Result |
|---|---|---|
| Go-to-definition | `Timestamps` in `+Timestamps`, `+auth.Timestamps`, or `model mixin Timestamps {` | The mixin's name in its declaration; with link support the target range is the whole declaration |
| Find references | the same positions | The declaration and every inclusion, across the project's documents |
| Hover | the same positions | A fenced `prisma` block `<keyword> mixin <Name>` (for example `model mixin Timestamps`), then the `///` documentation when present |
| Hover | the keyword in `enum mixin X` or `policy_select mixin X` | The block descriptor's documentation, as on the keyword of an ordinary block |
| Rename | a mixin's name | One edit per reference. No `@@map` is added: a mixin has no storage name |
| Rename | a field declared in a `model` mixin | One edit per reference, including uses in including models' attributes, plus `@map("<old>")` on the field in the mixin under the conditions that apply to a model's field today (no `@map` yet, the type is not a model or cross-space reference, the field specs define `map`) |
| Rename | a field declared in a `type` mixin | Edits only; no `@map`, as for a composite type's field |

`auth` in `+auth.Timestamps`, a field name inside a mixin body, and a mixed-in field named in an including model's attribute already work, because the binder records `namespace` and `field` there. Tests pin them.

**Semantic tokens.**

- A mixin body is tokenised by the walker for its keyword: fields, types and attributes as in a model body for `model` and `type` mixins; keys, values and attributes as in a generic block body for the rest.
- An inclusion, in any block and in a mixin body, is tokenised as a type reference: a namespace qualifier is `namespace`, the name is `type`. The `+` is part of the first token, the way `@` and `@@` are part of an attribute's first token.
- Tokens are emitted in source order.

**Types.** `FieldAttributeOwner.model` in `attribute-spec-resolution.ts` accepts a mixin declaration, and the `'field'` arm of `attributeSpecResolver` accepts a `MixinSymbol` whose keyword is `model`. The parser's `AttributeSpecContext.model` already does.

## Coherence rationale

Every change makes an existing symbol-based feature accept one more symbol kind. There is no new feature and no new request handler.

## Scope

**In:** `cursor-resolution.ts`, `hover.ts`, `rename.ts`, `attribute-spec-resolution.ts` (the field owner only), `semantic-tokens.ts`, their tests, and the language-server README where it lists what each feature answers for.

**Out:**

- Completion after `+`, completion and signature help inside a mixin body, and the completion provider reading entry keys from the syntax tree. All are `mixin-completion`.
- Document symbols: the server does not provide them.
- Anything in `psl-parser` beyond an accessor the token walker needs to visit a mixin body's members in source order.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| A field whose type wrongly names a mixin | Navigable and hoverable like any reference to the mixin; the binder's "is a mixin" diagnostic is unchanged | The binder records `kind: 'mixin'` there. |
| Renaming a mixin's field that an including model names in `@@index([createdAt])`, in another file | The edit set includes that file | References are collected by symbol identity over every project document. |
| Renaming a mixin when a model in another namespace includes it as `+auth.Timestamps` | Only the `Timestamps` segment is edited | As for a qualified type reference. |
| A mixin and an including model in different files | Definition and references cross files | |

## Slice-specific done conditions

- [ ] Each row of the feature table has a test with the cursor on each listed position.
- [ ] A semantic-tokens test for a `model` mixin, an `enum` mixin and a `key = value` mixin body, and for an inclusion with and without a qualifier, asserting token types, modifiers and order; tokens for the rest of each document are what they are on the base branch.
- [ ] `pnpm --filter @internal/language-server test`, `typecheck` and `lint` pass.

## Open Questions

None.

## References

- Parent project: `projects/psl-mixins/spec.md` (decision 12, and the Definition of Done items for the language server)
- `projects/lsp-rename/spec.md`, for when a rename adds `@map`
- `packages/1-framework/3-tooling/language-server/README.md`
