import {
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoAggOperator,
  MongoGroupStage,
  MongoProjectStage,
  MongoUnwindStage,
  MongoVectorSearchStage,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { computePipelineResultShape } from '../src/pipeline-result-shape';
import { contractModelToMongoResultShape } from '../src/result-shape';
import { testContract } from './fixtures/test-contract';

const orderModel = testContract.domain.namespaces.__unbound__!.models['Order'];
const orderShape = contractModelToMongoResultShape(orderModel);

describe('computePipelineResultShape', () => {
  it('vectorSearch stage carries the input shape through unchanged', () => {
    const stage = new MongoVectorSearchStage({
      index: 'idx',
      path: 'embedding',
      queryVector: [0.1, 0.2],
      numCandidates: 10,
      limit: 1,
    });

    const shape = computePipelineResultShape([stage], orderShape);

    expect(shape).toEqual(orderShape);
    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['_id']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
  });

  it('project stage implicitly keeps _id and keeps a listed scalar field', () => {
    const stage = new MongoProjectStage({ status: 1 });

    const shape = computePipelineResultShape([stage], orderShape);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['_id']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(Object.keys(shape.fields).sort()).toEqual(['_id', 'status']);
  });

  it('project stage renames a field, keying the shape off the source field', () => {
    const stage = new MongoProjectStage({
      label: MongoAggFieldRef.of('status'),
      renamedId: MongoAggFieldRef.of('_id'),
    });

    const shape = computePipelineResultShape([stage], orderShape);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['label']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(shape.fields['renamedId']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
    expect(Object.keys(shape.fields).sort()).toEqual(['_id', 'label', 'renamedId']);
  });

  it('project stage with a computed field yields unknown at that key', () => {
    const stage = new MongoProjectStage({
      status: 1,
      shout: MongoAggOperator.toUpper(MongoAggFieldRef.of('status')),
    });

    const shape = computePipelineResultShape([stage], orderShape);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['shout']).toEqual({ kind: 'unknown' });
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
  });

  it('addFields stage copies a fieldRef source shape and marks computed fields unknown', () => {
    const stage = new MongoAddFieldsStage({
      statusCopy: MongoAggFieldRef.of('status'),
      shout: MongoAggOperator.toUpper(MongoAggFieldRef.of('status')),
    });

    const shape = computePipelineResultShape([stage], orderShape);

    if (shape.kind !== 'document') throw new Error('expected document');
    expect(shape.fields['statusCopy']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
    expect(shape.fields['shout']).toEqual({ kind: 'unknown' });
    // original fields remain
    expect(shape.fields['_id']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/objectId@1',
      nullable: false,
    });
    expect(shape.fields['status']).toEqual({
      kind: 'leaf',
      codecId: 'mongo/string@1',
      nullable: false,
    });
  });

  it('unhandled stage kind collapses the whole shape to unknown', () => {
    const stage = new MongoGroupStage(MongoAggFieldRef.of('status'), {});

    const shape = computePipelineResultShape([stage], orderShape);

    expect(shape).toEqual({ kind: 'unknown' });
  });

  it('unwind stage (also unhandled in this slice) collapses the whole shape to unknown', () => {
    const stage = new MongoUnwindStage('$tags', false);

    const shape = computePipelineResultShape([stage], orderShape);

    expect(shape).toEqual({ kind: 'unknown' });
  });
});
