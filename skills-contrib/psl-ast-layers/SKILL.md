---
name: psl-ast-layers
description: >-
  How to use the PSL syntax tree layers (green tree, red tree,
  strongly-typed AST classes) correctly. Use for any PSL-related work:
  PSL interpreters (contract-psl), helpers inside the psl-parser package,
  the language server, formatters, or anything else that consumes
  `parse()` output from @internal/psl-parser.
---

# PSL AST Layers

The PSL parser (`packages/1-framework/2-authoring/psl-parser`) produces a three-layer syntax tree. Each layer has exactly one job — pick the right one and the code stays lossless, typed, and cheap.

| Layer | Types | Job | Use in consumer code? |
|-------|-------|-----|-----------------------|
| Green tree | `GreenNode`, `GreenToken` (`syntax/green.ts`) | Immutable, position-independent storage. Foundation only. | **Never** |
| Red tree | `SyntaxNode`, `SyntaxToken` (`syntax/red.ts`, `syntax/navigation.ts`) | Navigation with offsets and parents: `findAncestor()`, `tokenAtOffset()`, `nextToken`/`prevToken`, `nonTriviaSibling()` | Navigation *outside* the current node |
| Typed AST | `ModelDeclarationAst`, `FieldDeclarationAst`, … (`syntax/ast/`) | Structural information about a *known* node via getters (`name()`, `fields()`, `lbrace()`, `value()`) | **Default choice** |

Everything is exported from `@internal/psl-parser/syntax`. `parse(source)` returns `{ document: DocumentAst, diagnostics, sourceFile }` — you start in the typed layer.

## Choosing a layer

1. **You know what the node is** (you hold a `ModelDeclarationAst`, a `FieldAttributeAst`, …) and want its parts → call the typed getters. Never dig through children yourself.
2. **You need to move outward or sideways** (find the enclosing model, the previous declaration, the token after the cursor) → use the red tree's navigation helpers, then immediately re-enter the typed layer with a static `cast`:

   ```ts
   // enclosing model (tests the node itself first, then walks ancestors)
   const model = node.syntax.findAncestor(ModelDeclarationAst.cast);

   // enclosing model OR composite type — combine casts with any(…)
   const owner = node.syntax.findAncestor(
     any(ModelDeclarationAst.cast, CompositeTypeDeclarationAst.cast),
   );
   ```

   Sideways and token-level movement all have dedicated helpers — do not hand-roll the walks:

   - `nextSiblingOrToken` / `prevSiblingOrToken` — adjacent element within the same parent (works from both nodes and tokens)
   - `token.nextToken` / `token.prevToken` — document order, crossing node boundaries
   - `nonTriviaSibling(element, 'next' | 'prev')`, `skipTriviaToken(token, direction)`, `isTrivia(token)` (from `syntax/navigation.ts`) — trivia-aware movement; never write your own whitespace/comment-skipping loop

3. **You genuinely don't know the node's type yet** (e.g. resolving a cursor position in the language server) → anchor on the red tree, then `cast` back into the typed layer immediately:

   ```ts
   // cursor → token: seam-aware, no descendant scanning
   const token = document.syntax.tokenAtOffset(offset).leftBiased();
   const attr = token?.parent.findAncestor(FieldAttributeAst.cast);

   // selection range → smallest enclosing element
   const covering = document.syntax.coveringElement(start, end);
   ```

   `tokenAtOffset` returns a `TokenAtOffset` that models the offset-on-a-seam case explicitly — pick `leftBiased()` or `rightBiased()` deliberately (completions usually want left, hover often wants right). Reach for a manual `descendants()` walk only when no offset anchors the search, and even then the loop body's first move is a `cast` (`castExpression(child)`, `ModelDeclarationAst.cast(child)`, …).
4. **Green tree** → only inside `psl-parser` itself (parser, `GreenNodeBuilder`, red-tree internals). If consumer code touches `node.green`, that's a bug.

Every typed AST class exposes `readonly syntax: SyntaxNode` (the `AstNode` interface), so switching layers is always one property access away — there is no excuse to stay in the wrong layer.

## Adding missing getters instead of working around them

If a typed AST class lacks a getter for the structure you need, **add the getter to the class** in `syntax/ast/` (test-first, exported via `exports/syntax.ts`) rather than hand-rolling child iteration at the call site. The helpers `findChildToken`, `findFirstChild`, and `filterChildren` from `ast-helpers.ts` are the building blocks for those getters — they belong inside AST classes, not scattered through consumer code.

## Anti-patterns

### 1. Re-stringifying the AST to extract information

Never round-trip through text: neither `printSyntax(node)` nor slicing the `SourceFile` by offsets, followed by string matching / regex / re-parsing. The tree already holds the structure; text extraction throws away parsing work and breaks on comments, whitespace, and escapes.

```ts
// BAD: stringify then string-hack
const text = printSyntax(attr.syntax);
const isUnique = text.includes('@unique');

// BAD: slicing the source file by offsets
const raw = source.slice(node.syntax.offset, node.syntax.offset + node.syntax.textLength);
const name = raw.split(' ')[1];

// GOOD: ask the tree
const isUnique = attr.name()?.identifier()?.token()?.text === 'unique';
const name = model.name()?.token()?.text;
```

Same rule for values: `StringLiteralExprAst.value()` returns the *decoded* string (escapes resolved, quotes stripped); slicing quotes off raw text yields wrong results for `\n`, `\u….`, etc.

`printSyntax` and `SourceFile` offsets have legitimate uses — producing output for humans: error-message snippets, formatter output, `positionAt` for LSP ranges. Extracting *structural facts* from that text is the anti-pattern.

### 2. Reading through the green tree

`node.green` exists so the red tree can do its job. Consumer code must not inspect green children, kinds, or text — green elements have no offsets and no parents, so any information you pull from them is positionally blind and will not survive refactors of the storage layer.

```ts
// BAD: peeking into green storage
const first = model.syntax.green.children[0];
if (first?.type === 'token' && first.text === 'model') { … }

// GOOD: red/typed access
const keyword = model.keyword(); // SyntaxToken with a real offset
```

### 3. Collecting child iterators into arrays

`children()`, `childNodes()`, `descendants()`, `fields()`, `attributes()`, `declarations()` are lazy generators on purpose. Materializing them just to index or filter allocates for nothing and hides intent.

```ts
// BAD: collect then poke
const fields = Array.from(model.fields());
const idField = fields.filter((f) => f.name()?.token()?.text === 'id')[0];

// GOOD: iterate lazily, stop early
let idField: FieldDeclarationAst | undefined;
for (const field of model.fields()) {
  if (field.name()?.token()?.text === 'id') {
    idField = field;
    break;
  }
}
```

### 4. Red-tree spelunking on a node of known type

If you already know the node is a `ModelDeclarationAst`, iterating its red children to find tokens or sub-nodes manually re-implements the typed getters — badly.

```ts
// BAD: manual token hunt on a known node
let lbrace: SyntaxToken | undefined;
for (const child of model.syntax.children()) {
  if (child instanceof SyntaxToken && child.kind === 'LBrace') {
    lbrace = child;
    break;
  }
}

// GOOD: the getter already exists
const lbrace = model.lbrace();
```

Likewise use `field.typeAnnotation()`, `attr.argList()?.args()`, `kv.value()` — and if the getter you want is missing, add it to the AST class (see above) instead of spelunking.

The same rule applies to navigation: a hand-written ancestor loop, whitespace-skipping loop, or offset-scanning `descendants()` walk re-implements `findAncestor`, `skipTriviaToken` / `nonTriviaSibling`, or `tokenAtOffset` / `coveringElement`. Use the helper.

## Quick reference

- Parse: `parse(source)` → `ParseResult { document, diagnostics, sourceFile }`
- Enter typed layer from red: `SomeAst.cast(syntaxNode)` (returns `undefined` on kind mismatch), `castExpression(node)` for expression unions, `any(CastA, CastB, …)` to combine casts into one predicate
- Drop to red from typed: `astNode.syntax`
- Upward: `findAncestor(cast)` (checks self first), `ancestors()`, `parent`
- Sideways: `nextSiblingOrToken` / `prevSiblingOrToken`; trivia-aware: `nonTriviaSibling`, `skipTriviaToken`, `isTrivia`
- Token order: `token.nextToken` / `token.prevToken` (crosses node boundaries); subtree edges: `node.firstToken` / `node.lastToken`
- Offsets: `tokenAtOffset(offset)` (seam-aware `TokenAtOffset`), `coveringElement(start, end)`, `endOffset`, `isInside(offset)` / `isOutside(offset)`
- Positions for humans/LSP: `sourceFile.positionAt(token.offset)` / `sourceFile.offsetAt(position)` — offsets live only on red `SyntaxToken` / `SyntaxNode`, never green
- Getter helpers for building AST classes: `findChildToken`, `findFirstChild`, `filterChildren`, `any`, and the `BracedBlock` interface (for `lbrace()`/`rbrace()` blocks) in `syntax/ast-helpers.ts`
