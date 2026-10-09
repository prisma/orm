---
changes:
  - id: typescript-contract-namespace-keys
    summary: |
      A contract built with `defineContract` from TypeScript now types `contract.domain.namespaces`, `contract.storage.namespaces` and `db.orm` with the same namespace keys the built contract has at runtime, each holding only its own models and tables. Before, any string key typechecked and every namespace listed every model. Code that reads a namespace the contract does not have, or indexes `domain.namespaces` with a `string` variable, now fails to typecheck. ORM rows of such a contract, which were typed `unknown` field by field, now have each field's codec output type, so a cast to a type that disagrees with the codec type now fails with TS2352. The detection matches dot and bracket access to `domain.namespaces`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.domain\.namespaces\b'
        - '\[\s*[''"]domain[''"]\s*\]\s*\[\s*[''"]namespaces[''"]\s*\]'
---

# A TypeScript contract's namespaces and rows have precise types

## Namespace keys equal the runtime keys

A contract built with `defineContract` from TypeScript typed `contract.domain.namespaces` as a record with any string key, and every key listed every model. The types now have exactly the keys the built contract has at runtime:

- `contract.domain.namespaces` and `db.orm` have a key for each namespace that holds a model. They also have the default namespace (`public` on Postgres, `__unbound__` on SQLite) when the contract has no models or declares enums. Each namespace lists only its own models.
- `contract.storage.namespaces` has the default namespace, each namespace listed in `namespaces`, and each model's namespace. Each lists only the tables of its own models.

A Postgres contract whose models all have `namespace: 'auth'` has no `public` domain namespace, so `db.orm.public` no longer typechecks. At runtime it was always `undefined`. Code that reads a namespace the contract does not have now fails to typecheck. Use the namespace the model is in:

```diff
  // A Postgres contract built with defineContract, with User in the default namespace
- type User = (typeof contract.domain.namespaces)['__unbound__']['models']['User'];
+ type User = (typeof contract.domain.namespaces)['public']['models']['User'];
```

Indexing `domain.namespaces` with a `string` variable no longer typechecks, because the type has no index signature. Narrow the key to the contract's keys first:

```diff
- const namespace = contract.domain.namespaces[name];
+ const namespace = Object.hasOwn(contract.domain.namespaces, name)
+   ? contract.domain.namespaces[name as keyof typeof contract.domain.namespaces]
+   : undefined;
```

A model is placed in its namespace only when `namespace` is a string literal. When any model's `namespace` comes from a `string` variable, the contract's namespace types fall back to a `string` index, and every namespace lists every model of the contract, as before this change. Access a namespace with brackets and check it for `undefined`, for example `db.orm['billing']?.Invoice`.

On SQLite, `defineContract` no longer accepts `namespaces`. The build always rejected it at runtime; the type now rejects it too. Remove the option.

## Rows have their codec output types

The ORM client of such a contract now types each row field as its codec's output type, narrowed to the enum's values for an enum field. Before, every field was `unknown`. This also applies to `field.column({ codecId, nativeType })` with an inline codec id, which no longer needs `as const`.

A cast that agrees with the codec type still typechecks and can be removed. A cast that disagrees with the codec type now fails with TS2352, and shows a real mismatch: fix the code that expected the other type.

```diff
  const row = await db.orm.Sample.first();
- const when = row.when as string;
+ if (row === null) throw new Error('No sample');
+ const when = row.when.toISOString();
```

`first()` returns `null` when no row matches, which its type now says, so code that read a field of the result without checking for `null` fails to typecheck too.

Rows of an included relation are still typed `unknown`; casts on those still typecheck.
