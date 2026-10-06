# Slice: find-references

Parent project: [`projects/lsp-find-references/`](../../spec.md). The project is this one slice; the project spec holds the behaviour table, the non-goals and the requirements. This file adds the design choices the project spec leaves to the slice.

## At a glance

One PR with three changes: the binder records a `namespace` resolution on namespace block names, the language server answers `textDocument/references`, and go-to-definition on a declaration's own name returns that declaration.

## Chosen design

### Binder (`psl-parser/src/binder.ts`)

In the loop over `symbolTable.topLevel.namespaces`, each entry of `namespace.declarations` also records the namespace's resolution on the declaration's name node, the same resolution `bindQualifier` records on a qualifier. Nothing else in the binder changes. No new diagnostics.

### References provider (`language-server/src/references.ts`)

A pure function next to `provideDefinition`, returning `Location[]`:

1. **Target.** Pick the token at the cursor the way `definition.ts` does (the token lookup is shared, not copied) and resolve it with `resolvedNodeAt`. A target exists for resolution kinds `model`, `compositeType`, `namedType`, `block`, `field` and `namespace`; the target is `resolution.symbol`. Any other kind, or no resolution, returns `[]`.
2. **Candidates.** For every project document, find each occurrence of the symbol's name in the document text. For each occurrence take the token at that offset and keep it only if it is an `Ident` token that starts at that offset and whose text equals the name.
3. **Confirm.** Resolve the candidate with `resolvedNodeAt`. It is a usage when the resolution's `symbol` is the target object.
4. **Declarations.** A usage is the declaration when the resolved node is the name node of the symbol's declaration. It is dropped unless `includeDeclaration` is set. For a `namespace` target nothing is dropped.
5. **Result.** One `Location` per kept token: the document's URI and the token's range. Order: project documents in input order, then by offset.

A rule that a candidate inside a wider resolved node must be its last identifier token was specified first and removed after Dispatch 1: with the binder as it is, every qualifier that lets the whole name resolve carries its own resolution, so the rule never rejected anything and no test could fail without it.

### Wiring

- `ProjectArtifacts` exposes every project document (text, parsed document, source file), read the way the symbol table reads them, so the list and the binder describe the same snapshot.
- `Project.references(uri, position, includeDeclaration)` follows `Project.definition`: same member checks, `[]` instead of `null`, errors caught to `[]`.
- `server.ts` declares `referencesProvider: true` and registers `onReferences`, passing `params.context.includeDeclaration`.

### Go-to-definition (`language-server/src/definition.ts`)

Remove the early `null` for a resolved node that is the declaration's own name. The rest of the function already produces the declaration's location, and every block for a namespace.

### Documentation

- Language-server README: find references in the feature list and a short section in the style of the Hover section; the go-to-definition text reflects the declaration-name change; the Hover section covers a namespace block name if it lists hover positions.
- psl-parser README: where it says which declaration names carry a resolution, namespaces are added.
- `apps/lsp-playground/README.md`: find references is listed among the requests the editor sends. No playground client code changes in this slice; if references in another scratch file do not open there, that is reported, not fixed here.

## Why these changes are one PR

The binder change and the go-to-definition change have no use without the references handler, and the handler is incomplete for namespaces without the binder change.

## Edge cases

| Case | Expected |
|---|---|
| Name inside a longer identifier (`UserProfile` for `User`) | not a usage |
| Name inside a `//` or `///` comment, or a string (`@map("User")`) | not a usage |
| Same-named field on another model | not a usage |
| Model and namespace with the same name (`auth.auth`) | the qualifier is a usage of the namespace only; the last segment is a usage of the model only |
| Cursor right after the last character of a name | same result as inside the name (same token choice as go-to-definition) |
| Namespace declared in two blocks in two files | both block names returned with and without `includeDeclaration` |
| Symbol with no references | `[]` without `includeDeclaration`; the declaration alone with it |
| Hover on a namespace block name | shows `namespace <name>` (new, follows from the binder change) |

## Slice Definition of Done

- [ ] Every test condition of the project spec's Definition of Done passes, plus a test per row of the edge-case table above.
- [ ] Semantic tokens, completion and signature-help tests pass unchanged.
- [ ] `pnpm test:packages` and `pnpm lint:deps` pass once at slice end.
- [ ] A `drive-qa-plan` script and one `drive-qa-run` report exist, driving the language server through its server test harness or over stdio. The VS Code check from the project spec is listed in the script as a step for the operator.

## Out of scope

Everything in the project spec's non-goals. Playground client code.
