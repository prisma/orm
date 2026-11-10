---
changes:
  - id: statement-planning-target-namespaces
    summary: |
      In `@prisma/orm-family-sql/family/control`, `SchemaTables` gains `hasNamespace(namespaceId)`, and `StatementPlanningTarget` gains an optional `namespaces` member. A `SchemaTables` or a test double of it adds `hasNamespace`; a target with several namespaces may add `namespaces`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:StatementPlanningTarget|SchemaTables)(?![\w$])'
  - id: schema-ownership-namespace-spaces
    summary: |
      `SchemaOwnership` from `@prisma/orm-framework/components/control` gains `namespaceDeclaringSpaces(namespaceId)`: the ids of the contract spaces that declare the namespace. A test double of it adds the method.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])SchemaOwnership(?![\w$])'
  - id: namespace-rename-statement
    summary: |
      `ResolvedRenameStatement` from `@prisma/orm-framework/components/control` gains `ResolvedNamespaceRenameStatement`, `{ kind: 'rename', entity: 'namespace', from, to }`, whose `from` and `to` are namespace ids. Code that switches over a rename's `entity` handles `'namespace'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])ResolvedRenameStatement(?![\w$])'
---

# Statements can move tables and rename namespaces

## `statement-planning-target-namespaces`

A SQL target's statement planner now moves a table to another namespace and renames a namespace. Add `hasNamespace` to each `SchemaTables` you implement:

```ts
hasNamespace: (namespaceId) => namespaceId === UNBOUND_NAMESPACE_ID,
```

A target with one namespace, as SQLite has, leaves out `namespaces` on its `StatementPlanningTarget`; the planner then refuses a namespace rename or a model move with a `statementRefused` conflict. A target with several namespaces adds `namespaces: { createNamespaceCalls, moveTableCall, namespaceRenameRefusal, renameNamespaceCall }`, returning the calls that create a namespace, move a table and rename a namespace, which it applies to its working schema. `namespaceRenameRefusal` returns `{ reason, fix }` for a namespace it cannot rename for a reason of its own, such as Postgres's `public`; the planner itself refuses a namespace another contract space declares.

## `schema-ownership-namespace-spaces`

Add `namespaceDeclaringSpaces: () => []` to a `SchemaOwnership` test double that declares no namespace, or return the ids of the spaces whose contracts have the namespace in `storage.namespaces`.

## `namespace-rename-statement`

A `switch` or `if` over `statement.entity` of a `ResolvedRenameStatement` gains a `'namespace'` branch. A planner that cannot rename a namespace refuses the statement with a `statementRefused` conflict.
