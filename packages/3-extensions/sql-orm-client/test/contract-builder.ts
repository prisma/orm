import sqlFamilyPack from '@internal/family-sql/pack';
import {
  assembleDataTypes,
  type CodecLookupWithDescriptors,
  type DataTypeLookup,
} from '@internal/framework-components/codec';
import type {
  ComponentMetadata,
  ExtensionPackRef,
} from '@internal/framework-components/components';
import type { StorageTypeInstance } from '@internal/sql-contract/types';
import {
  buildBoundContract,
  type ComposedAuthoringHelpers,
  type ContractInput,
  type EnumTypeHandle,
  field,
  type MergeEnums,
  type ModelLike,
  model,
  rel,
  type ScalarFieldBuilder,
} from '@internal/sql-contract-ts/contract-builder';
import { assemblePostgresCodecRegistryWithBuiltins } from '@internal/target-postgres/codecs';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';

// Postgres-bound `defineContract` for sql-orm-client tests. This mirrors
// `@internal/postgres/contract-builder`, but sql-orm-client cannot depend on
// `@internal/postgres` (that package re-exports sql-orm-client, so the
// dependency would be a build cycle). Tests therefore bind the generic SQL
// contract-builder to the SQL family + Postgres target packs directly, exactly
// as the postgres package does.

export type { ScalarFieldBuilder };
export { field, model, rel };

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, StorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;

type PostgresResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    PostgresPack,
    {
      readonly createNamespace: typeof postgresCreateNamespace;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
    }
  >
>;

type PostgresBaseScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<SqlFamily, PostgresPack, Record<never, never>, Record<never, never>, Extensions>,
  | 'family'
  | 'target'
  | 'types'
  | 'models'
  | 'enums'
  | 'createNamespace'
  | 'codecLookup'
  | 'dataTypeLookup'
>;

type PostgresDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = PostgresBaseScaffold<Extensions> & {
  readonly types?: Types;
  readonly models?: Models;
  readonly enums?: Enums;
};

type PostgresScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
> = PostgresBaseScaffold<Extensions> & {
  readonly types?: never;
  readonly models?: never;
  readonly enums?: Enums;
};

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
>(
  definition: PostgresDefinition<Types, Models, Extensions, Enums>,
): PostgresResult<Types, Models, Extensions, Enums>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
>(
  scaffold: PostgresScaffold<Extensions, ScaffoldEnums>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<Types, Models, Extensions, MergeEnums<ScaffoldEnums, FactoryEnums>>;

export function defineContract(
  definition: PostgresDefinition<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): PostgresResult<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint> {
  const extensionPacks: readonly Pick<ComponentMetadata, 'types' | 'dataTypes'>[] = Object.values(
    definition.extensions ?? {},
  );
  const dataTypeLookup = assembleDataTypes([postgresPack, ...extensionPacks]).lookup;
  const bound = {
    ...definition,
    createNamespace: postgresCreateNamespace,
    codecLookup: assemblePostgresCodecRegistryWithBuiltins(extensionPacks, dataTypeLookup),
    dataTypeLookup,
  };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, postgresPack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, postgresPack, bound);
}
