import { MongoFieldFilter, MongoProjectStage } from '@internal/mongo-query-ast/execution';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import {
  contractFieldToMongoFieldShape,
  contractModelToMongoResultShape,
} from '../src/result-shape';
import type { TContract } from './fixtures/test-contract';
import { testContractJson } from './fixtures/test-contract';

describe('contractModelToMongoResultShape', () => {
  it('treats omitted cardinality as scalar', () => {
    expect(
      contractFieldToMongoFieldShape({
        type: { kind: 'scalar', codecId: 'mongo/string@1' },
        nullable: false,
      }),
    ).toEqual({ kind: 'leaf', codecId: 'mongo/string@1', nullable: false });
  });
  // Hand-authored fixture JSON; cast at the test-fixture seam (allowed by
  // `.cursor/rules/as-contract-cast-smell.mdc`). Production code crosses
  // the family `deserializeContract` seam instead.
  const contract = blindCast<
    TContract,
    'query-builder fixture JSON carries domain.namespaces envelope'
  >(testContractJson);

  it('maps full Order model scalars to leaf shapes', () => {
    const model = contract.domain.namespaces.__unbound__!.models['Order'];
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
    const namespace = contract.domain.namespaces.__unbound__!;
    const shape = contractModelToMongoResultShape(namespace.models['Customer'], {
      valueObjects: namespace.valueObjects,
    });
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

  it('maps a list of value objects to an array of documents', () => {
    const shape = contractFieldToMongoFieldShape(
      { type: { kind: 'valueObject', name: 'Point' }, nullable: false, many: true },
      {
        Point: {
          fields: { x: { type: { kind: 'scalar', codecId: 'mongo/double@1' }, nullable: false } },
        },
      },
    );
    expect(shape).toEqual({
      kind: 'array',
      nullable: false,
      element: {
        kind: 'document',
        nullable: false,
        fields: { x: { kind: 'leaf', codecId: 'mongo/double@1', nullable: false } },
      },
    });
  });

  it('stops at a value object that contains itself', () => {
    const shape = contractFieldToMongoFieldShape(
      { type: { kind: 'valueObject', name: 'Node' }, nullable: false },
      {
        Node: {
          fields: {
            label: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
            child: { type: { kind: 'valueObject', name: 'Node' }, nullable: true },
          },
        },
      },
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

  it('maps a value-object field to unknown when no value objects are given', () => {
    const model = contract.domain.namespaces.__unbound__!.models['Customer'];
    const shape = contractModelToMongoResultShape(model);
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['address']?.kind).toBe('unknown');
  });

  it('describes an included relation with the shape it is given', () => {
    const model = contract.domain.namespaces.__unbound__!.models['Order'];
    const included = { kind: 'leaf', codecId: 'mongo/string@1', nullable: true } as const;
    const shape = contractModelToMongoResultShape(model, { includes: { customer: included } });
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['customer']).toEqual(included);
  });

  it('restricts fields with selection', () => {
    const model = contract.domain.namespaces.__unbound__!.models['Order'];
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
    const plan = mongoQuery<TContract>({ contractJson: testContractJson }).from('orders').build();
    expect(plan.resultShape?.kind).toBe('document');
  });

  it('project stage reifies a document shape retaining _id and the projected field', () => {
    const plan = mongoQuery<TContract>({ contractJson: testContractJson })
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
