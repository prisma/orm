import mongoFamilyPack from '@internal/family-mongo/pack';
import { createGeneratorHelpers } from '@internal/framework-components/components';
import type { ContractAuthoringHelpers } from '@internal/mongo-contract-ts/contract-builder';
import mongoTargetPack from '@internal/target-mongo/pack';

/**
 * The generator function calls of the `defineContract` callback for MongoDB, built from the same family and target packs, for `.onCreate(...)` and `.onUpdate(...)`. MongoDB declares one generator function, so this holds `gen.now()` only.
 */
export const gen: ContractAuthoringHelpers<typeof mongoFamilyPack, typeof mongoTargetPack>['gen'] =
  createGeneratorHelpers([mongoFamilyPack, mongoTargetPack]);
