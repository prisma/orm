---
changes:
  - id: emitted-field-types-from-shared-generic
    summary: |
      `prisma contract emit` now writes `FieldOutputTypes` and `FieldInputTypes` of every contract, Mongo and SQL, as `FieldTypesFromDomain` from the contract types entry (`@prisma/orm-mongo/contract/types`, `@prisma/orm-postgres/contract/types`, `@prisma/orm-sqlite/contract/types`) applied to the contract's own shape, and each `<Name>Output` and `<Name>Input` value object type as an entry of `ValueObjectTypesFromDomain`. A Mongo vector field with a length is typed through the target's type function instead of the written-out `Vector<N>`. The types do not change. A SQL `contract.d.ts` emitted before this change no longer compiles, because it imports `FieldTypesFromDomain` from the family contract types entry, which no longer exports it; re-emit it. The detection matches a Mongo `contract.d.ts` that writes its field types out and a SQL one that imports the generic from the family entry.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - 'export type FieldOutputTypes = \{'
        - 'FieldTypesFromDomain,\s+RelationKeys,'
  - id: mongo-define-contract-readonly-rows
    summary: |
      A Mongo contract built with `defineContract` now types its fields with the same generic as an emitted `contract.d.ts`. Lists read and write as `readonly T[]` instead of `T[]`, value object fields are `readonly`, and a vector field with a `length` type parameter reads as `Vector<N>` instead of `readonly number[]`. `field.vector()` without type parameters no longer types the field's `typeParams` as `Record<string, unknown>`; its contract type has no `typeParams`, as the built value has none. A type annotation that expects a mutable array or mutable value object from a row must change to the readonly form, or copy the value first. The detection matches Mongo `defineContract` sources with lists, value objects or vectors.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*orm-mongo/contract-builder)[\s\S]*(\.many\(|field\.valueObject\(|field\.vector\()'
  - id: mongo-define-contract-factory-field-types
    summary: |
      `defineContract(scaffold, factory)` from `@prisma/orm-mongo/contract-builder` typed every codec, and so every field, row and create input, as `never`, because the scaffold's forbidden `family` and `target` keys made the whole definition type `never`. The contract type now leaves them out, so fields have their codec types. Code that compiled only because a field was `never`, such as assigning a row field to an unrelated type, now fails to typecheck. The detection matches the factory form of the Mongo `defineContract`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*orm-mongo/contract-builder)[\s\S]*defineContract\(\s*\{[^}]*\}\s*,'
  - id: value-object-enum-fields-narrow
    summary: |
      An enum field inside a value object (a composite type in PSL) now reads and writes the members of its enum, in an emitted `contract.d.ts` and in a contract built with `defineContract`, as an enum field of a model does. Before, the emitted contract typed it as its codec's type, such as `string`. A value object field whose codec renders its own type text, such as `arktype/json@1`, has that type, as before this change. Code that assigns an arbitrary string to such a field now fails to typecheck. Re-emit `contract.d.ts`. The detection matches PSL sources with a composite type that has a field of an enum declared in the same file (an enum in another file of a multi-file schema is not found), and TypeScript value objects whose fields include an enum field, also in the factory form of `defineContract` with renamed helpers.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)enum\s+(\w+)\s*\{[\s\S]*\n\s*type\s+\w+\s*\{[^}]*\s\1[?\[\]]*\s'
        - '(?:^|\n)type\s+\w+\s*\{[^}]*\s(\w+)[?\[\]]*\s[\s\S]*\n\s*enum\s+\1\s*\{'
        - '(?:\bvalueObject|\bvalueObject\s*:\s*(\w+)[\s\S]*?\b\1)\(\s*[''"][^''"]+[''"]\s*,\s*\{\s*fields:\s*\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\.namedType\('
  - id: mongo-update-accessors-take-input-types
    summary: |
      In Mongo ORM updates, the field accessor's `set`, `push`, `pull` and `addToSet` take each field's input type from the contract, including fields reached by a dot path into a value object. `u.role.set(...)` on an enum field takes only its members, a list field takes a readonly list, and a vector field takes `readonly number[]`, which a `Vector<N>` satisfies. Code that passed a value outside an enum now fails to typecheck. A list of numbers no longer offers `inc` and `mul`, which only a single number takes. The detection matches update callbacks, `(u) => [...]`, that call one of these methods on a field of their argument, by name or by a dot path such as `u('home.kind')`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\(?\s*(\w+)\s*\)?\s*=>\s*\[[\s\S]*?\b\1(?:\.\w+|\(\s*[''"][^''"]+[''"]\s*\))+\.(set|push|pull|addToSet|inc|mul)\('
---

# Emitted field types name the shared generic; Mongo `defineContract` rows match emitted ones

Re-emit every contract with `prisma contract emit`. The committed `contract.d.ts` changes form, not meaning: `FieldOutputTypes`, `FieldInputTypes` and the value object types are now applications of `FieldTypesFromDomain` and `ValueObjectTypesFromDomain`, with only the types a codec computes at emit time written out in `FieldTypeOverrides`. A SQL `contract.d.ts` that was not re-emitted fails to compile with an error that `FieldTypesFromDomain` is not exported; re-emitting fixes it.

For a Mongo contract written with `defineContract`, rows now have the types an emitted contract gives:

```ts
// before
const tags: string[] = user.tags;
// after: lists are readonly, as in an emitted contract
const tags: readonly string[] = user.tags;
const copy: string[] = [...user.tags];
```

A vector field with a length, such as `field.vector({ typeParams: { length: 3 } })`, reads as `Vector<3>`, which is still a `readonly number[]`.
