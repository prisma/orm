import { describe, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract as CompoundParentContract } from '../_fixture/one_to_one_optional__parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';
import parentIdCompoundChildIdCompoundChildReferencesParentCompoundId from '../_fixture/one_to_one_optional__parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdCompoundChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_compound__child_id_compound__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdCompoundChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_compound__child_id_compound__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdNoneChildReferencesParentCompoundId from '../_fixture/one_to_one_optional__parent_id_compound__child_id_none__child_references_parent_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdNoneChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_compound__child_id_none__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdNoneChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_compound__child_id_none__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdSimpleChildReferencesParentCompoundId from '../_fixture/one_to_one_optional__parent_id_compound__child_id_simple__child_references_parent_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdSimpleChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_compound__child_id_simple__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdSimpleChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_compound__child_id_simple__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdCompoundChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_none__child_id_compound__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdCompoundChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_none__child_id_compound__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdNoneChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_none__child_id_none__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdNoneChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_none__child_id_none__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdSimpleChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_none__child_id_simple__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdSimpleChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_none__child_id_simple__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundChildReferencesParentId from '../_fixture/one_to_one_optional__parent_id_simple__child_id_compound__child_references_parent_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_simple__child_id_compound__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_simple__child_id_compound__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundParentReferencesChildC from '../_fixture/one_to_one_optional__parent_id_simple__child_id_compound__parent_references_child_c/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundParentReferencesChildC1C2 from '../_fixture/one_to_one_optional__parent_id_simple__child_id_compound__parent_references_child_c_1_c_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundParentReferencesChildCompoundId from '../_fixture/one_to_one_optional__parent_id_simple__child_id_compound__parent_references_child_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneChildReferencesParentId from '../_fixture/one_to_one_optional__parent_id_simple__child_id_none__child_references_parent_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_simple__child_id_none__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_simple__child_id_none__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneParentReferencesChildC from '../_fixture/one_to_one_optional__parent_id_simple__child_id_none__parent_references_child_c/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneParentReferencesChildC1C2 from '../_fixture/one_to_one_optional__parent_id_simple__child_id_none__parent_references_child_c_1_c_2/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import parentIdSimpleChildIdSimpleChildReferencesParentId from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleChildReferencesParentP from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleChildReferencesParentP1P2 from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleParentReferencesChildC from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__parent_references_child_c/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleParentReferencesChildC1C2 from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__parent_references_child_c_1_c_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleParentReferencesChildId from '../_fixture/one_to_one_optional__parent_id_simple__child_id_simple__parent_references_child_id/generated/contract.json' with {
  type: 'json',
};
import * as sharedKey from './nested_update_many_inside_update.to_one';
import * as compoundParentId from './nested_update_many_inside_update.to_one.compound_parent_id';

type ParentIdShape = 'simple' | 'compound' | 'none';

const schemas: ReadonlyArray<
  readonly [name: string, contractJson: unknown, parentId: ParentIdShape]
> = [
  [
    'parent id simple, child id simple, child references parent id',
    parentIdSimpleChildIdSimpleChildReferencesParentId,
    'simple',
  ],
  [
    'parent id simple, child id simple, parent references child id',
    parentIdSimpleChildIdSimpleParentReferencesChildId,
    'simple',
  ],
  [
    'parent id simple, child id simple, parent references child c',
    parentIdSimpleChildIdSimpleParentReferencesChildC,
    'simple',
  ],
  [
    'parent id simple, child id simple, parent references child c 1 c 2',
    parentIdSimpleChildIdSimpleParentReferencesChildC1C2,
    'simple',
  ],
  [
    'parent id simple, child id simple, child references parent p',
    parentIdSimpleChildIdSimpleChildReferencesParentP,
    'simple',
  ],
  [
    'parent id simple, child id simple, child references parent p 1 p 2',
    parentIdSimpleChildIdSimpleChildReferencesParentP1P2,
    'simple',
  ],
  [
    'parent id simple, child id compound, child references parent id',
    parentIdSimpleChildIdCompoundChildReferencesParentId,
    'simple',
  ],
  [
    'parent id simple, child id compound, parent references child compound id',
    parentIdSimpleChildIdCompoundParentReferencesChildCompoundId,
    'simple',
  ],
  [
    'parent id simple, child id compound, parent references child c',
    parentIdSimpleChildIdCompoundParentReferencesChildC,
    'simple',
  ],
  [
    'parent id simple, child id compound, parent references child c 1 c 2',
    parentIdSimpleChildIdCompoundParentReferencesChildC1C2,
    'simple',
  ],
  [
    'parent id simple, child id compound, child references parent p',
    parentIdSimpleChildIdCompoundChildReferencesParentP,
    'simple',
  ],
  [
    'parent id simple, child id compound, child references parent p 1 p 2',
    parentIdSimpleChildIdCompoundChildReferencesParentP1P2,
    'simple',
  ],
  [
    'parent id simple, child id none, child references parent id',
    parentIdSimpleChildIdNoneChildReferencesParentId,
    'simple',
  ],
  [
    'parent id simple, child id none, parent references child c',
    parentIdSimpleChildIdNoneParentReferencesChildC,
    'simple',
  ],
  [
    'parent id simple, child id none, parent references child c 1 c 2',
    parentIdSimpleChildIdNoneParentReferencesChildC1C2,
    'simple',
  ],
  [
    'parent id simple, child id none, child references parent p',
    parentIdSimpleChildIdNoneChildReferencesParentP,
    'simple',
  ],
  [
    'parent id simple, child id none, child references parent p 1 p 2',
    parentIdSimpleChildIdNoneChildReferencesParentP1P2,
    'simple',
  ],
  [
    'parent id compound, child id simple, child references parent compound id',
    parentIdCompoundChildIdSimpleChildReferencesParentCompoundId,
    'compound',
  ],
  [
    'parent id compound, child id simple, child references parent p',
    parentIdCompoundChildIdSimpleChildReferencesParentP,
    'compound',
  ],
  [
    'parent id compound, child id simple, child references parent p 1 p 2',
    parentIdCompoundChildIdSimpleChildReferencesParentP1P2,
    'compound',
  ],
  [
    'parent id compound, child id compound, child references parent compound id',
    parentIdCompoundChildIdCompoundChildReferencesParentCompoundId,
    'compound',
  ],
  [
    'parent id compound, child id compound, child references parent p',
    parentIdCompoundChildIdCompoundChildReferencesParentP,
    'compound',
  ],
  [
    'parent id compound, child id compound, child references parent p 1 p 2',
    parentIdCompoundChildIdCompoundChildReferencesParentP1P2,
    'compound',
  ],
  [
    'parent id compound, child id none, child references parent compound id',
    parentIdCompoundChildIdNoneChildReferencesParentCompoundId,
    'compound',
  ],
  [
    'parent id compound, child id none, child references parent p',
    parentIdCompoundChildIdNoneChildReferencesParentP,
    'compound',
  ],
  [
    'parent id compound, child id none, child references parent p 1 p 2',
    parentIdCompoundChildIdNoneChildReferencesParentP1P2,
    'compound',
  ],
  [
    'parent id none, child id simple, child references parent p',
    parentIdNoneChildIdSimpleChildReferencesParentP,
    'none',
  ],
  [
    'parent id none, child id simple, child references parent p 1 p 2',
    parentIdNoneChildIdSimpleChildReferencesParentP1P2,
    'none',
  ],
  [
    'parent id none, child id compound, child references parent p',
    parentIdNoneChildIdCompoundChildReferencesParentP,
    'none',
  ],
  [
    'parent id none, child id compound, child references parent p 1 p 2',
    parentIdNoneChildIdCompoundChildReferencesParentP1P2,
    'none',
  ],
  [
    'parent id none, child id none, child references parent p',
    parentIdNoneChildIdNoneChildReferencesParentP,
    'none',
  ],
  [
    'parent id none, child id none, child references parent p 1 p 2',
    parentIdNoneChildIdNoneChildReferencesParentP1P2,
    'none',
  ],
];

const sharedKeysByParentId: Record<ParentIdShape, readonly sharedKey.SharedParentKey[]> = {
  simple: ['p', 'p_1_p_2', 'id'],
  compound: ['p', 'p_1_p_2'],
  none: ['p', 'p_1_p_2'],
};

const sharedKeyTests = [['one2n_rel_error_nested_um', sharedKey.rejectsUpdateMany]] as const;

const compoundIdTests = [
  ['one2n_rel_error_nested_um', compoundParentId.rejectsUpdateMany],
] as const;

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update, P1 to C1', () => {
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

      if (parentId === 'compound') {
        for (const [title, body] of compoundIdTests) {
          runs.push([
            `${title}, parent found by id_1_id_2`,
            (replaceDatabase) =>
              withPostgresPort<CompoundParentContract>(
                { contractJson, replaceDatabase },
                ({ db }) => body(db),
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
