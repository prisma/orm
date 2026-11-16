import { describe, expect, it } from 'vitest';
import { type StoredType, storedPlacesOf } from '../src/core/migrations/mongo-stored-places';
import { contract, type FieldTypeSpec, NS } from './mongo-statement-fixtures';

const STRING: FieldTypeSpec = { codecId: 'mongo/string@1' };
const ADDRESS: StoredType = {
  kind: 'valueObject',
  valueObject: {
    plane: 'storage',
    namespaceId: '__unbound__',
    entityKind: 'valueObject',
    entityName: 'Address',
  },
};
const LINE: StoredType = { kind: 'embeddedModel', model: { namespaceId: NS, model: 'Line' } };
const ADDRESS_FIELDS = { street: STRING, geo: { codecId: '', valueObject: 'Geo' } };

function placesOf(target: StoredType, ...args: Parameters<typeof contract>) {
  const found = storedPlacesOf(contract(...args))(target);
  return found.ok
    ? found.value.map(({ collection, field, steps, model, variant }) => ({
        collection,
        field,
        steps,
        model: model.model,
        variant,
      }))
    : found.failure;
}

describe('storedPlacesOf', () => {
  it('finds a value object held directly, as a list, nested two deep and under a mapped name', () => {
    expect(
      placesOf(
        ADDRESS,
        'places',
        {
          User: {
            collection: 'users',
            fields: ['_id', 'home', 'addresses', 'company'],
            storedAs: { home: 'home_address' },
            types: {
              home: { codecId: '', valueObject: 'Address', nullable: true },
              addresses: { codecId: '', valueObject: 'Address', many: true },
              company: { codecId: '', valueObject: 'Company' },
            },
          },
        },
        { users: {} },
        {
          Address: ADDRESS_FIELDS,
          Geo: { lat: STRING },
          Company: { offices: { codecId: '', valueObject: 'Office', many: true } },
          Office: { address: { codecId: '', valueObject: 'Address' } },
        },
      ),
    ).toEqual([
      { collection: 'users', field: 'home_address', steps: [], model: 'User', variant: undefined },
      {
        collection: 'users',
        field: 'addresses',
        steps: [{ kind: 'wildcard' }],
        model: 'User',
        variant: undefined,
      },
      {
        collection: 'users',
        field: 'company',
        steps: [
          { kind: 'member', name: 'offices' },
          { kind: 'wildcard' },
          { kind: 'member', name: 'address' },
        ],
        model: 'User',
        variant: undefined,
      },
    ]);
  });

  it('finds a value object inside an embedded model, and an embedded model in a one-to-many embed', () => {
    const args: Parameters<typeof contract> = [
      'embeds',
      {
        Order: {
          collection: 'orders',
          fields: ['_id'],
          embeds: {
            lines: { field: 'order_lines', model: 'Line' },
            shipping: { field: 'shipping', model: 'Shipment', cardinality: '1:1' },
          },
        },
        Line: { owner: 'Order', fields: ['sku'] },
        Shipment: {
          owner: 'Order',
          fields: ['to'],
          types: { to: { codecId: '', valueObject: 'Address' } },
        },
      },
      { orders: {} },
      { Address: ADDRESS_FIELDS, Geo: { lat: STRING } },
    ];
    expect([placesOf(ADDRESS, ...args), placesOf(LINE, ...args)]).toEqual([
      [
        {
          collection: 'orders',
          field: 'shipping',
          steps: [{ kind: 'member', name: 'to' }],
          model: 'Order',
          variant: undefined,
        },
      ],
      [
        {
          collection: 'orders',
          field: 'order_lines',
          steps: [{ kind: 'wildcard' }],
          model: 'Order',
          variant: undefined,
        },
      ],
    ]);
  });

  it("finds a value object a variant holds, with the variant's discriminator value", () => {
    expect(
      placesOf(
        ADDRESS,
        'variants',
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            storedAs: { type: 'kind' },
            discriminator: 'type',
            variants: { Visit: 'visit' },
          },
          Visit: {
            base: 'Task',
            fields: ['where'],
            types: { where: { codecId: '', valueObject: 'Address' } },
          },
        },
        { tasks: {} },
        { Address: ADDRESS_FIELDS, Geo: { lat: STRING } },
      ),
    ).toEqual([
      {
        collection: 'tasks',
        field: 'where',
        steps: [],
        model: 'Visit',
        variant: { field: 'kind', value: 'visit' },
      },
    ]);
  });

  it('throws for an embedded model with variants, which contract validation refuses', () => {
    expect(() =>
      placesOf(
        LINE,
        'embedded variants',
        {
          Order: {
            collection: 'orders',
            fields: ['_id'],
            embeds: { lines: { field: 'lines', model: 'Line', cardinality: '1:N' } },
          },
          Line: {
            owner: 'Order',
            fields: ['kind'],
            discriminator: 'kind',
            variants: { Gift: 'gift' },
          },
          Gift: { base: 'Line', fields: ['note'] },
        },
        { orders: {} },
      ),
    ).toThrow('Embedded model "Line" has variants, which contract validation refuses');
  });

  it('refuses a root field that holds the type through a value object that contains itself', () => {
    expect(
      placesOf(
        ADDRESS,
        'recursive',
        {
          User: {
            collection: 'users',
            fields: ['_id', 'tree'],
            types: { tree: { codecId: '', valueObject: 'Tree' } },
          },
        },
        { users: {} },
        {
          Address: ADDRESS_FIELDS,
          Geo: { lat: STRING },
          Tree: {
            at: { codecId: '', valueObject: 'Address' },
            children: { codecId: '', valueObject: 'Tree', many: true },
          },
        },
      ),
    ).toEqual({
      collection: 'users',
      model: { namespaceId: NS, model: 'User' },
      field: 'tree',
      reach: { kind: 'containsItself', type: 'Tree' },
    });
  });

  it('lists no path through a value object that contains itself but not the type', () => {
    expect(
      placesOf(
        ADDRESS,
        'unrelated-recursion',
        {
          User: {
            collection: 'users',
            fields: ['_id', 'tree', 'home'],
            types: {
              tree: { codecId: '', valueObject: 'Tree' },
              home: { codecId: '', valueObject: 'Address' },
            },
          },
        },
        { users: {} },
        {
          Address: ADDRESS_FIELDS,
          Geo: { lat: STRING },
          Tree: { children: { codecId: '', valueObject: 'Tree', many: true } },
        },
      ),
    ).toEqual([
      { collection: 'users', field: 'home', steps: [], model: 'User', variant: undefined },
    ]);
  });

  it('refuses a union or a dictionary that holds the type', () => {
    const holding = (spec: FieldTypeSpec) =>
      placesOf(
        ADDRESS,
        'unlisted',
        { User: { collection: 'users', fields: ['_id', 'held'], types: { held: spec } } },
        { users: {} },
        { Address: ADDRESS_FIELDS, Geo: { lat: STRING } },
      );
    expect([
      holding({ codecId: '', union: ['Address'] }),
      holding({ codecId: '', valueObject: 'Address', dict: true }),
    ]).toEqual([
      {
        collection: 'users',
        model: { namespaceId: NS, model: 'User' },
        field: 'held',
        reach: { kind: 'union' },
      },
      {
        collection: 'users',
        model: { namespaceId: NS, model: 'User' },
        field: 'held',
        reach: { kind: 'dictionary' },
      },
    ]);
  });
});
