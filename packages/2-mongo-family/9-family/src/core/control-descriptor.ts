import type { AuthoringAttributeSpecContributions } from '@internal/framework-components/authoring';
import type { ControlFamilyDescriptor, ControlStack } from '@internal/framework-components/control';
import { mongoAttributeSpecs } from '@internal/mongo-contract-psl';
import { mongoEmission } from '@internal/mongo-emitter';
import { mongoFamilyEntityTypes, mongoFamilyPslBlockDescriptors } from './authoring-entity-types';
import { createMongoFamilyInstance, type MongoControlFamilyInstance } from './control-instance';

const mongoFamilyAttributeSpecs: AuthoringAttributeSpecContributions = mongoAttributeSpecs;

class MongoFamilyDescriptor
  implements ControlFamilyDescriptor<'mongo', MongoControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'mongo';
  readonly familyId = 'mongo' as const;
  readonly version = '0.0.1';
  readonly emission = mongoEmission;
  readonly authoring = {
    entityTypes: mongoFamilyEntityTypes,
    pslBlockDescriptors: mongoFamilyPslBlockDescriptors,
    attributeSpecs: mongoFamilyAttributeSpecs,
  } as const;

  create<TTargetId extends string>(
    stack: ControlStack<'mongo', TTargetId>,
  ): MongoControlFamilyInstance {
    return createMongoFamilyInstance(stack);
  }
}

export const mongoFamilyDescriptor: ControlFamilyDescriptor<'mongo', MongoControlFamilyInstance> =
  new MongoFamilyDescriptor();
