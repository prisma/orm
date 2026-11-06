---
changes:
  - id: mongo-fields-take-a-type
    summary: |
      The MongoDB TypeScript builder writes a field as `field.scalar(type.X())`, where `type` holds the type constructors the target and extension packs contribute, as PSL names them: `field.objectId()` is now `field.scalar(type.ObjectId())`, `field.vector({ typeParams: { length: 3 } })` is `field.scalar(type.Vector(3))`, and `field.scalar('mongo/string@1')` is `field.scalar(type.String())`. `field.objectId()`, `field.string()`, `field.double()`, `field.int32()`, `field.bool()`, `field.date()`, `field.int64()`, `field.int64Number()`, `field.decimal128()`, `field.binary()`, `field.json()`, `field.bson()`, `field.vector()` and `field.scalar(codecId)` are removed. `type` comes from the `defineContract` callback, or from `@prisma/orm-mongo/contract-builder`. The MongoDB target now contributes these constructors in its descriptor's `authoring.type`, which the adapter contributed before; `Vector` is new. Run `scripts/rewrite-mongo-field-types.ts` to rewrite them. The contract does not change. The detection matches MongoDB contract sources that call a removed helper.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"])[\s\S]*(?<![\w$])field\s*\.\s*(?:(?:objectId|string|double|int32|bool|date|int64|int64Number|decimal128|binary|json|bson|vector)\s*\(|scalar\s*\(\s*[\x27"])'
        - '(?<![\s\S])(?=[\s\S]*@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"])(?=[\s\S]*\bfield\s*(?:as\s+|:\s*)[A-Za-z_$][\w$]*)[\s\S]*\.\s*(?:(?:objectId|string|double|int32|bool|date|int64|int64Number|decimal128|binary|json|bson|vector)\s*\(|scalar\s*\(\s*[\x27"])'
    script: scripts/rewrite-mongo-field-types.ts
---

# MongoDB fields take a type from `type`

```ts
// Before
export const contract = defineContract({}, ({ field, model }) => ({
  models: {
    Doc: model('Doc', {
      fields: {
        _id: field.objectId(),
        embedding: field.vector({ typeParams: { length: 3 } }),
        raw: field.scalar('mongo/bson@1'),
      },
    }),
  },
}));

// After
export const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Doc: model('Doc', {
      fields: {
        _id: field.scalar(type.ObjectId()),
        embedding: field.scalar(type.Vector(3)),
        raw: field.scalar(type.Bson()),
      },
    }),
  },
}));
```

## `mongo-fields-take-a-type`

Commit your work first. The script reads your code with the TypeScript compiler, so the project needs `typescript` installed. From the project root, run:

```sh
node scripts/rewrite-mongo-field-types.ts
```

Pass files or directories to limit it. The script prints a line for each call it leaves. Rewrite each one by hand, except where the line says the script cannot tell the `field` is the MongoDB builder's and it is not. Then type-check the project. The script neither changes nor reports a `field.scalar` call whose argument is computed, such as `field.scalar(codecIdOf(kind))`, because it cannot tell a codec id from a type there; the type check reports each one that passes a codec id, since `field.scalar` takes only a type now. Write those with `type.X()`.

A field typed by your extension's own codec, written `field.scalar('shout/text@1')` before, needs a type constructor in your extension descriptor's `authoring.type`, under your namespace. The contract then writes `field.scalar(type.shout.Text())`:

```ts
authoring: {
  type: {
    shout: { Text: { kind: 'typeConstructor', output: { codecId: 'shout/text@1' } } },
  },
},
```

The script reports such a call and leaves it, because it cannot know the constructor's name.
