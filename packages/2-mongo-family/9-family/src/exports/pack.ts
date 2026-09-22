import type { AuthoringAttributeSpecContributions } from '@internal/framework-components/authoring';
import type { FamilyPackRef } from '@internal/framework-components/components';
import { mongoAttributeSpecs } from '@internal/mongo-contract-psl';
import {
  mongoFamilyEntityTypes,
  mongoFamilyPslBlockDescriptors,
} from '../core/authoring-entity-types';

const mongoFamilyAttributeSpecs: AuthoringAttributeSpecContributions = mongoAttributeSpecs;

const mongoFamilyPack = {
  kind: 'family',
  id: 'mongo',
  familyId: 'mongo',
  version: '0.0.1',
  authoring: {
    entityTypes: mongoFamilyEntityTypes,
    pslBlockDescriptors: mongoFamilyPslBlockDescriptors,
    attributeSpecs: mongoFamilyAttributeSpecs,
  },
} as const satisfies FamilyPackRef<'mongo'>;

export default mongoFamilyPack;
export { mongoFamilyEntityTypes, mongoFamilyPslBlockDescriptors };
