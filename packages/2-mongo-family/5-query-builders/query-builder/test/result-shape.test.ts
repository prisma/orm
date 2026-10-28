import type { ContractValueObject } from '@internal/contract/types';
import { MongoFieldFilter, MongoProjectStage } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import {
  contractFieldToMongoFieldShape,
  contractModelToMongoResultShape,
} from '../src/result-shape';
import { testContract } from './fixtures/test-contract';

function valueObjectRef(entityName: string, namespaceId = '__unbound__') {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId,
    entityKind: 'valueObject',
    entityName,
  } as const;
}

function storageWith(
  valueObjects: Readonly<Record<string, ContractValueObject>>,
  namespaceId = '__unbound__',
) {
  return {
    namespaces: { [namespaceId]: { id: namespaceId, entries: { valueObject: valueObjects } } },
  };
}

describe('contractModelToMongoResultShape', () => {
  it('treats omitted cardinality as scalar', () => {
    expect(
      contractFieldToMongoFieldShape({
        type: { kind: 'scalar', codecId: 'mongo/string@1' },
        nullable: false,
      }),
    ).toEqual({ kind: 'leaf', codecId: 'mongo/string@1', nullable: false });
  });
  it('maps full Order model scalars to leaf shapes', () => {
    const model = testContract.domain.namespaces.__unbound__!.models['Order'];
    const shape = contractModelToMongoResultShape(model);
    expect(shape.kind).toBe('document');
    if (shape.kind !== 'document') return;
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(shape.fields['tags']).toEqual({
      kind: 'array',
      nullable: false,
      element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
    });
  });

  it('maps a value-object field to a document of its own fields, nested value objects too', () => {
    const shape = contractModelToMongoResultShape(
      testContract.domain.namespaces.__unbound__!.models['Customer'],
      { storage: testContract.storage },
    );
    if (shape.kind !== 'document') throw new Error('expected document');
    const address = {
      street: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      city: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      zip: { kind: 'leaf', codecId: 'mongo/string@1', nullable: true },
      geo: {
        kind: 'document',
        nullable: false,
        fields: {
          lat: { kind: 'leaf', codecId: 'mongo/double@1', nullable: false },
          lng: { kind: 'leaf', codecId: 'mongo/double@1', nullable: false },
        },
      },
    };
    expect({ address: shape.fields['address'], workAddress: shape.fields['workAddress'] }).toEqual({
      address: { kind: 'document', nullable: false, fields: address },
      workAddress: { kind: 'document', nullable: true, fields: address },
    });
  });

  it.each([false, true])('maps value-object lists with elementNullable=%s', (elementNullable) => {
    const shape = contractFieldToMongoFieldShape(
      { type: valueObjectRef('Point'), nullable: false, many: { elementNullable } },
      storageWith({
        Point: {
          fields: { x: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false } },
        },
      }),
    );
    expect(shape).toEqual({
      kind: 'array',
      nullable: false,
      element: {
        kind: 'document',
        nullable: elementNullable,
        fields: { x: { kind: 'leaf', codecId: 'mongo/double@1', nullable: false } },
      },
    });
  });

  it('stops at a value object that contains itself', () => {
    const shape = contractFieldToMongoFieldShape(
      { type: valueObjectRef('Node'), nullable: false },
      storageWith({
        Node: {
          fields: {
            label: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            child: { type: valueObjectRef('Node'), nullable: true },
          },
        },
      }),
    );
    expect(shape).toEqual({
      kind: 'document',
      nullable: false,
      fields: {
        label: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        child: { kind: 'unknown' },
      },
    });
  });

  it('finds a value object in the storage namespace its reference names', () => {
    const shape = contractFieldToMongoFieldShape(
      { type: valueObjectRef('Point', 'geo'), nullable: false },
      {
        namespaces: {
          ...storageWith({ Point: { fields: {} } }).namespaces,
          ...storageWith(
            {
              Point: {
                fields: {
                  x: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false },
                },
              },
            },
            'geo',
          ).namespaces,
        },
      },
    );
    expect(shape).toEqual({
      kind: 'document',
      nullable: false,
      fields: { x: { kind: 'leaf', codecId: 'mongo/double@1', nullable: false } },
    });
  });

  it('maps a value-object field to unknown when storage has no such value object', () => {
    const shape = contractFieldToMongoFieldShape(
      { type: valueObjectRef('Missing'), nullable: false },
      storageWith({}),
    );
    expect(shape).toEqual({ kind: 'unknown' });
  });

  it('maps a value-object field to unknown when no storage is given', () => {
    const model = testContract.domain.namespaces.__unbound__!.models['Customer'];
    const shape = contractModelToMongoResultShape(model);
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['address']?.kind).toBe('unknown');
  });

  it('describes an included relation with the shape it is given', () => {
    const model = testContract.domain.namespaces.__unbound__!.models['Order'];
    const included = { kind: 'leaf', codecId: 'mongo/string@1', nullable: true } as const;
    const shape = contractModelToMongoResultShape(model, { includes: { customer: included } });
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['customer']).toEqual(included);
  });

  it('keys each field by its stored name, and a selection names stored names', () => {
    const model = {
      fields: {
        id: { type: { kind: 'scalar', codecId: 'mongo/objectId@1' }, nullable: false },
        title: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: true },
      },
      relations: {},
      storage: {
        collection: 'posts',
        fields: { id: { field: '_id' }, title: { field: 'post_title' } },
      },
    } as const;
    expect([
      contractModelToMongoResultShape(model),
      contractModelToMongoResultShape(model, { selection: ['post_title'] }),
    ]).toEqual([
      {
        kind: 'document',
        fields: {
          _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
          post_title: { kind: 'leaf', codecId: 'mongo/string@1', nullable: true },
        },
      },
      {
        kind: 'document',
        fields: { post_title: { kind: 'leaf', codecId: 'mongo/string@1', nullable: true } },
      },
    ]);
  });

  it('restricts fields with selection', () => {
    const model = testContract.domain.namespaces.__unbound__!.models['Order'];
    const shape = contractModelToMongoResultShape(model, { selection: ['status', 'amount'] });
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(Object.keys(shape.fields).sort()).toEqual(['amount', 'status']);
  });
});

describe('contractFieldToMongoFieldShape', () => {
  it('maps a required list with nullable elements exactly', () => {
    expect(
      contractFieldToMongoFieldShape({
        nullable: false,
        many: { elementNullable: true },
        type: { kind: 'scalar', codecId: 'mongo/string@1' },
      }),
    ).toEqual({
      kind: 'array',
      nullable: false,
      element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: true },
    });
  });

  it('maps a nullable list with required elements exactly', () => {
    expect(
      contractFieldToMongoFieldShape({
        nullable: true,
        many: { elementNullable: false },
        type: { kind: 'scalar', codecId: 'mongo/string@1' },
      }),
    ).toEqual({
      kind: 'array',
      nullable: true,
      element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
    });
  });

  it('union field maps to unknown', () => {
    const f = contractFieldToMongoFieldShape({
      nullable: false,
      many: false,
      type: {
        kind: 'union',
        members: [{ kind: 'scalar', codecId: 'mongo/string@1' }],
      },
    });
    expect(f.kind).toBe('unknown');
  });
});

describe('PipelineChain build resultShape', () => {
  it('identity pipeline attaches document shape from bound model', () => {
    const plan = mongoQuery({ contract: testContract }).from('orders').build();
    expect(plan.resultShape?.kind).toBe('document');
  });

  it('decodes a value-object field through the value object storage holds', () => {
    const plan = mongoQuery({ contract: testContract }).from('customers').build();
    if (plan.resultShape?.kind !== 'document') throw new Error('expected document');
    expect(plan.resultShape.fields['stats']).toEqual({
      kind: 'document',
      nullable: false,
      fields: {
        visits: { kind: 'leaf', codecId: 'mongo/double@1', nullable: false },
        lastSeen: { kind: 'leaf', codecId: 'mongo/date@1', nullable: true },
      },
    });
  });

  it('project stage reifies a document shape retaining _id and the projected field', () => {
    const plan = mongoQuery({ contract: testContract })
      .from('orders')
      .match(MongoFieldFilter.eq('status', 'x'))
      .project('status')
      .build();
    expect(plan.command.pipeline.some((s) => s instanceof MongoProjectStage)).toBe(true);
    expect(plan.resultShape).toEqual({
      kind: 'document',
      fields: {
        _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
        status: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
      },
    });
  });
});
