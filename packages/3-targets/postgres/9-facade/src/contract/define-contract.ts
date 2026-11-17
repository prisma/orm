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
import type { ExtensionHandle } from './extension';
import type { RlsEntityHandle } from './rls';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type DatabaseTypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;
type ForeignKeyDefaultsConstraint = ContractInput['foreignKeyDefaults'];
type NamespacesConstraint = readonly string[] | undefined;

/** What the adapter this contract runs with adds to it: its capabilities and its aggregate overloads, as `prisma contract emit` adds them. */
type PostgresAdapter = typeof postgresAdapterContractContributions;

const adapter: PostgresAdapter = postgresAdapterContractContributions;

type PostgresResult<
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
      readonly adapter: PostgresAdapter;
      readonly foreignKeyDefaults?: ForeignKeyDefaults;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type PostgresBaseScaffold<
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
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: DatabaseTypes;
  readonly models?: Models;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

type PostgresScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = PostgresBaseScaffold<Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: never;
  readonly models?: never;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

export function defineContract<
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  definition: PostgresDefinition<
    DatabaseTypes,
    Models,
    Extensions,
    Enums,
    Namespaces,
    ForeignKeyDefaults
  >,
): PostgresResult<DatabaseTypes, Models, Extensions, Enums, Namespaces, ForeignKeyDefaults>;

export function defineContract<
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  scaffold: PostgresScaffold<Extensions, ScaffoldEnums, Namespaces, ForeignKeyDefaults>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, Extensions>) => {
    readonly databaseTypes?: DatabaseTypes;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<
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
  DatabaseTypesConstraint,
  ModelsConstraint,
  undefined,
  EnumsConstraint,
  NamespacesConstraint,
  ForeignKeyDefaultsConstraint
> {
  const extensions: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    definition.extensions ?? {},
  );
  const dataTypeLookup =
    definition.dataTypeLookup ??
    assembleDataTypeSupport([sqlFamilyPack, postgresPack, ...extensions], () => undefined).support
      .lookup;
  const bound = {
    ...definition,
    adapter,
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
