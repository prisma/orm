---
changes:
  - id: named-type-domain-type-params
    summary: |
      A field typed by a named type (a PSL `types` block entry or a TypeScript named storage type) now carries that type's parameters in its domain type, as the same type written inline does. Re-emit the contract. The storage section and every hash stay the same.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef":'
---

## `named-type-domain-type-params`

A field typed by a named type, such as `code Short` with `types { Short = VarChar(10) }`, used to get a domain type with the codec only. It now gets the named type's parameters too, so `code Short` and `code VarChar(10)` have the same domain type:

```json
"type": { "codecId": "sql/varchar@1", "kind": "scalar", "typeParams": { "length": 10 } }
```

A value-object member typed by a named type gets them the same way; before, it lost them.

1. Run `prisma contract emit`. `contract.json` and `contract.d.ts` gain `typeParams` on the domain type of each such field. A named type without parameters, such as `Email = String`, adds nothing.
2. Contract snapshots under `migrations/snapshots/<hash>/` are not re-emitted. In each snapshot's `contract.json` and `contract.d.ts`, add the same `typeParams` to the domain type of each field whose storage column has a `typeRef`: the `typeParams` of the named type in `storage.types`, skipped when they are empty. Write them as `prisma contract emit` writes them: after `kind` in `contract.json`, and as `readonly typeParams: { ... }` after `codecId` in `contract.d.ts`. `storageHash` and `profileHash` do not move, so snapshot directory names stay the same.

`prisma contract print` now refuses a contract emitted before this change that has such a field: the field's domain type lacks the parameters its column's named type gives it. Re-emit the contract first.

### For extension authors

- A pack that ships a contract with a field typed by a named type rebuilds its contract space (`build:contract-space`, which runs `prisma contract emit`), and updates its pinned contract-space snapshots as in step 2.
- The SQL contract builder takes a model field's domain type parameters from its `descriptor.typeParams`, or else from the named storage type its `descriptor.typeRef` names. A value-object member descriptor has no `typeRef`, so a source that builds member nodes passes the named type's parameters inline in `descriptor.typeParams`.
