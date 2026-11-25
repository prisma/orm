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
  CapabilitySet,
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
  type CapabilitiesByVersion,
  postgresCapabilitiesByVersion,
} from '@internal/target-postgres/server-version';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import {
  type ContractCapabilities,
  contractCapabilitiesFor,
  type DefaultConnectionCapabilities,
  supportedVersionsText,
} from './contract-capabilities';
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

/** What the contract build is given beside the target: the aggregate overloads of the adapter, and the capabilities the contract requires. */
type PostgresContributions<Capabilities> = typeof postgresAdapterContractContributions & {
  readonly capabilities: Capabilities;
};

type PostgresResult<
  Table extends CapabilitiesByVersion,
  Version extends keyof Table & number,
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
    PostgresPack,
    {
      readonly databaseTypes?: DatabaseTypes;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly namespaces?: Namespaces;
      readonly adapter: PostgresContributions<ContractCapabilities<Table, Version, Capabilities>>;
      readonly foreignKeyDefaults?: ForeignKeyDefaults;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type PostgresBaseScaffold<
  Table extends CapabilitiesByVersion,
  Version extends keyof Table & number,
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
   * The capabilities the connection provides, one set per component, merged over the version's in order: a later set's flag replaces an earlier one's, and `false` turns a flag off. Defaults to those of the adapter and the driver the client runs with; a list given here replaces the default.
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
  Table extends CapabilitiesByVersion,
  Version extends keyof Table & number,
  Capabilities extends ConnectionCapabilitiesConstraint,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Table, Version, Capabilities, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: DatabaseTypes;
  readonly models?: Models;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

type PostgresScaffold<
  Table extends CapabilitiesByVersion,
  Version extends keyof Table & number,
  Capabilities extends ConnectionCapabilitiesConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Table, Version, Capabilities, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: never;
  readonly models?: never;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

/** The PostgreSQL `defineContract`, whose version selects a row of `Table`. */
export interface PostgresDefineContract<Table extends CapabilitiesByVersion> {
  <
    const Version extends keyof Table & number,
    const Capabilities extends ConnectionCapabilitiesConstraint = DefaultConnectionCapabilities,
    const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
    const Models extends ModelsConstraint = Record<never, never>,
    const Extensions extends
      | Record<string, ExtensionPackRef<'sql', string>>
      | undefined = undefined,
    const Enums extends EnumsConstraint = Record<never, never>,
    const Namespaces extends NamespacesConstraint = undefined,
    const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
  >(
    definition: PostgresDefinition<
      Table,
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
    Table,
    Version,
    Capabilities,
    DatabaseTypes,
    Models,
    Extensions,
    Enums,
    Namespaces,
    ForeignKeyDefaults
  >;
  <
    const Version extends keyof Table & number,
    const Capabilities extends ConnectionCapabilitiesConstraint = DefaultConnectionCapabilities,
    const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
    const Models extends ModelsConstraint = Record<never, never>,
    const Extensions extends
      | Record<string, ExtensionPackRef<'sql', string>>
      | undefined = undefined,
    const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
    const FactoryEnums extends EnumsConstraint = Record<never, never>,
    const Namespaces extends NamespacesConstraint = undefined,
    const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
  >(
    scaffold: PostgresScaffold<
      Table,
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
    Table,
    Version,
    Capabilities,
    DatabaseTypes,
    Models,
    Extensions,
    MergeEnums<ScaffoldEnums, FactoryEnums>,
    Namespaces,
    ForeignKeyDefaults
  >;
}

type AnyPostgresDefinition = PostgresDefinition<
  CapabilitiesByVersion,
  number,
  ConnectionCapabilitiesConstraint,
  DatabaseTypesConstraint,
  ModelsConstraint,
  undefined,
  EnumsConstraint,
  NamespacesConstraint,
  ForeignKeyDefaultsConstraint
>;

/** The PostgreSQL `defineContract` for `table`. The facade exports it for the table Prisma 8 ships; tests pass a table whose rows differ. */
export function defineContractFor<const Table extends CapabilitiesByVersion>(
  table: Table,
): PostgresDefineContract<Table> {
  function defineContract(
    definition: AnyPostgresDefinition,
    factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
      readonly databaseTypes?: DatabaseTypesConstraint;
      readonly models?: ModelsConstraint;
      readonly enums?: EnumsConstraint;
    },
  ) {
    const { version, capabilities, ...rest } = definition;
    const required = contractCapabilitiesFor(
      table,
      capabilities === undefined ? { version } : { version, capabilities },
      `State the PostgreSQL version your database runs in defineContract, for example defineContract({ version: 18, ... }). ${supportedVersionsText}`,
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
    if (factory !== undefined) {
      return buildBoundContract(sqlFamilyPack, postgresPack, bound, factory);
    }
    return buildBoundContract(sqlFamilyPack, postgresPack, bound);
  }
  return blindCast<
    PostgresDefineContract<Table>,
    'the implementation passes the capabilities its overloads name for Table to buildBoundContract; TypeScript cannot check overloads that name the outer type parameter against it'
  >(defineContract);
}

/** Defines a PostgreSQL contract. `version` selects the capabilities the contract requires. */
export const defineContract: PostgresDefineContract<typeof postgresCapabilitiesByVersion> =
  defineContractFor(postgresCapabilitiesByVersion);
