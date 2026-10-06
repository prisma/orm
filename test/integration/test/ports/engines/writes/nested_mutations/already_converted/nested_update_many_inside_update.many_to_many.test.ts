import { describe } from 'vitest';
import type { Contract as CompoundParentContract } from './_fixture/parent_to_many_child_to_one_required/parent_id_compound__child_id_compound__child_references_parent_compound_id/generated/contract';
import type { Contract } from './_fixture/parent_to_many_child_to_one_required/parent_id_simple__child_id_simple__child_references_parent_id/generated/contract';
import { schemas } from './many_to_many.schemas';
import * as sharedKey from './nested_update_many_inside_update.to_many';
import { describeRelationLinkMatrix } from './relation_link_matrix';

describe('ports/engines/writes/nested_mutations/already_converted/nested_update_many_inside_update, PM to CM', () => {
  describeRelationLinkMatrix<Contract, CompoundParentContract>(
    schemas,
    [['pm_cm: updates the matching children of the parent', sharedKey.updatesMatchingChildren]],
    [],
  );
});
