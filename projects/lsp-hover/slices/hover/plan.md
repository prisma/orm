## Dispatch plan

Slice spec: `projects/lsp-hover/slices/hover/spec.md`

### Dispatch 1: entity hover

- **Outcome:** `providePslHover` in `language-server/src/hover.ts` returns the documentation and declaration line from the spec's resolution table for `model`, `compositeType`, `field`, `namedType` and `block`. Each is handled both at a reference and at the declaration name, with `///` documentation read by `doc-comment.ts`. Every other position returns `null`. Unit tests cover:
  - each kind;
  - a reference to a declaration in another file;
  - a `///` run broken by a blank line;
  - a `///` run broken by a `//` line;
  - a declaration without `///`.
- **Builds on:** The spec's chosen design, and `ProjectArtifacts.binder()`.
- **Hands to:** a `providePslHover(input)` that walks from the cursor token to a resolution and switches on `kind`, with tested `///` and declaration-line helpers.
- **Focus:** The cursor-to-resolution walk, the `///` reader, the declaration-line renderer and the entity cases. No attribute, contributed-type or block-keyword cases, and no server wiring.

### Dispatch 2: attribute, contributed-type and block-keyword hover

- **Outcome:** `providePslHover` also answers:
  - model and field `attribute` resolutions, with the signature label and `spec.documentation`;
  - `contributedType`, with descriptor documentation or the `path(<arg labels>)` fallback;
  - generic-block keywords, with descriptor documentation, or `null` when there is none.

  The signature-label rendering in `signature-help.ts` is extracted so hover and signature help share it. Signature-help tests pass unchanged.
- **Builds on:** Dispatch 1's `providePslHover` `kind` switch.
- **Hands to:** a provider that covers every row of the slice spec's resolution table.
- **Focus:** The three new cases and the label extraction. No server wiring.

### Dispatch 3: server wiring

- **Outcome:**
  - `project.ts` has a `hover(uri, position)` that catches errors and returns `null`.
  - `server.ts` advertises `hoverProvider: true` and handles `onHover`.
  - `server.test.ts` asserts the capability, and an end-to-end hover request returns content.
  - The language-server README has a Hover section.
- **Builds on:** Dispatch 2's complete provider.
- **Hands to:** Slice DoD. The slice is ready for review and PR.
- **Focus:** Wiring, server tests, README. No provider logic changes.
