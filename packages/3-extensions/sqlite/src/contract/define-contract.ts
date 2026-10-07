import sqlFamilyPack from '@internal/family-sql/pack';
import {
  assembleDataTypes,
  type CodecLookupWithDescriptors,
  type DataTypeLookup,
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
  ModelLike,
} from '@internal/sql-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import { assembleSqliteCodecRegistry } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePack from '@internal/target-sqlite/pack';

type SqlFamily = typeof sqlFamilyPack;
type SqlitePack = typeof sqlitePack;

type TypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;

type SqliteResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    SqlitePack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
    }
  >
>;

type SqliteBaseScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<SqlFamily, SqlitePack, Record<never, never>, Record<never, never>, Extensions>,
  'family' | 'target' | 'types' | 'models' | 'createNamespace' | 'codecLookup' | 'dataTypeLookup'
> & {
  /** Overrides the codecs of the target and the extensions. */
  readonly codecLookup?: CodecLookupWithDescriptors;
  /** Overrides the data types of the target and the extensions. */
  readonly dataTypeLookup?: DataTypeLookup;
};

type SqliteDefinition<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = SqliteBaseScaffold<Extensions> & {
  readonly types?: Types;
  readonly models?: Models;
};

type SqliteScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = SqliteBaseScaffold<Extensions>;

const target: TargetPackRef<'sql', 'sqlite'> = sqlitePack;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
>(definition: SqliteDefinition<Types, Models, Extensions>): SqliteResult<Types, Models, Extensions>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
>(
  scaffold: SqliteScaffold<Extensions>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlitePack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
  },
): SqliteResult<Types, Models, Extensions>;

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts at this layer.
export function defineContract(
  definition: SqliteDefinition<TypesConstraint, ModelsConstraint, undefined>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, SqlitePack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
  },
): SqliteResult<TypesConstraint, ModelsConstraint, undefined> {
  const extensionPacks: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    definition.extensions ?? {},
  );
  const bound = {
    ...definition,
    createNamespace: sqliteCreateNamespace,
    codecLookup: definition.codecLookup ?? assembleSqliteCodecRegistry(target, extensionPacks),
    dataTypeLookup:
      definition.dataTypeLookup ?? assembleDataTypes([target, ...extensionPacks]).lookup,
  };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, sqlitePack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, sqlitePack, bound);
}
