import sqlFamilyPack from '@internal/family-sql/pack';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import type {
  SqlNamespaceBase,
  SqlNamespaceInput,
  StorageTypeInstance,
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

type TypesConstraint = Record<string, StorageTypeInstance>;
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
    }
  >
>;

type SqliteBaseScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<SqlFamily, SqlitePack, Record<never, never>, Record<never, never>, Extensions>,
  'family' | 'target' | 'types' | 'models' | 'createNamespace'
>;

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
  const bound = {
    ...definition,
    createNamespace: sqliteCreateNamespace,
    codecLookup:
      definition.codecLookup ??
      assembleSqliteCodecRegistry(target, Object.values(definition.extensions ?? {})),
  };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, sqlitePack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, sqlitePack, bound);
}
