import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, it } from 'vitest';
import { type PortContext, timeouts, withPostgresPort } from '../../../../../_harness/postgres';

export type ParentIdShape = 'simple' | 'compound' | 'none';

export type SchemaVariant = readonly [name: string, contractJson: unknown, parentId: ParentIdShape];

export type SharedParentKey = 'p' | 'p_1_p_2' | 'id';

export type PortDb<TContract extends Contract<SqlStorage>> = PortContext<TContract>['db'];

export type SharedKeyTest<TContract extends Contract<SqlStorage>> = readonly [
  title: string,
  body: (db: PortDb<TContract>, parentKey: SharedParentKey) => Promise<void>,
];

export type CompoundIdTest<TContract extends Contract<SqlStorage>> = readonly [
  title: string,
  body: (db: PortDb<TContract>) => Promise<void>,
];

const sharedKeysByParentId: Record<ParentIdShape, readonly SharedParentKey[]> = {
  simple: ['p', 'p_1_p_2', 'id'],
  compound: ['p', 'p_1_p_2'],
  none: ['p', 'p_1_p_2'],
};

export function describeRelationLinkMatrix<
  TSharedContract extends Contract<SqlStorage>,
  TCompoundContract extends Contract<SqlStorage>,
>(
  schemas: readonly SchemaVariant[],
  sharedKeyTests: readonly SharedKeyTest<TSharedContract>[],
  compoundIdTests: readonly CompoundIdTest<TCompoundContract>[],
): void {
  describe.each(schemas)('%s', (_name, contractJson, parentId) => {
    const runs: Array<readonly [string, (replaceDatabase: boolean) => Promise<void>]> = [];

    for (const parentKey of sharedKeysByParentId[parentId]) {
      for (const [title, body] of sharedKeyTests) {
        runs.push([
          `${title}, parent found by ${parentKey}`,
          (replaceDatabase) =>
            withPostgresPort<TSharedContract>({ contractJson, replaceDatabase }, ({ db }) =>
              body(db, parentKey),
            ),
        ]);
      }
    }

    if (parentId === 'compound') {
      for (const [title, body] of compoundIdTests) {
        runs.push([
          `${title}, parent found by id_1_id_2`,
          (replaceDatabase) =>
            withPostgresPort<TCompoundContract>({ contractJson, replaceDatabase }, ({ db }) =>
              body(db),
            ),
        ]);
      }
    }

    runs.forEach(([title, run], index) => {
      it(title, () => run(index === runs.length - 1), timeouts.spinUpPpgDev);
    });
  });
}
