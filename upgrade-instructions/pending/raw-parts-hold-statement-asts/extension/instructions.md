---
changes:
  - id: raw-parts-hold-statement-asts
    summary: |
      The `parts` of `RawExpr` and `RawQueryAst` (from `@internal/sql-relational-core/ast`) are now `ReadonlyArray<RawPart>`, where `RawPart = string | AnyExpression | SelectAst | InsertAst | UpdateAst | DeleteAst`. A raw template places a builder query, or a builder mutation after `.returning()`, as one statement part. Code that walks `parts` and treats every non-string part as an expression must handle the four statement kinds. The detection matches files that import these nodes and read `.parts`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@internal/sql-relational-core/(?:ast|expression)[\x27"])(?=[\s\S]*(?<![\w$])(?:RawExpr|RawQueryAst|RawPart)(?![\w$]))[\s\S]*\.parts(?![\w$])'
---

# Raw parts can hold a statement AST

`RawExpr.parts` and `RawQueryAst.parts` used to hold strings and expression nodes. They now hold `RawPart`, which adds `SelectAst`, `InsertAst`, `UpdateAst` and `DeleteAst`: a builder query interpolated into `db.raw.sql` or `fns.raw` lands in the parts as its statement AST. A `RawQueryAst` interpolated into another raw template is still spread into the outer parts, so it never appears as a part.

In every file the detection matches, find each walk over `parts` that sends a non-string part to an expression handler, and give the statement kinds their own branch. Each statement AST has `kind` `'select'`, `'insert'`, `'update'` or `'delete'`, which no expression kind uses. A renderer renders a statement part with the function it uses for that statement at top level, with no parentheses:

```ts
// Before
parts.map((part) => (typeof part === 'string' ? part : renderExpr(part, ctx))).join('');

// After
parts
  .map((part) => {
    if (typeof part === 'string') {
      return part;
    }
    switch (part.kind) {
      case 'select':
        return renderSelect(part, ctx);
      case 'insert':
        return renderInsert(part, ctx);
      case 'update':
        return renderUpdate(part, ctx);
      case 'delete':
        return renderDelete(part, ctx);
      default:
        return renderExpr(part, ctx);
    }
  })
  .join('');
```

A walker that only needs parameters can call `part.collectParamRefs()` on every non-string part, since the statement ASTs have it too. `RawQueryAst.collectParamRefs()` and `rewrite()` already reach into statement parts.

`ExpressionFolder` has a new optional `mutation` arm, called for an INSERT, UPDATE or DELETE part of a `RawExpr`, beside the `select` arm called for a SELECT part. A folder that leaves it out gets `empty` for a mutation part, so existing folders compile unchanged; add the arm where a mutation's contents matter.
