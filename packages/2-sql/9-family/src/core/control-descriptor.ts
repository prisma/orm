import type { DataType } from '@internal/framework-components/codec';
import type { ControlFamilyDescriptor, ControlStack } from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { sqlExpressionRegistration } from '@internal/sql-contract/sql-expression';
import { sqlEmission } from '@internal/sql-contract-emitter';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlFamilyEntityTypes, sqlFamilyPslBlockDescriptors } from './authoring-entity-types';
import { sqlFamilyAuthoringFieldPresets } from './authoring-field-presets';
import { sqlFamilyAuthoringTypes } from './authoring-type-constructors';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';

const sqlFamilyDescribeUnsupportedAttribute: unknown = describeUnsupportedSqlAttribute;

export class SqlFamilyDescriptor
  implements ControlFamilyDescriptor<'sql', SqlControlFamilyInstance>
{
  readonly kind = 'family' as const;
  readonly id = 'sql';
  readonly familyId = 'sql' as const;
  readonly version = '0.0.1';
  readonly emission: EmissionSpi = sqlEmission;
  readonly dataTypes: readonly DataType[] = sqlExpressionRegistration.dataTypes;
  readonly authoring = {
    field: sqlFamilyAuthoringFieldPresets,
    type: sqlFamilyAuthoringTypes,
    entityTypes: sqlFamilyEntityTypes,
    pslBlockDescriptors: sqlFamilyPslBlockDescriptors,
    attributeSpecs: sqlAttributeSpecs,
    dataTypes: sqlExpressionRegistration.authoring.dataTypes,
  } as const;
  readonly pslDiagnostics = {
    describeUnsupportedAttribute: sqlFamilyDescribeUnsupportedAttribute,
  } as const;

  create<TTargetId extends string>(
    stack: ControlStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance(stack);
  }
}
