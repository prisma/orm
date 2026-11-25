import { postgresAdapterContractContributions } from '@internal/adapter-postgres/adapter';
import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleDataTypeSupport } from '@internal/framework-components/authoring';
import type {
  CodecLookupWithDescriptors,
  DataTypeLookup,
} from '@internal/framework-components/codec';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import type {
  AuthoredStorageTypeInstance,
  SqlNamespaceBase,
  SqlNamespaceInput,
} from '@internal/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
  EnumTypeHandle,
  MergeEnums,
  ModelLike,
} from '@internal/sql-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import {
  type PostgresServerVersion,
  postgresServerVersions,
} from '@internal/target-postgres/server-version';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import {
  type CapabilitySet,
  capabilitiesForVersion,
  type DefaultConnectionCapabilities,
  defaultConnectionCapabilities,
  type MergeCapabilitySets,
  mergeCapabilitySets,
  type PostgresTargetWith,
  type PostgresVersionCapabilities,
  postgresTargetWith,
} from './database-version';
import type { ExtensionHandle } from './extension';
import type { RlsEntityHandle } from './rls';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;
type ConnectionCapabilitiesConstraint = readonly CapabilitySet[];

type DatabaseTypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;
type ForeignKeyDefaultsConstraint = ContractInput['foreignKeyDefaults'];
type NamespacesConstraint = readonly string[] | undefined;

/** What the connection this contract runs over adds to it: the aggregate overloads of its adapter, and the capabilities of its `capabilities` list. */
type PostgresConnection<Capabilities extends ConnectionCapabilitiesConstraint> =
  typeof postgresAdapterContractContributions & {
    readonly capabilities: MergeCapabilitySets<Capabilities>;
  };

type PostgresResult<
  Version extends PostgresServerVersion,
  Capabilities extends ConnectionCapabilitiesConstraint,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    PostgresTargetWith<PostgresVersionCapabilities<Version>>,
    {
      readonly databaseTypes?: DatabaseTypes;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly namespaces?: Namespaces;
      readonly adapter: PostgresConnection<Capabilities>;
      readonly foreignKeyDefaults?: ForeignKeyDefaults;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type PostgresBaseScaffold<
  Version extends PostgresServerVersion,
  Capabilities extends ConnectionCapabilitiesConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = Omit<
  ContractInput<SqlFamily, PostgresPack, Record<never, never>, Record<never, never>, Extensions>,
  | 'family'
  | 'target'
  | 'adapter'
  | 'foreignKeyDefaults'
  | 'databaseTypes'
  | 'models'
  | 'enums'
  | 'namespaces'
  | 'createNamespace'
  | 'entities'
  | 'codecLookup'
  | 'dataTypeLookup'
> & {
  /** The PostgreSQL version the database runs. The contract requires the capabilities that version provides. */
  readonly version: Version;
  /**
   * The capabilities the connection provides, one set per component, merged in order. Defaults to those of the adapter and the driver the client runs with; a list given here replaces the default.
   */
  readonly capabilities?: Capabilities;
  /** Contract-wide defaults for foreign keys' `constraint` and `index`. */
  readonly foreignKeyDefaults?: ForeignKeyDefaults;
  /** Overrides the codecs of the target and the extensions. */
  readonly codecLookup?: CodecLookupWithDescriptors;
  /**
   * Replaces the data types the contract is built with, which are otherwise those of the family, the target and the extensions. Only for an extension's own contract space, which uses the data types of a pack it does not list as an extension. Helper arguments are always read with the packs' data types.
   */
  readonly dataTypeLookup?: DataTypeLookup;
  /**
   * RLS handles (`policy*`, `rlsEnabled`, `role`) and `extension` handles, lowered by the generic
   * contract build through the postgres pack's entity-handle hook —
   * mirroring the PSL `policy_*` / `@@rls` lowering key-for-key and
   * wire-name-for-wire-name. This wrapper only narrows the element type;
   * it contains no entity-kind logic.
   */
  readonly entities?: readonly (RlsEntityHandle | ExtensionHandle)[];
};

type PostgresDefinition<
  Version extends PostgresServerVersion,
  Capabilities extends ConnectionCapabilitiesConstraint,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Version, Capabilities, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: DatabaseTypes;
  readonly models?: Models;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

type PostgresScaffold<
  Version extends PostgresServerVersion,
  Capabilities extends ConnectionCapabilitiesConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Version, Capabilities, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: never;
  readonly models?: never;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

export function defineContract<
  const Version extends PostgresServerVersion,
  const Capabilities extends ConnectionCapabilitiesConstraint = DefaultConnectionCapabilities,
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  definition: PostgresDefinition<
    Version,
    Capabilities,
    DatabaseTypes,
    Models,
    Extensions,
    Enums,
    Namespaces,
    ForeignKeyDefaults
  >,
): PostgresResult<
  Version,
  Capabilities,
  DatabaseTypes,
  Models,
  Extensions,
  Enums,
  Namespaces,
  ForeignKeyDefaults
>;

export function defineContract<
  const Version extends PostgresServerVersion,
  const Capabilities extends ConnectionCapabilitiesConstraint = DefaultConnectionCapabilities,
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  scaffold: PostgresScaffold<
    Version,
    Capabilities,
    Extensions,
    ScaffoldEnums,
    Namespaces,
    ForeignKeyDefaults
  >,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, Extensions>) => {
    readonly databaseTypes?: DatabaseTypes;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<
  Version,
  Capabilities,
  DatabaseTypes,
  Models,
  Extensions,
  MergeEnums<ScaffoldEnums, FactoryEnums>,
  Namespaces,
  ForeignKeyDefaults
>;

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts and zero entity-kind logic at this layer: the generic
// build lowers `entities` through the pack-registered entity-handle hook.
export function defineContract(
  definition: PostgresDefinition<
    PostgresServerVersion,
    ConnectionCapabilitiesConstraint,
    DatabaseTypesConstraint,
    ModelsConstraint,
    undefined,
    EnumsConstraint,
    NamespacesConstraint,
    ForeignKeyDefaultsConstraint
  >,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly databaseTypes?: DatabaseTypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): PostgresResult<
  PostgresServerVersion,
  ConnectionCapabilitiesConstraint,
  DatabaseTypesConstraint,
  ModelsConstraint,
  undefined,
  EnumsConstraint,
  NamespacesConstraint,
  ForeignKeyDefaultsConstraint
> {
  const { version, capabilities, ...rest } = definition;
  const target = postgresTargetWith(capabilitiesForVersion(postgresServerVersions, version));
  const extensions: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    definition.extensions ?? {},
  );
  const dataTypeLookup =
    definition.dataTypeLookup ??
    assembleDataTypeSupport([sqlFamilyPack, postgresPack, ...extensions], () => undefined).support
      .lookup;
  const bound = {
    ...rest,
    adapter: {
      ...postgresAdapterContractContributions,
      capabilities: mergeCapabilitySets(capabilities ?? defaultConnectionCapabilities),
    },
    createNamespace: postgresCreateNamespace,
    codecLookup:
      definition.codecLookup ??
      assemblePostgresCodecRegistryWithBuiltins(extensions, dataTypeLookup),
    dataTypeLookup,
  };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, target, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, target, bound);
}
