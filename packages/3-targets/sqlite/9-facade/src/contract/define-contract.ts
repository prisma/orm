import { sqliteAdapterContractContributions } from '@internal/adapter-sqlite/adapter';
import sqlFamilyPack from '@internal/family-sql/pack';
import { assembleDataTypeSupport } from '@internal/framework-components/authoring';
import type {
  CodecLookupWithDescriptors,
  DataTypeLookup,
} from '@internal/framework-components/codec';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
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
import { assembleSqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import sqlitePack from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';

type SqlFamily = typeof sqlFamilyPack;
type SqlitePack = typeof sqlitePack;

type DatabaseTypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;
type ForeignKeyDefaultsConstraint = ContractInput['foreignKeyDefaults'];

/** What the adapter this contract runs with adds to it: its capabilities and its aggregate overloads, as `prisma contract emit` adds them. */
type SqliteAdapter = typeof sqliteAdapterContractContributions;

const adapter: SqliteAdapter = sqliteAdapterContractContributions;

type SqliteResult<
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    SqlitePack,
    {
      readonly databaseTypes?: DatabaseTypes;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly adapter: SqliteAdapter;
      readonly foreignKeyDefaults?: ForeignKeyDefaults;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type SqliteBaseScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = Omit<
  ContractInput<SqlFamily, SqlitePack, Record<never, never>, Record<never, never>, Extensions>,
  | 'family'
  | 'target'
  | 'adapter'
  | 'foreignKeyDefaults'
  | 'databaseTypes'
  | 'models'
  | 'enums'
  | 'namespaces'
  | 'createNamespace'
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
};

type SqliteDefinition<
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = SqliteBaseScaffold<Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: DatabaseTypes;
  readonly models?: Models;
  readonly enums?: Enums;
};

type SqliteScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = SqliteBaseScaffold<Extensions, ForeignKeyDefaults> & {
  readonly enums?: Enums;
};

const target: TargetPackRef<'sql', 'sqlite'> = sqlitePack;

export function defineContract<
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  definition: SqliteDefinition<DatabaseTypes, Models, Extensions, Enums, ForeignKeyDefaults>,
): SqliteResult<DatabaseTypes, Models, Extensions, Enums, ForeignKeyDefaults>;

export function defineContract<
  const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
  const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
>(
  scaffold: SqliteScaffold<Extensions, ScaffoldEnums, ForeignKeyDefaults>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlitePack, Extensions>) => {
    readonly databaseTypes?: DatabaseTypes;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): SqliteResult<
  DatabaseTypes,
  Models,
  Extensions,
  MergeEnums<ScaffoldEnums, FactoryEnums>,
  ForeignKeyDefaults
>;

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts at this layer.
export function defineContract(
  definition: SqliteDefinition<
    DatabaseTypesConstraint,
    ModelsConstraint,
    undefined,
    EnumsConstraint,
    ForeignKeyDefaultsConstraint
  >,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlitePack, undefined>) => {
    readonly databaseTypes?: DatabaseTypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): SqliteResult<
  DatabaseTypesConstraint,
  ModelsConstraint,
  undefined,
  EnumsConstraint,
  ForeignKeyDefaultsConstraint
> {
  const extensionPacks: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    definition.extensions ?? {},
  );
  const bound = {
    ...definition,
    adapter,
    createNamespace: sqliteCreateNamespace,
    codecLookup: definition.codecLookup ?? assembleSqliteCodecRegistry(target, extensionPacks),
    dataTypeLookup:
      definition.dataTypeLookup ??
      assembleDataTypeSupport([sqlFamilyPack, target, ...extensionPacks], () => undefined).support
        .lookup,
  };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, sqlitePack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, sqlitePack, bound);
}
