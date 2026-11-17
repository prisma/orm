import {
  MongoFieldFilter,
  MongoMatchStage,
  MongoProjectStage,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

describe('stored names', () => {
  const accounts = () => mongoQuery({ context: contextOf(testContract) }).from('accounts');

  it('keys the result shape of a model read by stored name', () => {
    expect(accounts().build().resultShape).toEqual({
      kind: 'document',
      fields: {
        _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
        display_name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        home_address: {
          kind: 'document',
          nullable: true,
          fields: {
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
          },
        },
      },
    });
  });

  it('matches and projects on stored names', () => {
    const plan = accounts()
      .match((f) => f.display_name.eq('Ada'))
      .project('display_name')
      .build();
    expect({ pipeline: plan.command.pipeline, resultShape: plan.resultShape }).toEqual({
      pipeline: [
        new MongoMatchStage(MongoFieldFilter.eq('display_name', 'Ada')),
        new MongoProjectStage({ display_name: 1 }),
      ],
      resultShape: {
        kind: 'document',
        fields: {
          _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
          display_name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      },
    });
  });
});
