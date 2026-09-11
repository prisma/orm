---
from: "8.0.0-rc.9"
to: "8.0.0-rc.10"
# sql-orm-client doc-comment sweep: reviewed, no entry required
# postgres shell dependency ownership: reviewed, no extension-author action required; bundled packages now declare the catalog Node/pg type dependencies that public shell manifests mirror
changes:
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
  - id: preserve-prepared-reference-nullability
    summary: Preserve declaration nullability when constructing or cloning PreparedParamRef AST nodes.
  - id: schema-header-use-prisma-8
    summary: |
      The schema header that marks a Prisma 8 schema is now `// use prisma-8`. The language server
      still serves the old header and its Format action rewrites it; new schemas and the
      inferred-schema printer write the new form. Replace `// use prisma-next`
      at the top of every `.prisma` file the extension ships or tests against.
    detection:
      glob: "**/*.prisma"
      contains:
        - "// use prisma-next"
  - id: env-vars-drop-next-infix
    summary: |
      The CLI environment variables lost their `NEXT_` infix: `PRISMA_NEXT_DISABLE_TELEMETRY`,
      `PRISMA_NEXT_TELEMETRY_ENDPOINT`, `PRISMA_NEXT_DEBUG`, and the rest are now
      `PRISMA_DISABLE_TELEMETRY`, `PRISMA_TELEMETRY_ENDPOINT`, `PRISMA_DEBUG`, and so on. The old
      `PRISMA_NEXT_DISABLE_TELEMETRY` opt-out is still honoured; the others are not. Rename them
      in the extension's test setup and CI configuration.
    detection:
      glob: "**/*"
      contains:
        - "PRISMA_NEXT_"
  - id: to-one-relations-record-nullable
    summary: |
      `ContractNonJunctionRelation`'s `'1:1'` and `'N:1'` members now require `nullable: boolean`,
      and contract validation rejects a `contract.json` whose to-one relations lack it. Set
      `nullable` on every to-one relation the extension constructs, and rebuild the extension's
      contract space so its emitted `contract.json` / `contract.d.ts` carry the flag.
    detection:
      glob: "**/*.ts"
      matches:
        - '(?<!\bnullable\b(?:[^{}]|\{[^{}]*\})*)(?:(?<=\bon\s*:(?:[^{}]|\{[^{}]*\})*)|(?=(?:[^{}]|\{[^{}]*\})*\bon\s*:))\bcardinality:\s*[''"](?:N:1|1:1)[''"](?!(?:[^{}]|\{[^{}]*\})*\bnullable\b)'
  - id: contract-space-re-emit-nullable
    summary: |
      The extension's emitted `contract.json` must carry `nullable` on every `1:1` and `N:1`
      relation. Rebuild the contract space (the package's `build:contract-space` script) once
      after upgrading.
    detection:
      glob: "**/contract.json"
      matches:
        - '"cardinality":\s*"(?:N:1|1:1)",\s*"on":'
---

## `preserve-prepared-reference-nullability`

Find code that constructs or clones `PreparedParamRef` from SQL relational-core's AST exports. When constructing a reference from a nullable declaration, pass its declared boolean nullability as the third argument to `PreparedParamRef.of(name, codec, nullable)` or `new PreparedParamRef(name, codec, nullable)`. When cloning an existing reference, preserve `ref.nullable`: `PreparedParamRef.of(ref.name, ref.codec, ref.nullable)`. Keep the name and complete codec reference unchanged, and keep constructing frozen class instances rather than spreading nodes into plain objects. Do not derive this flag from a column's nullability or an invocation's bound value.

## `params-only-sql-facade-prepare`

Find calls to `prepare(declaration, callback)` on clients created by the Postgres or SQLite facade (`@prisma/orm-postgres/runtime`, `@prisma/orm-sqlite/runtime`, or their `@internal/postgres/runtime` and `@internal/sqlite/runtime` counterparts). Resolve the receiver and callback rather than rewriting every method named `prepare`: native SQLite `database.prepare(sql)` and SQL runtime's existing params-only preparation are different APIs and must remain unchanged.

Change callbacks from `(sql, params) => ...` to `(params) => ...`. Replace references bound to the removed `sql` callback argument with the same facade receiver's lexical `.sql` property. Preserve the params argument's name, declaration, SQL chain, row selection, filters and invocation target/options. For extracted callbacks, capture the same client in the enclosing scope; do not capture an invocation target or evaluate the callback twice. Update explicit callback type annotations to accept only the placeholder-params argument.

```ts
// Before
const query = await db.prepare({ id: 'pg/int4@1' }, (sql, params) =>
  sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);

// After
const query = await db.prepare({ id: 'pg/int4@1' }, (params) =>
  db.sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
```

Apply the same translation to SQLite's flat SQL facade (`sql.users` becomes `db.sql.users`), retaining its existing codec ids. Keep `.query(target, params, options?)` and SQL statistics `.execute(target, params, options?)` calls unchanged. Do not rewrite historical release notes, applied upgrade recipes, generated contracts or tests as part of this source translation.

## `to-one-relations-record-nullable`

For every TypeScript file matched by `detection`, find each object literal that builds a to-one contract relation (`cardinality: 'N:1'` or `'1:1'` together with an `on` join) and add `nullable: <boolean>` to it: `true` when the relation field is optional (the local foreign-key columns are nullable), `false` when it is required. The side of a one-to-one relation that does not own the foreign key is always `nullable: true`. Contract builders and PSL authoring set the flag from the field's `?`, so only code that assembles `ContractRelation` values by hand needs the edit.

## `contract-space-re-emit-nullable`

For every `contract.json` matched by `detection`, run the extension package's `build:contract-space` script (or its emit command) once after upgrading. The expected diff is one `"nullable"` boolean per to-one relation in `contract.json`, plus the `Models` namespace, `models` constant, and `RelationKeys` import in `contract.d.ts`.

## `schema-header-use-prisma-8`

For every `.prisma` file matched by `detection`, replace the first-line header `// use prisma-next` with `// use prisma-8`. Nothing else in the file changes.

## `env-vars-drop-next-infix`

For every file matched by `detection`, replace the `PRISMA_NEXT_` prefix with `PRISMA_` on each environment variable name.
