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
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import {
  type DefaultRequiredCapabilities,
  defaultRequiredCapabilities,
  type PostgresContractCapabilities,
  type RequiredCapabilities,
  recordDefaultRequiredCapabilities,
  requiredCapabilitiesFor,
} from './contract-capabilities';
import type { ExtensionHandle } from './extension';
import type { RlsEntityHandle } from './rls';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type DatabaseTypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;
type ForeignKeyDefaultsConstraint = ContractInput['foreignKeyDefaults'];
type NamespacesConstraint = readonly string[] | undefined;

/** What the contract build is given beside the target: the aggregate overloads of the adapter, and the capabilities the contract requires. */
type PostgresContributions<Capabilities> = typeof postgresAdapterContractContributions & {
  readonly capabilities: Capabilities;
};

type PostgresResult<
  Required extends RequiredCapabilities,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    PostgresPack,
    {
      readonly databaseTypes?: DatabaseTypes;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly namespaces?: Namespaces;
      readonly adapter: PostgresContributions<PostgresContractCapabilities<Required>>;
      readonly foreignKeyDefaults?: ForeignKeyDefaults;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type PostgresBaseScaffold<
  Required extends RequiredCapabilities,
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
  /**
   * Everything the contract requires of its database and its connection, each capability as its key: `[...postgres18, ...postgresDriver]`, with what the application does not use filtered or left out. The list must not be empty.
   *
   * A contract that leaves it out requires the newest PostgreSQL version's list and the driver's, and `prisma contract emit` warns. That default is a stopgap for contracts written before the list existed: Prisma 8.0 removes it and requires the list.
   */
  readonly requiredCapabilities?: Required;
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
  Required extends RequiredCapabilities,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Required, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: DatabaseTypes;
  readonly models?: Models;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

type PostgresScaffold<
  Required extends RequiredCapabilities,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Required, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: never;
  readonly models?: never;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

/** Defines a PostgreSQL contract. `requiredCapabilities` lists everything it requires of the database and the connection; a contract that leaves it out requires the newest version's list and the driver's, until Prisma 8.0 removes that default and the type parameter's default. */
export function defineContract<
  const Required extends RequiredCapabilities = DefaultRequiredCapabilities,
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  definition: PostgresDefinition<
    Required,
    DatabaseTypes,
    Models,
    Extensions,
    Enums,
    Namespaces,
    ForeignKeyDefaults
  >,
): PostgresResult<
  Required,
  DatabaseTypes,
  Models,
  Extensions,
  Enums,
  Namespaces,
  ForeignKeyDefaults
>;

export function defineContract<
  const Required extends RequiredCapabilities = DefaultRequiredCapabilities,
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  scaffold: PostgresScaffold<Required, Extensions, ScaffoldEnums, Namespaces, ForeignKeyDefaults>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, Extensions>) => {
    readonly databaseTypes?: DatabaseTypes;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<
  Required,
  DatabaseTypes,
  Models,
  Extensions,
  MergeEnums<ScaffoldEnums, FactoryEnums>,
  Namespaces,
  ForeignKeyDefaults
>;

export function defineContract(
  definition: PostgresDefinition<
    RequiredCapabilities,
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
  RequiredCapabilities,
  DatabaseTypesConstraint,
  ModelsConstraint,
  undefined,
  EnumsConstraint,
  NamespacesConstraint,
  ForeignKeyDefaultsConstraint
> {
  const { requiredCapabilities, ...rest } = definition;
  const required = requiredCapabilitiesFor(
    requiredCapabilities === undefined ? defaultRequiredCapabilities : requiredCapabilities,
    'in defineContract',
  );
  const extensions: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    definition.extensions ?? {},
  );
  const dataTypeLookup =
    definition.dataTypeLookup ??
    assembleDataTypeSupport([sqlFamilyPack, postgresPack, ...extensions], () => undefined).support
      .lookup;
  const bound = {
    ...rest,
    adapter: { ...postgresAdapterContractContributions, capabilities: required },
    createNamespace: postgresCreateNamespace,
    codecLookup:
      definition.codecLookup ??
      assemblePostgresCodecRegistryWithBuiltins(extensions, dataTypeLookup),
    dataTypeLookup,
  };
  const contract =
    factory === undefined
      ? buildBoundContract(sqlFamilyPack, postgresPack, bound)
      : buildBoundContract(sqlFamilyPack, postgresPack, bound, factory);
  if (requiredCapabilities === undefined) recordDefaultRequiredCapabilities(contract);
  return contract;
}
