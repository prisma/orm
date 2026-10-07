import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { MongoQueryPlan } from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { createMongoCollection } from '../src/collection';
import type { MongoQueryExecutor } from '../src/executor';

const contract = ormContractJson as unknown as Contract;

function recordingExecutor() {
  const plans: MongoQueryPlan[] = [];
  const executor: MongoQueryExecutor = {
    query<Row>(plan: MongoQueryPlan<Row>): AsyncIterableResult<Row> {
      plans.push(plan as MongoQueryPlan);
      async function* gen(): AsyncGenerator<Row> {
        yield { _id: 'id-1', insertedId: 'id-1' } as Row;
      }
      return new AsyncIterableResult(gen());
    },
    async execute(plan: MongoQueryPlan) {
      plans.push(plan);
      return { affectedRows: 1 };
    },
  };
  return { executor, plans };
}

function paramRefs(value: unknown): MongoParamRef[] {
  if (value instanceof MongoParamRef) return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(paramRefs);
}

describe('a variant collection', () => {
  it("encodes a field declared only on the variant with the variant field's codec", async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'Task', executor)
      .variant('bug')
      .create({ title: 'Crash', assigneeId: 'a1', severity: 'high', comments: [] });

    const severity = paramRefs(plans[0]?.command).find((ref) => ref.name === 'severity');
    expect(severity).toEqual(
      new MongoParamRef('high', {
        codecId: 'mongo/string@1',
        name: 'severity',
        collection: 'tasks',
      }),
    );
  });

  it("decodes a field declared only on the variant with the variant field's codec", async () => {
    const { executor, plans } = recordingExecutor();
    await createMongoCollection(contract, 'Task', executor).variant('bug').all().toArray();

    expect(plans[0]?.resultShape).toMatchObject({
      kind: 'document',
      fields: { severity: { kind: 'leaf', codecId: 'mongo/string@1' } },
    });
  });
});
