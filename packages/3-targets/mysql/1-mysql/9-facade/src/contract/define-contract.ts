import { mysqlAdapterContractContributions } from '@internal/adapter-mysql/adapter';
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
  CapabilityContributor,
  ComposedAuthoringHelpers,
  ContractInput,
  EnumTypeHandle,
  MergeEnums,
  ModelLike,
} from '@internal/sql-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import { assembleMysqlCodecRegistry } from '@internal/target-mysql/codecs';
import mysqlPack from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { blindCast } from '@internal/utils/casts';

type SqlFamily = typeof sqlFamilyPack;
type SqlTargetPack = TargetPackRef<'sql', string>;

type DatabaseTypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;
type ForeignKeyDefaultsConstraint = ContractInput['foreignKeyDefaults'];

type MysqlResult<
  Pack extends SqlTargetPack,
  Adapter extends CapabilityContributor,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    Pack,
    {
      readonly databaseTypes?: DatabaseTypes;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly adapter: Adapter;
      readonly foreignKeyDefaults?: ForeignKeyDefaults;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type MysqlBaseScaffold<
  Pack extends SqlTargetPack,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
> = Omit<
  ContractInput<SqlFamily, Pack, Record<never, never>, Record<never, never>, Extensions>,
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

type MysqlDefinition<
  Pack extends SqlTargetPack,
  DatabaseTypes extends DatabaseTypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = MysqlBaseScaffold<Pack, Extensions, ForeignKeyDefaults> & {
  readonly databaseTypes?: DatabaseTypes;
  readonly models?: Models;
  readonly enums?: Enums;
};

type MysqlScaffold<
  Pack extends SqlTargetPack,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  ForeignKeyDefaults extends ForeignKeyDefaultsConstraint,
> = MysqlBaseScaffold<Pack, Extensions, ForeignKeyDefaults> & {
  readonly enums?: Enums;
};

/** The `defineContract` of MySQL, or of a target that extends it. */
export interface MysqlDefineContract<
  Pack extends SqlTargetPack,
  Adapter extends CapabilityContributor,
> {
  <
    const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
    const Models extends ModelsConstraint = Record<never, never>,
    const Extensions extends
      | Record<string, ExtensionPackRef<'sql', string>>
      | undefined = undefined,
    const Enums extends EnumsConstraint = Record<never, never>,
    const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
  >(
    definition: MysqlDefinition<Pack, DatabaseTypes, Models, Extensions, Enums, ForeignKeyDefaults>,
  ): MysqlResult<Pack, Adapter, DatabaseTypes, Models, Extensions, Enums, ForeignKeyDefaults>;
  <
    const DatabaseTypes extends DatabaseTypesConstraint = Record<never, never>,
    const Models extends ModelsConstraint = Record<never, never>,
    const Extensions extends
      | Record<string, ExtensionPackRef<'sql', string>>
      | undefined = undefined,
    const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
    const FactoryEnums extends EnumsConstraint = Record<never, never>,
    const ForeignKeyDefaults extends ForeignKeyDefaultsConstraint = undefined,
  >(
    scaffold: MysqlScaffold<Pack, Extensions, ScaffoldEnums, ForeignKeyDefaults>,
    factory: (helpers: ComposedAuthoringHelpers<SqlFamily, Pack, Extensions>) => {
      readonly databaseTypes?: DatabaseTypes;
      readonly models?: Models;
      readonly enums?: FactoryEnums;
    },
  ): MysqlResult<
    Pack,
    Adapter,
    DatabaseTypes,
    Models,
    Extensions,
    MergeEnums<ScaffoldEnums, FactoryEnums>,
    ForeignKeyDefaults
  >;
}

export interface MysqlDefineContractOptions<
  Pack extends SqlTargetPack,
  Adapter extends CapabilityContributor,
> {
  /** The target's pack ref, whose id the contract carries. */
  readonly target: Pack;
  /** What the target's adapter adds to every contract. */
  readonly adapter: Adapter;
}

/** Builds the `defineContract` of MySQL, or of a target that extends it, for that target's pack and adapter. */
export function createMysqlDefineContract<
  const Pack extends SqlTargetPack,
  const Adapter extends CapabilityContributor,
>(options: MysqlDefineContractOptions<Pack, Adapter>): MysqlDefineContract<Pack, Adapter> {
  const { target, adapter } = options;
  function defineContract(
    definition: MysqlDefinition<
      SqlTargetPack,
      DatabaseTypesConstraint,
      ModelsConstraint,
      undefined,
      EnumsConstraint,
      ForeignKeyDefaultsConstraint
    >,
    factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlTargetPack, undefined>) => {
      readonly databaseTypes?: DatabaseTypesConstraint;
      readonly models?: ModelsConstraint;
      readonly enums?: EnumsConstraint;
    },
  ) {
    const extensionPacks: readonly ExtensionPackRef<'sql', string>[] = Object.values(
      definition.extensions ?? {},
    );
    const bound = {
      ...definition,
      adapter,
      createNamespace: mysqlCreateNamespace,
      codecLookup: definition.codecLookup ?? assembleMysqlCodecRegistry(target, extensionPacks),
      dataTypeLookup:
        definition.dataTypeLookup ??
        assembleDataTypeSupport([sqlFamilyPack, target, ...extensionPacks], () => undefined).support
          .lookup,
    };
    if (factory !== undefined) {
      return buildBoundContract(sqlFamilyPack, target, bound, factory);
    }
    return buildBoundContract(sqlFamilyPack, target, bound);
  }
  return blindCast<
    MysqlDefineContract<Pack, Adapter>,
    "the implementation passes target and adapter to buildBoundContract unchanged, so its result is the one the overloads name for Pack and Adapter; TypeScript cannot check overloads that name the outer function's type parameters against it"
  >(defineContract);
}

/** MySQL's `defineContract`. */
export const defineContract: MysqlDefineContract<
  typeof mysqlPack,
  typeof mysqlAdapterContractContributions
> = createMysqlDefineContract({ target: mysqlPack, adapter: mysqlAdapterContractContributions });
