import type {
  MigrationSubject,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { workspaceMigrationModule } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { PlannerProducedMongoMigration } from '../src/core/migrations/planner-produced-migration';
import {
  type CollectionSpec,
  contract,
  type FieldTypeSpec,
  type ModelSpec,
  NS,
  plan,
  planned,
  refusal,
  renameField,
  schemaCollection,
} from './mongo-statement-fixtures';

const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const OBJECT_ID: FieldTypeSpec = { codecId: 'mongo/objectId@1' };

function voField(valueObject: string, extra: Partial<FieldTypeSpec> = {}): FieldTypeSpec {
  return { codecId: '', valueObject, ...extra };
}

const renameAddressField = (from: string, to: string): ResolvedMigrationStatement => ({
  kind: 'rename',
  entity: 'valueObjectField',
  from: { namespaceId: NS, valueObject: 'Address', field: from },
  to: { namespaceId: NS, valueObject: 'Address', field: to },
});

const addressFieldSubject = (field: string): MigrationSubject => ({
  kind: 'valueObjectField',
  namespaceId: NS,
  valueObject: 'Address',
  field,
});

/** Users holding addresses as a list; `address` gives the fields of `Address`. */
function users(
  seed: string,
  address: Record<string, FieldTypeSpec>,
  collection: CollectionSpec = {},
  models: Readonly<Record<string, ModelSpec>> = {},
) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', 'addresses'],
        types: { _id: OBJECT_ID, addresses: voField('Address', { many: true }) },
      },
      ...models,
    },
    { users: collection },
    { Address: address },
  );
}

const live = [schemaCollection('users')];

/** The stored key calls of the plan's migration.ts, without white space. */
function rendered(result: ReturnType<typeof plan>): readonly string[] {
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts, null, 2));
  const source = (result.plan as PlannerProducedMongoMigration)
    .renderTypeScript(workspaceMigrationModule.mongo)
    .replace(/\s+/g, '')
    .replace(/,\}/g, '}');
  return source.match(/(?:rename|remove)StoredKey\(\{[^)]*\}\)/g) ?? [];
}

describe('MongoMigrationPlanner, a field of a value object', () => {
  it('renames the key wherever the value object is stored, in a list', () => {
    const result = plan({
      from: users('from', { street: STRING }),
      to: users('to', { line1: STRING }),
      schema: live,
      statements: [renameAddressField('street', 'line1')],
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Rename key "street" to "line1" at path "$[*]" in field addresses of collection users',
      ],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
      rendered: [
        'renameStoredKey({collection:"users",field:"addresses",path:"$[*].street",to:"line1"})',
      ],
    });
  });

  it('removes the key of a removed field, as a data loss of the value object field', () => {
    const result = plan({
      from: users('from', { street: STRING, zip: STRING }),
      to: users('to', { zip: STRING }),
      schema: live,
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: ['Remove key "street" at path "$[*]" in field addresses of collection users'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: addressFieldSubject('street'),
          loss: 'drop',
          label: 'Remove key "street" at path "$[*]" in field addresses of collection users',
        },
      ],
      rendered: ['removeStoredKey({collection:"users",field:"addresses",path:"$[*].street"})'],
    });
  });

  it('rewrites a value object held directly, under a mapped name, and nested two deep', () => {
    const holders = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', 'home', 'company'],
            storedAs: { home: 'home_address' },
            types: {
              _id: OBJECT_ID,
              home: voField('Address', { nullable: true }),
              company: voField('Company'),
            },
          },
        },
        { users: {} },
        {
          Address: address,
          Company: { offices: voField('Office', { many: true }) },
          Office: { address: voField('Address') },
        },
      );
    const result = plan({
      from: holders('from', { street: STRING, zip: STRING }),
      to: holders('to', { line1: STRING }),
      schema: live,
      statements: [renameAddressField('street', 'line1')],
    });
    expect(rendered(result)).toEqual([
      'renameStoredKey({collection:"users",field:"home_address",path:"$.street",to:"line1"})',
      'renameStoredKey({collection:"users",field:"company",path:"$.offices[*].address.street",to:"line1"})',
      'removeStoredKey({collection:"users",field:"home_address",path:"$.zip"})',
      'removeStoredKey({collection:"users",field:"company",path:"$.offices[*].address.zip"})',
    ]);
  });

  it("filters a variant's rewrite on its discriminator value", () => {
    const tasks = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            types: { _id: OBJECT_ID },
            storedAs: { type: 'kind' },
            discriminator: 'type',
            variants: { Visit: 'visit' },
          },
          Visit: { base: 'Task', fields: ['where'], types: { where: voField('Address') } },
        },
        { tasks: {} },
        { Address: address },
      );
    const result = plan({
      from: tasks('from', { street: STRING }),
      to: tasks('to', { line1: STRING }),
      schema: [schemaCollection('tasks')],
      statements: [renameAddressField('street', 'line1')],
    });
    expect(rendered(result)).toEqual([
      'renameStoredKey({collection:"tasks",field:"where",path:"$.street",to:"line1",filter:{kind:"visit"}})',
    ]);
  });

  it('runs renames, then removals, before the validator change', () => {
    const validator = (key: string) => ({
      bsonType: 'object',
      properties: {
        _id: { bsonType: 'objectId' },
        addresses: {
          bsonType: 'array',
          items: { bsonType: 'object', properties: { [key]: { bsonType: 'string' } } },
        },
      },
    });
    const result = plan({
      from: users('from', { street: STRING, zip: STRING }, { jsonSchema: validator('street') }),
      to: users('to', { line1: STRING }, { jsonSchema: validator('line1') }),
      schema: [schemaCollection('users', { jsonSchema: validator('street') })],
      statements: [renameAddressField('street', 'line1')],
    });
    expect(planned(result).labels).toEqual([
      'Rename key "street" to "line1" at path "$[*]" in field addresses of collection users',
      'Remove key "zip" at path "$[*]" in field addresses of collection users',
      'Update validator on users (changed: addresses)',
    ]);
  });

  it('without an origin contract, removes a key the destination validator no longer declares, named by its storage name', () => {
    const validator = (...keys: string[]) => ({
      bsonType: 'object',
      properties: {
        _id: { bsonType: 'objectId' },
        addresses: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: Object.fromEntries(keys.map((key) => [key, { bsonType: 'string' }])),
            additionalProperties: false,
          },
        },
      },
      additionalProperties: false,
    });
    const result = plan({
      from: null,
      to: users('to', { zip: STRING }, { jsonSchema: validator('zip') }),
      schema: [schemaCollection('users', { jsonSchema: validator('street', 'zip') })],
    });
    expect({ ...planned(result), rendered: rendered(result) }).toEqual({
      labels: [
        'Remove key "street" at path "$[*]" in field addresses of collection users',
        'Update validator on users (changed: addresses)',
      ],
      classes: ['destructive', 'widening'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'storage', name: 'users.addresses.street' },
          loss: 'drop',
          label: 'Remove key "street" at path "$[*]" in field addresses of collection users',
        },
      ],
      rendered: ['removeStoredKey({collection:"users",field:"addresses",path:"$[*].street"})'],
    });
  });

  it('without an origin contract, refuses a key removal in a time-series collection', () => {
    const validator = (...keys: string[]) => ({
      bsonType: 'object',
      properties: {
        addresses: {
          bsonType: 'array',
          items: {
            bsonType: 'object',
            properties: Object.fromEntries(keys.map((key) => [key, { bsonType: 'string' }])),
          },
        },
      },
    });
    expect(
      refusal(
        plan({
          from: null,
          to: users('to', { zip: STRING }, { jsonSchema: validator('zip') }),
          schema: [
            schemaCollection('users', { jsonSchema: validator('street', 'zip'), timeseries: true }),
          ],
        }),
      ),
    ).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove key "street" inside field "addresses" in collection "users": it is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so the key cannot be removed from the documents that hold it. Keep the key in the contract, as an optional field if new documents leave it out, then run this command again.',
      },
    ]);
  });

  it('refuses a rename in a time-series collection', () => {
    expect(
      refusal(
        plan({
          from: users('from', { street: STRING }),
          to: users('to', { line1: STRING }),
          schema: [schemaCollection('users', { timeseries: true })],
          statements: [renameAddressField('street', 'line1')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename value object field "Address.street" inside field "addresses" in collection "users": it is a time-series collection',
        why: "MongoDB updates the documents of a time-series collection only through its metaField, so the key cannot be renamed in the documents. Keep the key's name in the contract, then run this command again.",
      },
    ]);
  });

  it('refuses a removal in a collection another root model shares with no discriminator', () => {
    const shared = (seed: string, address: Record<string, FieldTypeSpec>) =>
      users(
        seed,
        address,
        {},
        {
          Note: {
            collection: 'users',
            fields: ['_id', 'addresses'],
            types: { _id: OBJECT_ID, addresses: { codecId: 'mongo/string@1', many: true } },
          },
        },
      );
    expect(
      refusal(
        plan({
          from: shared('from', { street: STRING, zip: STRING }),
          to: shared('to', { zip: STRING }),
          schema: live,
        }),
      ),
    ).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove value object field "Address.street" inside field "addresses" of model "User" in collection "users": model "Note" stores it in the same collection',
        why: 'Collection "users" stores several models and no discriminator tells their documents apart, so removing the key would remove it from the documents of "Note" too. To keep it in "Note" documents only, move the models to separate collections, or carry out the change yourself, with a filter that selects only their documents, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh.',
      },
    ]);
  });

  it('rewrites once a value object two root models of one collection hold the same way', () => {
    const shared = (seed: string, address: Record<string, FieldTypeSpec>) =>
      users(
        seed,
        address,
        {},
        {
          Note: {
            collection: 'users',
            fields: ['_id', 'addresses'],
            types: { _id: OBJECT_ID, addresses: voField('Address', { many: true }) },
          },
        },
      );
    expect(
      rendered(
        plan({
          from: shared('from', { street: STRING }),
          to: shared('to', { line1: STRING }),
          schema: live,
          statements: [renameAddressField('street', 'line1')],
        }),
      ),
    ).toEqual([
      'renameStoredKey({collection:"users",field:"addresses",path:"$[*].street",to:"line1"})',
    ]);
  });

  it('refuses a rename through a value object that contains itself', () => {
    const trees = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', 'tree'],
            types: { _id: OBJECT_ID, tree: voField('Tree') },
          },
        },
        { users: {} },
        {
          Address: address,
          Tree: { at: voField('Address'), children: voField('Tree', { many: true }) },
        },
      );
    expect(
      refusal(
        plan({
          from: trees('from', { street: STRING }),
          to: trees('to', { line1: STRING }),
          schema: live,
          statements: [renameAddressField('street', 'line1')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename value object field "Address.street" to "Address.line1": field "tree" of collection "users" holds it inside "Tree", which contains itself, so the documents can hold it at any depth',
        why: 'The plan rewrites a key at every path from a field to its objects, and a type that contains itself has no last path. Rewrite field "tree" of collection "users" yourself, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh, or leave out this statement.',
      },
    ]);
  });

  it('refuses a rename in a collection whose control policy is not managed', () => {
    expect(
      refusal(
        plan({
          from: users('from', { street: STRING }, { control: 'tolerated' }),
          to: users('to', { line1: STRING }, { control: 'tolerated' }),
          schema: live,
          statements: [renameAddressField('street', 'line1')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename value object field "Address.street" to "Address.line1": collection "users" has control policy "tolerated"',
        why: 'Statements rename only collections, and fields of collections, whose control policy is "managed". Make the change in the database yourself and leave out this statement.',
      },
    ]);
  });

  it('refuses a rename to a key MongoDB cannot write', () => {
    expect(
      refusal(
        plan({
          from: users('from', { street: STRING }),
          to: users('to', { $line: STRING }),
          schema: live,
          statements: [renameAddressField('street', '$line')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename value object field "Address.street" to "Address.$line": the stored name "$line" cannot be written',
        why: 'MongoDB reads a name starting with "$" as an operator. Give the field a stored name without "." that does not start with "$", or leave out this statement.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, a field of an embedded model', () => {
  const orders = (seed: string, line: Record<string, FieldTypeSpec>, storedAs = {}) =>
    contract(
      seed,
      {
        Order: {
          collection: 'orders',
          fields: ['_id'],
          types: { _id: OBJECT_ID },
          embeds: { lines: { field: 'lines', model: 'Line' } },
        },
        Line: { owner: 'Order', fields: Object.keys(line), types: line, storedAs },
      },
      { orders: {} },
    );
  const liveOrders = [schemaCollection('orders')];

  it('renames the key in every element of a one-to-many embed', () => {
    const result = plan({
      from: orders('from', { sku: STRING }),
      to: orders('to', { code: STRING }),
      schema: liveOrders,
      statements: [renameField('Line', 'sku', 'Line', 'code')],
    });
    expect({ applied: planned(result).applied, rendered: rendered(result) }).toEqual({
      applied: [[0]],
      rendered: ['renameStoredKey({collection:"orders",field:"lines",path:"$[*].sku",to:"code"})'],
    });
  });

  it('rewrites a value object field inside the elements of a one-to-many embed', () => {
    const withAddress = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          Order: {
            collection: 'orders',
            fields: ['_id'],
            types: { _id: OBJECT_ID },
            embeds: { lines: { field: 'lines', model: 'Line' } },
          },
          Line: { owner: 'Order', fields: ['to'], types: { to: voField('Address') } },
        },
        { orders: {} },
        { Address: address },
      );
    expect(
      rendered(
        plan({
          from: withAddress('from', { street: STRING, zip: STRING }),
          to: withAddress('to', { line1: STRING }),
          schema: liveOrders,
          statements: [renameAddressField('street', 'line1')],
        }),
      ),
    ).toEqual([
      'renameStoredKey({collection:"orders",field:"lines",path:"$[*].to.street",to:"line1"})',
      'removeStoredKey({collection:"orders",field:"lines",path:"$[*].to.zip"})',
    ]);
  });

  it('plans nothing for a rename whose stored name does not change', () => {
    expect(
      planned(
        plan({
          from: orders('from', { sku: STRING }),
          to: orders('to', { code: STRING }, { code: 'sku' }),
          schema: liveOrders,
          statements: [renameField('Line', 'sku', 'Line', 'code')],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [[]], dataLoss: [] });
  });

  it('removes the key of a removed field, as a data loss of the field', () => {
    const result = plan({
      from: orders('from', { sku: STRING, note: STRING }),
      to: orders('to', { sku: STRING }),
      schema: liveOrders,
    });
    expect({ dataLoss: planned(result).dataLoss, rendered: rendered(result) }).toEqual({
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'Line', field: 'note' },
          loss: 'drop',
          label: 'Remove key "note" at path "$[*]" in field lines of collection orders',
        },
      ],
      rendered: ['removeStoredKey({collection:"orders",field:"lines",path:"$[*].note"})'],
    });
  });
});

describe('MongoMigrationPlanner, keys inside fields: order, policies, names and nesting', () => {
  it('renames an outer key before a key inside it, whatever order the value objects are declared in', () => {
    const holders = (seed: string, hq: string, street: string) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', 'company'],
            types: { _id: OBJECT_ID, company: voField('Company') },
          },
        },
        { users: {} },
        { Address: { [street]: STRING }, Company: { [hq]: voField('Address') } },
      );
    expect(
      rendered(
        plan({
          from: holders('from', 'hq', 'street'),
          to: holders('to', 'head', 'line1'),
          schema: live,
          statements: [
            renameAddressField('street', 'line1'),
            {
              kind: 'rename',
              entity: 'valueObjectField',
              from: { namespaceId: NS, valueObject: 'Company', field: 'hq' },
              to: { namespaceId: NS, valueObject: 'Company', field: 'head' },
            },
          ],
        }),
      ),
    ).toEqual([
      'renameStoredKey({collection:"users",field:"company",path:"$.hq",to:"head"})',
      'renameStoredKey({collection:"users",field:"company",path:"$.head.street",to:"line1"})',
    ]);
  });

  it('leaves out a removal in a collection whose control policy is not managed', () => {
    expect(
      planned(
        plan({
          from: users('from', { street: STRING, zip: STRING }, { control: 'tolerated' }),
          to: users('to', { street: STRING }, { control: 'tolerated' }),
          schema: live,
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });

  it('refuses a rename below a stored name MongoDB cannot rewrite', () => {
    const dotted = (seed: string, address: Record<string, FieldTypeSpec>) =>
      contract(
        seed,
        {
          User: {
            collection: 'users',
            fields: ['_id', 'home'],
            storedAs: { home: 'home.address' },
            types: { _id: OBJECT_ID, home: voField('Address') },
          },
        },
        { users: {} },
        { Address: address },
      );
    expect(
      refusal(
        plan({
          from: dotted('from', { street: STRING }),
          to: dotted('to', { line1: STRING }),
          schema: live,
          statements: [renameAddressField('street', 'line1')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename value object field "Address.street" to "Address.line1": the stored name "home.address" cannot be rewritten',
        why: 'MongoDB reads a name containing "." as a path into embedded documents, so the plan cannot rewrite the key. Rewrite it in the database yourself, or leave out this statement.',
      },
    ]);
  });

  const orders = (seed: string, part: Record<string, FieldTypeSpec>, storedAs = {}) =>
    contract(
      seed,
      {
        Order: {
          collection: 'orders',
          fields: ['_id'],
          types: { _id: OBJECT_ID },
          embeds: { lines: { field: 'lines', model: 'Line' } },
        },
        Line: {
          owner: 'Order',
          fields: ['name'],
          embeds: { parts: { field: 'parts', model: 'Part' } },
        },
        Part: { owner: 'Line', fields: Object.keys(part), types: part, storedAs },
      },
      { orders: {} },
    );

  it('renames a key of an embedded model inside an embedded model', () => {
    expect(
      rendered(
        plan({
          from: orders('from', { sku: STRING }),
          to: orders('to', { code: STRING }),
          schema: [schemaCollection('orders')],
          statements: [renameField('Part', 'sku', 'Part', 'code')],
        }),
      ),
    ).toEqual([
      'renameStoredKey({collection:"orders",field:"lines",path:"$[*].parts[*].sku",to:"code"})',
    ]);
  });

  it('renames the mapped stored name of an embedded model field when the mapping changes', () => {
    expect(
      rendered(
        plan({
          from: orders('from', { sku: STRING }, { sku: 's' }),
          to: orders('to', { code: STRING }, { code: 'c' }),
          schema: [schemaCollection('orders')],
          statements: [renameField('Part', 'sku', 'Part', 'code')],
        }),
      ),
    ).toEqual([
      'renameStoredKey({collection:"orders",field:"lines",path:"$[*].parts[*].s",to:"c"})',
    ]);
  });
});
