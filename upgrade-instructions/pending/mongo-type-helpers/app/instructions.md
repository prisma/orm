---
changes:
  - id: mongo-fields-take-a-type
    summary: |
      The MongoDB TypeScript builder writes a field as `field.scalar(type.X())`, where `type` holds the type constructors the target and extension packs contribute, as PSL names them: `field.objectId()` is now `field.scalar(type.ObjectId())`, `field.vector({ typeParams: { length: 3 } })` is `field.scalar(type.Vector(3))`, and `field.scalar('mongo/string@1')` is `field.scalar(type.String())`. `field.objectId()`, `field.string()`, `field.double()`, `field.int32()`, `field.bool()`, `field.date()`, `field.int64()`, `field.int64Number()`, `field.decimal128()`, `field.binary()`, `field.json()`, `field.bson()`, `field.vector()` and `field.scalar(codecId)` are removed. `type` comes from the `defineContract` callback, or from `@prisma/orm-mongo/contract-builder`. Run `scripts/rewrite-mongo-field-types.ts` to rewrite them. The contract does not change. The detection matches MongoDB contract sources that call a removed helper.
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

Commit your work first. From the project root, run:

```sh
node scripts/rewrite-mongo-field-types.ts
```

Pass files or directories to limit it. Fix by hand each line the script reports, then type-check the project.
