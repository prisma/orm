import { describe, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import parentIdSimpleChildIdSimpleJunction from './_fixture/many_to_many__parent_id_simple__child_id_simple__junction/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import * as sharedKey from './nested_update_many_inside_update.to_many';

type ParentIdShape = 'simple' | 'compound' | 'none';

const schemas: ReadonlyArray<
  readonly [name: string, contractJson: unknown, parentId: ParentIdShape]
> = [
  ['parent id simple, child id simple, junction', parentIdSimpleChildIdSimpleJunction, 'simple'],
];

const sharedKeysByParentId: Record<ParentIdShape, readonly sharedKey.SharedParentKey[]> = {
  simple: ['p', 'p_1_p_2', 'id'],
  compound: ['p', 'p_1_p_2'],
  none: ['p', 'p_1_p_2'],
};

const sharedKeyTests = [
  ['pm_cm: updates the matching children of the parent', sharedKey.updatesMatchingChildren],
] as const;

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update, PM to CM', () => {
  for (const [name, contractJson, parentId] of schemas) {
    describe(name, () => {
      const runs: Array<readonly [string, (replaceDatabase: boolean) => Promise<void>]> = [];

      for (const parentKey of sharedKeysByParentId[parentId]) {
        for (const [title, body] of sharedKeyTests) {
          runs.push([
            `${title}, parent found by ${parentKey}`,
            (replaceDatabase) =>
              withPostgresPort<Contract>({ contractJson, replaceDatabase }, ({ db }) =>
                body(db, parentKey),
              ),
          ]);
        }
      }

      runs.forEach(([title, run], index) => {
        it(title, () => run(index === runs.length - 1), timeouts.spinUpPpgDev);
      });
    });
  }
});
