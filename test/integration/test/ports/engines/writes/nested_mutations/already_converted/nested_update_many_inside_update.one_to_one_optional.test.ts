import { describe } from 'vitest';
import type { Contract as CompoundParentContract } from './_fixture/one_to_one_optional/parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';
import type { Contract } from './_fixture/one_to_one_optional/parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import * as sharedKey from './nested_update_many_inside_update.to_one';
import * as compoundParentId from './nested_update_many_inside_update.to_one.compound_parent_id';
import { schemas } from './one_to_one_optional.schemas';
import { describeRelationLinkMatrix } from './relation_link_matrix';

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update, P1 to C1', () => {
  describeRelationLinkMatrix<Contract, CompoundParentContract>(
    schemas,
    [['one2n_rel_error_nested_um', sharedKey.rejectsUpdateMany]],
    [['one2n_rel_error_nested_um', compoundParentId.rejectsUpdateMany]],
  );
});
