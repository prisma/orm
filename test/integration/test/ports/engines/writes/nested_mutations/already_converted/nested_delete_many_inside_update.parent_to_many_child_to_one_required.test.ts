import { describe } from 'vitest';
import type { Contract as CompoundParentContract } from './_fixture/parent_to_many_child_to_one_required/parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';
import type { Contract } from './_fixture/parent_to_many_child_to_one_required/parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import * as sharedKey from './nested_delete_many_inside_update.to_many';
import * as compoundParentId from './nested_delete_many_inside_update.to_many.compound_parent_id';
import { schemas } from './parent_to_many_child_to_one_required.schemas';
import { describeRelationLinkMatrix } from './relation_link_matrix';

describe('ports/engines/writes/nested_mutations/already_converted/nested_delete_many_inside_update, PM to C1!', () => {
  describeRelationLinkMatrix<Contract, CompoundParentContract>(
    schemas,
    [
      ['pm_c1_req', sharedKey.deletesMatchingChildren],
      ['pm_c1_req_many_delete_manys', sharedKey.severalDeleteManys],
      ['pm_c1_req_work_empty_filter', sharedKey.emptyFilter],
      ['pm_c1_req_no_change_if_no_hit', sharedKey.noHit],
    ],
    [
      ['pm_c1_req', compoundParentId.deletesMatchingChildren],
      ['pm_c1_req_many_delete_manys', compoundParentId.severalDeleteManys],
      ['pm_c1_req_work_empty_filter', compoundParentId.emptyFilter],
      ['pm_c1_req_no_change_if_no_hit', compoundParentId.noHit],
    ],
  );
});
