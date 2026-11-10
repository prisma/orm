import type { EntityKindDescriptor } from '@internal/framework-components/ir';
import { PostgresExtension, type PostgresExtensionInput } from './postgres-extension';
import { PostgresNativeEnum, type PostgresNativeEnumInput } from './postgres-native-enum';
import { PostgresRlsEnablement, type PostgresRlsEnablementInput } from './postgres-rls-enablement';
import { PostgresRlsPolicy } from './postgres-rls-policy';
import { PostgresRole, type PostgresRoleInput } from './postgres-role';
import {
  PostgresExtensionSchema,
  PostgresNativeEnumSchema,
  PostgresRlsEnablementSchema,
  PostgresRlsPolicySchema,
  PostgresRoleSchema,
} from './postgres-validators';
import { policyInputFromSerialized, type SerializedRlsPolicy } from './serialized-rls-policy';

export const policyEntityKind: EntityKindDescriptor<SerializedRlsPolicy, PostgresRlsPolicy> = {
  kind: 'policy',
  schema: PostgresRlsPolicySchema,
  construct: (input) => new PostgresRlsPolicy(policyInputFromSerialized(input)),
};

export const roleEntityKind: EntityKindDescriptor<PostgresRoleInput, PostgresRole> = {
  kind: 'role',
  schema: PostgresRoleSchema,
  construct: (input) => new PostgresRole(input),
};

export const rlsEnablementEntityKind: EntityKindDescriptor<
  PostgresRlsEnablementInput,
  PostgresRlsEnablement
> = {
  kind: 'rls',
  schema: PostgresRlsEnablementSchema,
  construct: (input) => new PostgresRlsEnablement(input),
};

export const nativeEnumEntityKind: EntityKindDescriptor<
  PostgresNativeEnumInput,
  PostgresNativeEnum
> = {
  kind: 'native_enum',
  schema: PostgresNativeEnumSchema,
  construct: (input) => new PostgresNativeEnum(input),
};

export const extensionEntityKind: EntityKindDescriptor<PostgresExtensionInput, PostgresExtension> =
  {
    kind: 'extension',
    schema: PostgresExtensionSchema,
    construct: (input) => new PostgresExtension(input),
  };
