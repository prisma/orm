import type { Contract } from '@internal/contract/types';
import sqlFamilyPack from '@internal/family-sql/pack';
import type { ExtensionPackRef } from '@internal/framework-components/components';
import type {
  SqlNamespaceBase,
  SqlNamespaceInput,
  SqlStorage,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import type {
  ComposedAuthoringHelpers,
  ContractInput,
  EnumTypeHandle,
  MergeEnums,
  ModelLike,
} from '@internal/sql-contract-ts/contract-builder';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import type { RlsEntityHandle } from './rls';

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
  Naming extends ContractInput['naming'] | undefined,
  Namespaces extends readonly string[] | undefined,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    PostgresPack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly naming?: Naming;
      readonly namespaces?: Namespaces;
    }
  >
>;

type PostgresBaseScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
> = Omit<
  ContractInput<SqlFamily, PostgresPack, Record<never, never>, Record<never, never>, Extensions>,
  'family' | 'target' | 'types' | 'models' | 'enums' | 'createNamespace' | 'entities'
> & {
  /**
   * RLS handles (`policy*`, `rlsEnabled`, `role`), lowered by the generic
   * contract build through the postgres pack's entity-handle hook —
   * mirroring the PSL `policy_*` / `@@rls` lowering key-for-key and
   * wire-name-for-wire-name. This wrapper only narrows the element type;
   * it contains no entity-kind logic.
   */
  readonly entities?: readonly RlsEntityHandle[];
};

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
  const Naming extends ContractInput['naming'] | undefined = undefined,
  const Namespaces extends readonly string[] | undefined = undefined,
>(
  definition: Omit<
    PostgresDefinition<Types, Models, Extensions, Enums>,
    'naming' | 'namespaces'
  > & {
    readonly naming?: Naming;
    readonly namespaces?: Namespaces;
  },
): PostgresResult<Types, Models, Extensions, Enums, Naming, Namespaces>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
  const Naming extends ContractInput['naming'] | undefined = undefined,
  const Namespaces extends readonly string[] | undefined = undefined,
>(
  scaffold: Omit<PostgresScaffold<Extensions, ScaffoldEnums>, 'naming' | 'namespaces'> & {
    readonly naming?: Naming;
    readonly namespaces?: Namespaces;
  },
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<
  Types,
  Models,
  Extensions,
  MergeEnums<ScaffoldEnums, FactoryEnums>,
  Naming,
  Namespaces
>;

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts and zero entity-kind logic at this layer: the generic
// build lowers `entities` through the pack-registered entity-handle hook.
export function defineContract(
  definition: PostgresDefinition<TypesConstraint, ModelsConstraint, undefined, EnumsConstraint>,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): Contract<SqlStorage> {
  const bound = { ...definition, createNamespace: postgresCreateNamespace };
  if (factory !== undefined) {
    return buildBoundContract(sqlFamilyPack, postgresPack, bound, factory);
  }
  return buildBoundContract(sqlFamilyPack, postgresPack, bound);
}
