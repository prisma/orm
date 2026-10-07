import { describe, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract as CompoundParentContract } from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';
import parentIdCompoundChildIdCompoundChildReferencesParentCompoundId from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdCompoundChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_compound__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdCompoundChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_compound__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdNoneChildReferencesParentCompoundId from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_none__child_references_parent_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdNoneChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_none__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdNoneChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_none__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdSimpleChildReferencesParentCompoundId from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_simple__child_references_parent_compound_id/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdSimpleChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_simple__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdCompoundChildIdSimpleChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_compound__child_id_simple__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdCompoundChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_none__child_id_compound__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdCompoundChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_none__child_id_compound__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdNoneChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_none__child_id_none__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdNoneChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_none__child_id_none__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdSimpleChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_none__child_id_simple__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdNoneChildIdSimpleChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_none__child_id_simple__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundChildReferencesParentId from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_compound__child_references_parent_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_compound__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdCompoundChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_compound__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneChildReferencesParentId from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_none__child_references_parent_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_none__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdNoneChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_none__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import type { Contract } from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import parentIdSimpleChildIdSimpleChildReferencesParentId from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_id/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleChildReferencesParentP from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_p/generated/contract.json' with {
  type: 'json',
};
import parentIdSimpleChildIdSimpleChildReferencesParentP1P2 from './_fixture/parent_to_many_child_to_one_required__parent_id_simple__child_id_simple__child_references_parent_p_1_p_2/generated/contract.json' with {
  type: 'json',
};
import * as sharedKey from './nested_update_many_inside_update.to_many';
import * as compoundParentId from './nested_update_many_inside_update.to_many.compound_parent_id';

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

const sharedKeyTests = [
  ['pm_c1_req: updates the matching children of the parent', sharedKey.updatesMatchingChildren],
  ['pm_c1_req_many_ums', sharedKey.severalUpdateManys],
  ['pm_c1_req_empty_filter', sharedKey.emptyFilter],
  ['pm_c1_req_noop_no_hit', sharedKey.noHit],
  ['pm_c1_req_many_filters', sharedKey.overlappingFilters],
] as const;

const compoundIdTests = [
  [
    'pm_c1_req: updates the matching children of the parent',
    compoundParentId.updatesMatchingChildren,
  ],
  ['pm_c1_req_many_ums', compoundParentId.severalUpdateManys],
  ['pm_c1_req_empty_filter', compoundParentId.emptyFilter],
  ['pm_c1_req_noop_no_hit', compoundParentId.noHit],
  ['pm_c1_req_many_filters', compoundParentId.overlappingFilters],
] as const;

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update, PM to C1!', () => {
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
