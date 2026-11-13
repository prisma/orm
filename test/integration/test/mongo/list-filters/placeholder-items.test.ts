import mongo from '@internal/mongo/runtime';
import { contractFromJson } from '@internal/mongo/static';
import {
  AggregateCommand,
  MongoFieldFilter,
  MongoMatchStage,
} from '@internal/mongo-query-ast/execution';
import { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const nullableItem = new MongoPreparedParamRef('item', 'mongo/string@1', true);

describe('a placeholder on one item of a list, in a filter-expression where', () => {
  it('may be nullable when the list items may be null', async () => {
    const db = mongo({ contract });
    const filter = MongoFieldFilter.eq('nullableStrings.0', nullableItem);

    expect(db.orm.lists.where(filter).prepared.all().plan.command).toEqual(
      new AggregateCommand('lists', [new MongoMatchStage(filter)]),
    );
    await db.close();
  });

  it.each(['strings.0', 'optionalStrings.0'])(
    'is refused as nullable when the list items are never null, on %s',
    async (path) => {
      const db = mongo({ contract });

      expect(() => db.orm.lists.where(MongoFieldFilter.eq(path, nullableItem))).toThrow(
        expect.objectContaining({
          code: 'ORM.ARGUMENT_INVALID',
          meta: { name: 'item', field: path, nullable: true, list: false },
        }),
      );
      await db.close();
    },
  );
});
