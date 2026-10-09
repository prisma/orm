import sqlFamilyPack from '@internal/family-sql/pack';
import {
  assembleDataTypes,
  type CodecLookupWithDescriptors,
  type DataTypeLookup,
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
import type { RlsEntityHandle } from './rls';

type SqlFamily = typeof sqlFamilyPack;
type PostgresPack = typeof postgresPack;

type TypesConstraint = Record<string, AuthoredStorageTypeInstance>;
type ModelsConstraint = Record<string, ModelLike>;
type EnumsConstraint = Record<string, EnumTypeHandle>;
type NamespacesConstraint = readonly string[] | undefined;

type PostgresResult<
  Types extends TypesConstraint,
  Models extends ModelsConstraint,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
> = ReturnType<
  typeof buildBoundContract<
    SqlFamily,
    PostgresPack,
    {
      readonly types?: Types;
      readonly models?: Models;
      readonly extensions?: Extensions;
      readonly enums?: Enums;
      readonly namespaces?: Namespaces;
      readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
      readonly codecLookup: CodecLookupWithDescriptors;
      readonly dataTypeLookup: DataTypeLookup;
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
  | 'namespaces'
  | 'createNamespace'
  | 'entities'
  | 'codecLookup'
  | 'dataTypeLookup'
> & {
  /** Overrides the codecs of the target and the extensions. */
  readonly codecLookup?: CodecLookupWithDescriptors;
  /** Overrides the data types of the target and the extensions. */
  readonly dataTypeLookup?: DataTypeLookup;
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
  Namespaces extends NamespacesConstraint,
> = PostgresBaseScaffold<Extensions> & {
  readonly types?: Types;
  readonly models?: Models;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

type PostgresScaffold<
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined,
  Enums extends EnumsConstraint,
  Namespaces extends NamespacesConstraint,
> = PostgresBaseScaffold<Extensions> & {
  readonly types?: never;
  readonly models?: never;
  readonly enums?: Enums;
  readonly namespaces?: Namespaces;
};

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const Enums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
>(
  definition: PostgresDefinition<Types, Models, Extensions, Enums, Namespaces>,
): PostgresResult<Types, Models, Extensions, Enums, Namespaces>;

export function defineContract<
  const Types extends TypesConstraint = Record<never, never>,
  const Models extends ModelsConstraint = Record<never, never>,
  const Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
  const ScaffoldEnums extends EnumsConstraint = Record<never, never>,
  const FactoryEnums extends EnumsConstraint = Record<never, never>,
  const Namespaces extends NamespacesConstraint = undefined,
>(
  scaffold: PostgresScaffold<Extensions, ScaffoldEnums, Namespaces>,
  factory: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, Extensions>) => {
    readonly types?: Types;
    readonly models?: Models;
    readonly enums?: FactoryEnums;
  },
): PostgresResult<Types, Models, Extensions, MergeEnums<ScaffoldEnums, FactoryEnums>, Namespaces>;

// Implementation — delegates to buildBoundContract which pre-binds family/target,
// carrying zero casts and zero entity-kind logic at this layer: the generic
// build lowers `entities` through the pack-registered entity-handle hook.
export function defineContract(
  definition: PostgresDefinition<
    TypesConstraint,
    ModelsConstraint,
    undefined,
    EnumsConstraint,
    NamespacesConstraint
  >,
  factory?: (helpers: ComposedAuthoringHelpers<SqlFamily, PostgresPack, undefined>) => {
    readonly types?: TypesConstraint;
    readonly models?: ModelsConstraint;
    readonly enums?: EnumsConstraint;
  },
): PostgresResult<
  TypesConstraint,
  ModelsConstraint,
  undefined,
  EnumsConstraint,
  NamespacesConstraint
> {
  const extensions: readonly ExtensionPackRef<'sql', string>[] = Object.values(
    definition.extensions ?? {},
  );
  const dataTypeLookup =
    definition.dataTypeLookup ?? assembleDataTypes([postgresPack, ...extensions]).lookup;
  const bound = {
    ...definition,
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
