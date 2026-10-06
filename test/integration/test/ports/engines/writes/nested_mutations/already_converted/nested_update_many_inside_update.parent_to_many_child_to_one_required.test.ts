import { describe } from 'vitest';
import type { Contract as CompoundParentContract } from './_fixture/parent_to_many_child_to_one_required/parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';
import type { Contract } from './_fixture/parent_to_many_child_to_one_required/parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import * as sharedKey from './nested_update_many_inside_update.to_many';
import * as compoundParentId from './nested_update_many_inside_update.to_many.compound_parent_id';
import { schemas } from './parent_to_many_child_to_one_required.schemas';
import { describeRelationLinkMatrix } from './relation_link_matrix';

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update, PM to C1!', () => {
  describeRelationLinkMatrix<Contract, CompoundParentContract>(
    schemas,
    [
      ['pm_c1_req: updates the matching children of the parent', sharedKey.updatesMatchingChildren],
      ['pm_c1_req_many_ums', sharedKey.severalUpdateManys],
      ['pm_c1_req_empty_filter', sharedKey.emptyFilter],
      ['pm_c1_req_noop_no_hit', sharedKey.noHit],
      ['pm_c1_req_many_filters', sharedKey.overlappingFilters],
    ],
    [
      [
        'pm_c1_req: updates the matching children of the parent',
        compoundParentId.updatesMatchingChildren,
      ],
      ['pm_c1_req_many_ums', compoundParentId.severalUpdateManys],
      ['pm_c1_req_empty_filter', compoundParentId.emptyFilter],
      ['pm_c1_req_noop_no_hit', compoundParentId.noHit],
      ['pm_c1_req_many_filters', compoundParentId.overlappingFilters],
    ],
  );
});
