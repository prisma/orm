# ADR 253 — PSL red-root source ownership

**Status:** Accepted
**Date:** 2026-09-17
**Builds on:** [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md), [ADR 163 — Provider-invoked source interpretation packages](ADR%20163%20-%20Provider-invoked%20source%20interpretation%20packages.md), [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md)

---

## At a glance

Every parsed PSL document has a named `SourceFile` owned by the red syntax root returned from `parse`:

```ts
const { document, sources, diagnostics } = parse(schemaText, 'schema.prisma');
const sourceFile = sources.sourceFileFor(document.syntax);
const { symbolTable, diagnostics: symbolDiagnostics } = buildSymbolTable({
  documents: [document],
  sources,
  pslBlockDescriptors,
});
```

The filename is supplied at the parse boundary. After parsing, consumers resolve source ownership from the node they are processing by asking `PslSources` for the owning `SourceFile`. There is no unnamed parse mode, no singleton fallback, and no independent semantic `sourceId` channel for PSL post-parse diagnostics.

---

## Decision

PSL source ownership is attached to the returned red syntax root. `parse(source, filename, options?)` constructs one `SourceFile` for the input text, registers the actual returned `DocumentAst.syntax` root in `PslSources`, and returns both the document and the registry.

`PslSources.sourceFileFor(node)` walks from any red `SyntaxNode` to its root and looks up that root. A node whose root is not registered is an internal error. A structurally identical tree, a detached copy, or a node from another parse result is not accepted. The registry never falls back to “the only registered file,” because that would make ownership depend on current single-file scope rather than node identity.

Parsing remains file-local. `buildSymbolTable` accepts an ordered `readonly DocumentAst[]` and a shared registry containing every supplied root, including empty documents. It collects declarations into one scope in caller order; duplicate names remain first-wins, including repeated namespaces rather than merging their members. An empty collection produces an empty scope. Neither API discovers files or loads directories.

## Why red-root identity owns the file

The green tree is deliberately file-agnostic. It represents syntax shape and trivia, and identical text may produce identical green structure in two different files. The red tree is the positioned wrapper that has parent links and a concrete document root. Source ownership therefore belongs to the red root, not to green structure, text content, or a path string copied through semantic contexts.

This keeps diagnostics honest in three important cases:

1. **The document returned by `parse` is authoritative.** Consumers resolve the file from nodes in that returned tree.
2. **Foreign roots are rejected.** Passing a node from another parse result is a bug even if both files contain the same text.
3. **Detached nodes are rejected.** A helper cannot manufacture a node and accidentally inherit the only file in a registry.

## Diagnostic provenance

Parser diagnostics are emitted while the parser still holds the parse input, so they are mapped through the `SourceFile` that `parse` created. Post-parse diagnostics are different: symbol-table checks, interpreter checks, attribute combinators, extension-block validators, and language-server projections all process AST nodes after parsing. Those diagnostics derive their filename from `sources.sourceFileFor(node.syntax).filename` for the node being diagnosed.

Symbol-table diagnostics carry their owning `SourceFile` alongside the file-local `ParseDiagnostic` fields. The builder associates each document's findings with the file registered for that document's root, so a duplicate points to the offending declaration's file, not the winning declaration's file. Parser diagnostics remain unchanged.

The output envelope may still contain a field named `sourceId`, because diagnostics need a stable serialized filename. The ownership rule is about the origin of that value: it comes from the node's owning `SourceFile`, not from a separate semantic context parameter. File-read errors are the exception, because they occur before there is source text or a `SourceFile`; those diagnostics may report the attempted input path directly.

Prisma 7 authoring keeps its existing filename plumbing. It was mechanically adapted to the required parse signature and source helpers, but its multi-file compatibility path is not migrated by this decision.

## Coordinate conversion

Pure coordinate conversion is file-local and lives on `SourceFile`:

- `rangeToPslSpan(range)`
- `offsetToPslPosition(offset)`
- `pslSpanToRange(span)`

Node-based helpers receive `PslSources` and resolve the file through the node before converting. This includes symbol-table span helpers, block reconstruction, folding ranges, and interpreter diagnostics.

Language-server semantic tokens remain explicitly file-local: `SemanticTokensBuilder` encodes offsets against one resolved `SourceFile`. The pipeline resolves that file from the parsed document's red root and passes it to the builder. The builder does not choose a filename and does not consult a singleton registry.

## File-loading boundary

This decision intentionally preserves existing single-file behavior. A caller gives `parse` exactly one filename and one text buffer, and the returned registry contains exactly the returned document root. Unsaved editor content is parsed with the document URI and live text buffer. CLI/provider code reads one configured source file at a time and passes that display path as the parse filename.

The language server builds shared symbols from the current open, configured inputs and its project registry. It uses configured input order, filters symbol diagnostics by owning file, and invalidates symbols and semantic memos when roots change. It does not read unopened inputs from disk.

The following remain outside this decision:

- glob expansion or filesystem discovery for PSL sources;
- loading multiple PSL files into one schema;
- green-tree ownership;
- fallback ownership for detached nodes.

## Consequences

- Public parser callers must supply a filename. Tests use explicit synthetic names such as `test.psl`.
- Diagnostic producers that process AST nodes must carry `PslSources` with the document or symbol table they process.
- A serialized diagnostic `sourceId` is an output envelope field, not semantic source ownership.
- File-read failures remain path-based because no source registry exists yet.
- APIs that only convert positions for one already-selected document may continue to accept a `SourceFile`, but that `SourceFile` must have been resolved from `PslSources` by the caller.

## References

- [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md)
- [ADR 163 — Provider-invoked source interpretation packages](ADR%20163%20-%20Provider-invoked%20source%20interpretation%20packages.md)
- [ADR 249 — Central attribute-spec registry](ADR%20249%20-%20Central%20attribute-spec%20registry.md)
