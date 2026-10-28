import type { DataType } from '@internal/framework-components/codec';
import type { ControlFamilyDescriptor, ControlStack } from '@internal/framework-components/control';
import type { EmissionSpi } from '@internal/framework-components/emission';
import { sqlCodecColumnLength } from '@internal/sql-contract/data-type';
import { sqlExpressionRegistration } from '@internal/sql-contract/sql-expression';
import { sqlEmission } from '@internal/sql-contract-emitter';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { describeUnresolvedSqlType } from '@internal/sql-contract-psl/diagnostics';
import { sqlFamilyEntityTypes, sqlFamilyPslBlockDescriptors } from './authoring-entity-types';
import { sqlFamilyAuthoringTypes } from './authoring-types';
import { createSqlFamilyInstance, type SqlControlFamilyInstance } from './control-instance';
import { sqlFamilyGeneratorDescriptors, sqlFamilyGeneratorFunctions } from './generator-functions';

const sqlFamilyDescribeUnsupportedAttribute: unknown = describeUnsupportedSqlAttribute;
const sqlFamilyDescribeUnresolvedType: unknown = describeUnresolvedSqlType;

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
    type: sqlFamilyAuthoringTypes,
    entityTypes: sqlFamilyEntityTypes,
    pslBlockDescriptors: sqlFamilyPslBlockDescriptors,
    attributeSpecs: sqlAttributeSpecs,
    dataTypes: sqlExpressionRegistration.authoring.dataTypes,
  } as const;
  readonly generatorFunctions = sqlFamilyGeneratorFunctions;
  readonly controlMutationDefaults = {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: sqlFamilyGeneratorDescriptors,
  };
  readonly fieldLength: NonNullable<ControlFamilyDescriptor<'sql'>['fieldLength']> = (
    { codecId, typeParams },
    dataTypes,
  ) => sqlCodecColumnLength(dataTypes, codecId, typeParams);
  readonly pslDiagnostics = {
    describeUnsupportedAttribute: sqlFamilyDescribeUnsupportedAttribute,
    describeUnresolvedType: sqlFamilyDescribeUnresolvedType,
  } as const;

  create<TTargetId extends string>(
    stack: ControlStack<'sql', TTargetId>,
  ): SqlControlFamilyInstance {
    return createSqlFamilyInstance(stack);
  }
}
