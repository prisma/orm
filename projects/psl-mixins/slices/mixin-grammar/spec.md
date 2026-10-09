# Slice: mixin-grammar

Parent project `projects/psl-mixins/`. Outcome this slice contributes: the two mixin forms exist in the syntax tree for every block kind, so the next slice can give them meaning without touching the parser.

## At a glance

The parser reads `<keyword> mixin <Name> { … }` and `+<QualifiedName>`, the typed AST exposes them, and the formatter prints them. Nothing interprets them yet: a schema that uses either form gets a diagnostic saying mixins are not supported yet, and its contract is otherwise unchanged.

## Chosen design

```prisma
namespace auth {
  model mixin Timestamps {
    createdAt DateTime @default(now())
    @@index([createdAt])
  }
}

enum mixin BaseRoles {
  ADMIN
  USER
}

policy_select mixin OwnerRead {
  roles = [authenticated]
}

model User {
  id Int @id
  +auth.Timestamps
}
```

**Tokenizer.** One new token kind, `Plus`, for `+`. Today `+` is scanned as `Invalid`. A `+` immediately followed by a digit is not a `Plus`: it starts a `NumberLiteral`, exactly as a leading `-` does today, so `+1` and `+1.5` are numbers with the value `1` and `1.5`.

**Syntax kinds.** Two new kinds in `syntax-kind.ts`:

| Kind | Shape | Where it may appear |
|---|---|---|
| `MixinDeclaration` | `Ident(keyword) Ident("mixin") Identifier(name) "{" members "}"` | Wherever a model or generic block may: the document and inside a `namespace` |
| `MixinInclusion` | `Plus QualifiedName` | As a member of a model, composite type, generic block, enum block, or mixin body |

A mixin declaration is its own kind, not a `ModelDeclaration` or `GenericBlockDeclaration` with a marker. Every existing consumer that casts to those AST classes therefore skips mixins without being changed.

**Body grammar.** A `MixinDeclaration` body is read by the member parser its keyword selects today: `model` and `type` read fields and `@@` attributes, `enum` reads enum members, any other keyword reads `key = value` entries and `@@` attributes. Each of those member parsers also accepts a `MixinInclusion`.

**Recognition.** The parser takes the mixin path whenever a declaration starts with `Ident` followed by an `Ident` whose text is `mixin`, so that a missing name or a missing `{` is reported as an incomplete mixin. A `+` is read as an inclusion wherever a body member may start; it does not have to be the first token on its line, so `model User { +Timestamps }` is valid.

**Reserved word.** `mixin` cannot be a block keyword or a block name:

| Input | Result |
|---|---|
| `mixin X { … }` | Diagnostic: a mixin starts with the keyword of the block it is for, for example `model mixin X`. |
| `model mixin { … }`, `enum mixin { … }`, `policy_select mixin { … }` | Diagnostic: expected a mixin name after `mixin`. |
| `namespace mixin X { … }`, `types mixin X { … }` | Diagnostic: a mixin cannot be declared for `namespace` / `types`. |

Field names, entry keys and attribute arguments spelled `mixin` are unaffected.

**`prisma-7` grammar.** With `options.grammar === 'prisma-7'` none of the above applies: `model mixin { … }` is a model named `mixin`, `mixin X { … }` is a generic block, `model mixin X {` and a member starting with `+` are the errors they are today.

**Typed AST.**

- `MixinDeclarationAst`: `keyword()`, `mixinKeyword()`, `name()`, `lbrace()`, `rbrace()`, `fields()`, `entries()`, `attributes()`, `inclusions()`, `docComment()`.
- `MixinInclusionAst`: `plus()`, `name()` returning the `QualifiedNameAst`.
- `ModelDeclarationAst`, `CompositeTypeDeclarationAst` and `GenericBlockDeclarationAst` gain `inclusions()`. Their existing `fields()`, `entries()`, `attributes()` and `members()` return what they return today.
- `NamespaceMemberAst` includes `MixinDeclarationAst`.

**Formatter.** A mixin declaration prints as `<keyword> mixin <Name> {` with its body formatted exactly as a block of that keyword. An inclusion prints as `+<QualifiedName>` on its own line at member indentation, with no space after `+`. It does not take part in field column alignment and does not break an alignment group.

**Symbol table.** `buildSymbolTable` does not add a mixin declaration to `models`, `compositeTypes` or `blocks`. It reports one diagnostic at each mixin declaration's name and one at each inclusion: "Mixins are not supported yet". It uses an existing diagnostic code; this message is removed by the next slice.

## Coherence rationale

Everything here is syntax: how text becomes tree nodes, how those nodes are exposed, and how they print back. The symbol-table part is only what keeps a mixin from being mistaken for a real block and keeps the forms from being accepted silently.

## Scope

**In:**

- `psl-parser`: tokenizer, `syntax-kind.ts`, `parse.ts`, the typed AST classes, the formatter, the symbol-table exclusion and interim diagnostic, tests for each, and the README's grammar and AST sections.
- Fixes in other packages only where an existing consumer fails to compile or throws on a tree containing the new kinds. The language server walks the tree directly in `completion-provider.ts`, `semantic-tokens.ts`, `folding-ranges.ts` and `attribute-syntax-context.ts`; its tests must pass on documents that contain both forms.

**Out:**

- Mixin symbols, resolving an inclusion's name, placing members, the keyword-match check, duplicate-member detection, the inclusion-inside-a-mixin diagnostic. All are the `mixin-inclusion` slice.
- Completion after `+`, go-to-definition, rename, hover, and new semantic-token types. All are `mixin-editor-support`.
- A new diagnostic code for the interim message.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| A signed number (`@default(+1)`) | Valid: `+1` is one `NumberLiteral` with the value `1` | The tokenizer rule above. Cover with a tokenizer test and an interpreter-level test that the default is `1`. |
| A member whose attribute arguments or value fail to parse, with tokens left on its line (`id Int @default(+foo)`) | The failing member consumes the rest of its line into its own node, and reports its own diagnostic only | Without this, recovery returns to the member loop in the middle of the line and the leftover `+foo)` is read as an inclusion of `foo`. The rule applies to fields, `key = value` entries, enum members and block attributes. |
| `+` followed by something that is not a name (`+ {`, `+@id`, `+` at end of body) | A `MixinInclusion` node with a missing name and one diagnostic; recovery continues at the next member | Same recovery style as a field with a missing type. |
| An incomplete header while typing: `model mixin` then end of file, or `model mixin X` with no `{` | One diagnostic naming the missing piece | Matches `parseBlock`: only the first missing piece is reported. |
| A model with a field named `mixin` or of type `mixin` | Unchanged | The word is reserved only in block-header position. |
| Doc comments (`///`) above a mixin declaration | Read by `docComment()` like any declaration | |

## Slice-specific done conditions

- [ ] Parsing then printing the unformatted source is lossless for documents containing both forms, including the malformed inputs above.
- [ ] Formatting is idempotent on both forms, for a model, an enum and a `key = value` block.
- [ ] With the `prisma-7` grammar, the parser tests show `model mixin { }` as a model and `mixin X { }` as a generic block, with the same diagnostics as on `main`.
- [ ] No existing fixture or snapshot changes.

## Open Questions

None.

## References

- Parent project: `projects/psl-mixins/spec.md` (decisions 1, 2, 3, 4, 6 and 14; the second transitional-shape constraint)
- `packages/1-framework/2-authoring/psl-parser/README.md`
- The `psl-ast-layers` skill
