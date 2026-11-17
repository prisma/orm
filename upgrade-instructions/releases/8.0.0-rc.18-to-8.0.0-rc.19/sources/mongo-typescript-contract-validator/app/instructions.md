---
changes:
  - id: mongo-typescript-contract-validator
    summary: |
      A MongoDB contract written in TypeScript with `defineContract` now gets the same closed collection validator as a PSL contract, and its storage hash changes once. `defineContract` refuses what a validator cannot describe: a field whose codec has no MongoDB data type, a model whose `_id` field can hold an array, a regular expression, undefined or null, an enum a validator cannot list, and an embed relation to a model with variants. MongoDB does not check existing documents when a validator is added, so find and fix the documents the validator would refuse, then apply it with `prisma db update`, or with `prisma migration plan` and `prisma db migrate`. Writing an enum in a TypeScript contract to avoid the validator, as the rc.17 notes advised, no longer works.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '@prisma/orm-(?:mongo/contract-builder|family-mongo/contract-ts/contract-builder)'
---

# TypeScript MongoDB contracts get collection validators

## `mongo-typescript-contract-validator`

### What changes

Before, a MongoDB contract written in TypeScript had no collection validators, so MongoDB accepted any document shape. Now each collection whose control policy is `managed`, the default, gets the validator the same schema gets in PSL: a closed `$jsonSchema` validator with `validationLevel: strict` and `validationAction: error`. It refuses a field the model does not declare, a missing required field, and a value of the wrong BSON type. A `field.vector()` field is validated as an array. The contract's storage hash changes once, because it now includes the validators.

### What `defineContract` now refuses

Building the contract fails with one of these errors. Change the contract until it builds.

- A field whose codec has no MongoDB data type:
  `Model "Place" field "location" uses codec "geo/point@1", which no pack in the contract provides, so its BSON type is unknown and the contract cannot describe the field.`
  List the extension that provides the codec in `extensions` in `defineContract`.
- A model whose `_id` field can hold an array, a regular expression, undefined or null, such as `_id: field.objectId().many()`, `_id: field.string().optional()`, `_id: field.json()`, `_id: field.vector()` or `_id: field.bson()`:
  `Model "User" field "_id" can hold BSON type array or null (codec "mongo/json@1"). An _id cannot be an array, a regular expression, undefined or null: MongoDB refuses the first three, and every document has an _id.`
  Give the `_id` field a required, single-valued type. Its validator requires `_id` with the field's BSON type, so a string, int, date, bytes or document `_id` is kept as it is. A model that leaves `_id` out gets a validator that requires an `objectId` `_id`, which MongoDB adds to every document inserted without one. A model whose `_id` is not stored as an ObjectId must give its `_id` on every create: without one, MongoDB adds an ObjectId `_id`, which the validator refuses.
- An enum a validator cannot list:
  `enumType("Level") codec "mongo/int64@1" stores BSON type long, which a collection validator cannot list as an enum value. Use a codec whose BSON type is string, int, double, bool, object or array.`
  A member whose stored value is not of that type is refused too: `enumType("Ratio") member "All" is stored as "1", which a collection validator cannot list as a double. A member of a double enum must be a finite number.`
- An embed relation to a model with variants:
  `Relation "Owner.task" embeds model "Task", which has variants. The ORM reads and writes only the base fields of an embedded model, so an embedded model cannot have variants.`

The rc.17 upgrade notes advised writing an enum over a codec such as `mongo/int64@1` or `mongo/date@1` in a TypeScript contract, which had no validator. That no longer works: give the enum a codec whose BSON type is string, int, double, bool, object or array.

### The risk: documents already stored

MongoDB does not check existing documents when a validator is added. After it is added, every insert, and every update to a document, must produce a valid document. A stored document that does not match the validator can no longer be updated, and writes from other applications that add fields outside the contract fail.

To keep a collection without a validator, for example because other applications write fields the contract does not declare, give its model a control policy other than `managed`. With `controlPolicy: 'observed'`, Prisma creates and changes nothing in that collection, so it adds no validator, and `prisma db verify` reports the collection's differences from the contract as warnings:

```ts
const Event = model('Event', {
  collection: 'events',
  controlPolicy: 'observed',
  fields: { _id: field.objectId(), name: field.string() },
});
```

`defaultControlPolicy: 'observed'` in `defineContract` does the same for every collection. Such a collection is not created by Prisma either, so create it yourself.

### Steps

1. Run `prisma contract emit`. Each `managed` collection in `contract.json` gains a `validator`, and `storage.storageHash` changes.
2. List the documents each validator would refuse. In `mongosh`, connected to your database, run this from the directory of the emitted `contract.json` (change the path if it is elsewhere):

   ```js
   const contract = JSON.parse(require('fs').readFileSync('contract.json', 'utf8'));
   for (const namespace of Object.values(contract.storage.namespaces)) {
     for (const [name, collection] of Object.entries(namespace.entries.collection ?? {})) {
       if (collection.validator === undefined) continue;
       const refused = db
         .getCollection(name)
         .find({ $nor: [{ $jsonSchema: collection.validator.jsonSchema }] })
         .toArray();
       print(name, refused.length, refused);
     }
   }
   ```

3. Fix each listed document so it matches its model, or move it to another collection. Run step 2 again until every collection lists 0 documents.
4. Apply the validators: run `prisma db update`, or run `prisma migration plan` from the migration the database is at (`--from <its directory name>` if the project has no `db` ref) followed by `prisma db migrate`. The plan has one `widening` operation per collection, `validator.<collection>.add`, which adds its validator.
5. Run `prisma db verify`. It reports no problems.
