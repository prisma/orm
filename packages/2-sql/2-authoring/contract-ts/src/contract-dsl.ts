import type {
  ColumnDefault,
  ColumnDefaultLiteralInputValue,
  ControlPolicy,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import { isColumnDefault } from '@internal/contract/types';
import type { ForeignKeyDefaultsState } from '@internal/contract-authoring';
import type { AuthoringFieldPresetDescriptor } from '@internal/framework-components/authoring';
import { instantiateAuthoringFieldPreset } from '@internal/framework-components/authoring';
import type { CodecLookup, ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import type {
  SqlNamespaceBase,
  SqlNamespaceInput,
  StorageTypeInstance,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { NamedConstraintSpec } from './authoring-type-utils';
import { contractError } from './contract-errors';
import type { EnumTypeHandle } from './enum-type';
import { isEnumTypeHandle } from './enum-type';

export type NamingStrategy = 'identity' | 'snake_case';

export type NamingConfig = {
  readonly tables?: NamingStrategy;
  readonly columns?: NamingStrategy;
};

type NamedStorageTypeRef = string | StorageTypeInstance | EnumTypeHandle;

type NamedConstraintNameSpec<Name extends string = string> = {
  readonly name: Name;
};

import type { CheckKind } from '@internal/sql-schema-ir/naming';

export type { CheckKind };

export type ScalarFieldState<
  Descriptor extends ColumnTypeDescriptor = ColumnTypeDescriptor,
  TypeRef extends NamedStorageTypeRef | undefined = undefined,
  Nullable extends boolean = boolean,
  ColumnName extends string | undefined = string | undefined,
  IdSpec extends NamedConstraintSpec | undefined = undefined,
  UniqueSpec extends NamedConstraintSpec | undefined = undefined,
  Many extends boolean = false,
> = {
  readonly kind: 'scalar';
  readonly descriptor?: Descriptor | undefined;
  readonly typeRef?: TypeRef | undefined;
  readonly nullable: Nullable;
  readonly columnName?: ColumnName | undefined;
  readonly default?: ColumnDefault | undefined;
  readonly executionDefaults?: ExecutionMutationDefaultPhases | undefined;
  readonly many?: Many extends true ? true : undefined;
  readonly noCheck?: readonly CheckKind[] | undefined;
} & (IdSpec extends NamedConstraintSpec ? { readonly id: IdSpec } : { readonly id?: undefined }) &
  (UniqueSpec extends NamedConstraintSpec
    ? { readonly unique: UniqueSpec }
    : { readonly unique?: undefined });

type AnyScalarFieldState = {
  readonly kind: 'scalar';
  readonly descriptor?: ColumnTypeDescriptor | undefined;
  readonly typeRef?: NamedStorageTypeRef | undefined;
  readonly nullable: boolean;
  readonly columnName?: string | undefined;
  readonly default?: ColumnDefault | undefined;
  readonly executionDefaults?: ExecutionMutationDefaultPhases | undefined;
  readonly many?: boolean | undefined;
  readonly noCheck?: readonly CheckKind[] | undefined;
  readonly id?: NamedConstraintSpec | undefined;
  readonly unique?: NamedConstraintSpec | undefined;
};

type HasNamedConstraintId<State extends AnyScalarFieldState> =
  State extends ScalarFieldState<
    ColumnTypeDescriptor,
    NamedStorageTypeRef | undefined,
    boolean,
    string | undefined,
    infer IdSpec,
    NamedConstraintSpec | undefined,
    boolean
  >
    ? IdSpec extends NamedConstraintSpec
      ? true
      : false
    : false;

type HasNamedConstraintUnique<State extends AnyScalarFieldState> =
  State extends ScalarFieldState<
    ColumnTypeDescriptor,
    NamedStorageTypeRef | undefined,
    boolean,
    string | undefined,
    NamedConstraintSpec | undefined,
    infer UniqueSpec,
    boolean
  >
    ? UniqueSpec extends NamedConstraintSpec
      ? true
      : false
    : false;

type FieldSqlSpecForState<State extends AnyScalarFieldState> = {
  readonly column?: string;
} & (HasNamedConstraintId<State> extends true
  ? { readonly id?: NamedConstraintNameSpec }
  : Record<never, never>) &
  (HasNamedConstraintUnique<State> extends true
    ? { readonly unique?: NamedConstraintNameSpec }
    : Record<never, never>);

type ApplyFieldSqlSpec<
  State extends AnyScalarFieldState,
  Spec extends FieldSqlSpecForState<State>,
> =
  State extends ScalarFieldState<
    infer Descriptor,
    infer TypeRef,
    infer Nullable,
    infer ColumnName,
    infer IdSpec,
    infer UniqueSpec,
    infer Many
  >
    ? ScalarFieldState<
        Descriptor,
        TypeRef,
        Nullable,
        Spec extends { readonly column: infer NextColumn extends string } ? NextColumn : ColumnName,
        Spec extends { readonly id: { readonly name: infer IdName extends string } }
          ? IdSpec extends NamedConstraintSpec
            ? NamedConstraintSpec<IdName>
            : IdSpec
          : IdSpec,
        Spec extends { readonly unique: { readonly name: infer UniqueName extends string } }
          ? UniqueSpec extends NamedConstraintSpec
            ? NamedConstraintSpec<UniqueName>
            : UniqueSpec
          : UniqueSpec,
        Many
      >
    : AnyScalarFieldState;

export type GeneratedFieldSpec = {
  readonly type: ColumnTypeDescriptor;
  readonly typeParams?: Record<string, unknown>;
  readonly generated: ExecutionMutationDefaultValue;
};

function toColumnDefault(value: ColumnDefaultLiteralInputValue | ColumnDefault): ColumnDefault {
  if (isColumnDefault(value)) {
    return value;
  }
  return { kind: 'literal', value };
}

export class ScalarFieldBuilder<State extends AnyScalarFieldState = AnyScalarFieldState> {
  declare readonly __state: State;

  constructor(private readonly state: State) {}

  /**
   * Returns the physical column name when `.column(name)` was called, or
   * `undefined` when the field uses the default (logical field name) mapping.
   * Used by cross-space FK lowering to stamp the physical column name onto
   * `TargetFieldRef.columnName` so FK target columns are resolved correctly.
   */
  get physicalColumnName(): string | undefined {
    return this.state.columnName;
  }

  optional(): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer Descriptor,
      infer TypeRef,
      boolean,
      infer ColumnName,
      infer IdSpec,
      infer UniqueSpec,
      infer Many
    >
      ? ScalarFieldState<Descriptor, TypeRef, true, ColumnName, IdSpec, UniqueSpec, Many>
      : AnyScalarFieldState
  > {
    return new ScalarFieldBuilder(
      blindCast<
        State extends ScalarFieldState<
          infer Descriptor,
          infer TypeRef,
          boolean,
          infer ColumnName,
          infer IdSpec,
          infer UniqueSpec,
          infer Many
        >
          ? ScalarFieldState<Descriptor, TypeRef, true, ColumnName, IdSpec, UniqueSpec, Many>
          : AnyScalarFieldState,
        'object spread does not narrow the generic State conditional; runtime shape is correct'
      >({
        ...this.state,
        nullable: true,
      }),
    );
  }

  column<ColumnName extends string>(
    name: ColumnName,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer Descriptor,
      infer TypeRef,
      infer Nullable,
      string | undefined,
      infer IdSpec,
      infer UniqueSpec,
      infer Many
    >
      ? ScalarFieldState<Descriptor, TypeRef, Nullable, ColumnName, IdSpec, UniqueSpec, Many>
      : AnyScalarFieldState
  > {
    return new ScalarFieldBuilder(
      blindCast<
        State extends ScalarFieldState<
          infer Descriptor,
          infer TypeRef,
          infer Nullable,
          string | undefined,
          infer IdSpec,
          infer UniqueSpec,
          infer Many
        >
          ? ScalarFieldState<Descriptor, TypeRef, Nullable, ColumnName, IdSpec, UniqueSpec, Many>
          : AnyScalarFieldState,
        'object spread does not narrow the generic State conditional; runtime shape is correct'
      >({
        ...this.state,
        columnName: name,
      }),
    );
  }

  many(): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer Descriptor,
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      infer IdSpec,
      infer UniqueSpec,
      boolean
    >
      ? ScalarFieldState<Descriptor, TypeRef, Nullable, ColumnName, IdSpec, UniqueSpec, true>
      : AnyScalarFieldState
  > {
    return new ScalarFieldBuilder(
      blindCast<
        State extends ScalarFieldState<
          infer Descriptor,
          infer TypeRef,
          infer Nullable,
          infer ColumnName,
          infer IdSpec,
          infer UniqueSpec,
          boolean
        >
          ? ScalarFieldState<Descriptor, TypeRef, Nullable, ColumnName, IdSpec, UniqueSpec, true>
          : AnyScalarFieldState,
        'object spread does not narrow the generic State conditional; runtime shape is correct'
      >({
        ...this.state,
        many: true,
      }),
    );
  }

  /**
   * Declines enforcement of generated CHECK constraints on this column.
   * With no arguments, waives every kind the column's shape derives;
   * with arguments, waives exactly the named kinds. Declared types are
   * unchanged — runtime values may diverge from them once enforcement
   * is waived.
   */
  noCheck(...kinds: readonly CheckKind[]): ScalarFieldBuilder<State> {
    if (this.state.noCheck !== undefined) {
      throw contractError(
        'CONTRACT.CHECK_OPTOUT_INVALID',
        'noCheck() was already called on this field; declare every waived kind in a single call.',
        { meta: { reason: 'duplicate-noCheck-call' } },
      );
    }
    return blindCast<
      ScalarFieldBuilder<State>,
      'noCheck() changes only the runtime flag; the typed state is unchanged, matching the many()/default() builder-clone pattern'
    >(
      new ScalarFieldBuilder({
        ...this.state,
        noCheck: kinds,
      }),
    );
  }

  default(value: ColumnDefaultLiteralInputValue | ColumnDefault): ScalarFieldBuilder<State> {
    return new ScalarFieldBuilder({
      ...this.state,
      default: toColumnDefault(value),
    }) as ScalarFieldBuilder<State>;
  }

  /**
   * @deprecated Write `.default(now())` or `.default(autoincrement())`, or `` .default(sql`...`) `` for any other SQL. Removed in 8.0.0.
   */
  defaultSql(expression: string): ScalarFieldBuilder<State> {
    return new ScalarFieldBuilder({
      ...this.state,
      default: { kind: 'function', expression },
    }) as ScalarFieldBuilder<State>;
  }

  id<const Name extends string | undefined = undefined>(
    options?: NamedConstraintSpec<Name>,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer Descriptor,
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      NamedConstraintSpec | undefined,
      infer UniqueSpec,
      infer Many
    >
      ? ScalarFieldState<
          Descriptor,
          TypeRef,
          Nullable,
          ColumnName,
          NamedConstraintSpec<Name>,
          UniqueSpec,
          Many
        >
      : AnyScalarFieldState
  > {
    return new ScalarFieldBuilder(
      blindCast<
        State extends ScalarFieldState<
          infer Descriptor,
          infer TypeRef,
          infer Nullable,
          infer ColumnName,
          NamedConstraintSpec | undefined,
          infer UniqueSpec,
          infer Many
        >
          ? ScalarFieldState<
              Descriptor,
              TypeRef,
              Nullable,
              ColumnName,
              NamedConstraintSpec<Name>,
              UniqueSpec,
              Many
            >
          : AnyScalarFieldState,
        'object spread does not narrow the generic State conditional; runtime shape is correct'
      >({
        ...this.state,
        id: options?.name ? { name: options.name } : {},
      }),
    );
  }

  unique<const Name extends string | undefined = undefined>(
    options?: NamedConstraintSpec<Name>,
  ): ScalarFieldBuilder<
    State extends ScalarFieldState<
      infer Descriptor,
      infer TypeRef,
      infer Nullable,
      infer ColumnName,
      infer IdSpec,
      NamedConstraintSpec | undefined,
      infer Many
    >
      ? ScalarFieldState<
          Descriptor,
          TypeRef,
          Nullable,
          ColumnName,
          IdSpec,
          NamedConstraintSpec<Name>,
          Many
        >
      : AnyScalarFieldState
  > {
    return new ScalarFieldBuilder(
      blindCast<
        State extends ScalarFieldState<
          infer Descriptor,
          infer TypeRef,
          infer Nullable,
          infer ColumnName,
          infer IdSpec,
          NamedConstraintSpec | undefined,
          infer Many
        >
          ? ScalarFieldState<
              Descriptor,
              TypeRef,
              Nullable,
              ColumnName,
              IdSpec,
              NamedConstraintSpec<Name>,
              Many
            >
          : AnyScalarFieldState,
        'object spread does not narrow the generic State conditional; runtime shape is correct'
      >({
        ...this.state,
        unique: options?.name ? { name: options.name } : {},
      }),
    );
  }

  sql<const Spec extends FieldSqlSpecForState<State>>(
    spec: Spec,
  ): ScalarFieldBuilder<ApplyFieldSqlSpec<State, Spec>> {
    const idSpec = 'id' in spec ? spec.id : undefined;
    const uniqueSpec = 'unique' in spec ? spec.unique : undefined;

    if (idSpec && !this.state.id) {
      throw contractError(
        'CONTRACT.ARGUMENT_INVALID',
        'field.sql({ id }) requires an existing inline .id(...) declaration.',
      );
    }
    if (uniqueSpec && !this.state.unique) {
      throw contractError(
        'CONTRACT.ARGUMENT_INVALID',
        'field.sql({ unique }) requires an existing inline .unique(...) declaration.',
      );
    }

    return new ScalarFieldBuilder(
      blindCast<
        ApplyFieldSqlSpec<State, Spec>,
        'conditional object spread does not narrow ApplyFieldSqlSpec; runtime shape is correct'
      >({
        ...this.state,
        ...(spec.column ? { columnName: spec.column } : {}),
        ...(idSpec ? { id: { name: idSpec.name } } : {}),
        ...(uniqueSpec ? { unique: { name: uniqueSpec.name } } : {}),
      }),
    );
  }

  build(): State {
    return this.state;
  }
}

export class EnumScalarFieldBuilder<
  Handle extends EnumTypeHandle,
  State extends AnyScalarFieldState = ScalarFieldState<
    ColumnTypeDescriptor,
    Handle,
    false,
    undefined
  >,
> extends ScalarFieldBuilder<State> {
  readonly #handle: Handle;

  constructor(state: State, handle: Handle) {
    super(state);
    this.#handle = handle;
  }

  override default(value: Handle['values'][number]): EnumScalarFieldBuilder<Handle, State> {
    return blindCast<
      EnumScalarFieldBuilder<Handle, State>,
      'object spread does not narrow the generic State conditional; runtime shape is correct'
    >(
      new EnumScalarFieldBuilder(
        { ...this.build(), default: { kind: 'literal', value } },
        this.#handle,
      ),
    );
  }

  override defaultSql(_expression: never): never {
    throw contractError(
      'CONTRACT.DEFAULT_INVALID',
      'defaultSql is not available on an enum field; use .default(members.X) instead',
      { meta: { reason: 'defaultSql-on-enum-field' } },
    );
  }
}

function columnField<Descriptor extends ColumnTypeDescriptor>(
  descriptor: Descriptor,
): ScalarFieldBuilder<ScalarFieldState<Descriptor, undefined, false, undefined>> {
  return new ScalarFieldBuilder({
    kind: 'scalar',
    descriptor,
    nullable: false,
  });
}

function generatedField<Descriptor extends ColumnTypeDescriptor>(
  spec: GeneratedFieldSpec & { readonly type: Descriptor },
): ScalarFieldBuilder<ScalarFieldState<Descriptor, undefined, false, undefined>> {
  return new ScalarFieldBuilder({
    kind: 'scalar',
    descriptor: {
      ...spec.type,
      ...(spec.typeParams ? { typeParams: spec.typeParams } : {}),
    },
    nullable: false,
    executionDefaults: { onCreate: spec.generated },
  });
}

function namedTypeField<TypeRef extends string>(
  typeRef: TypeRef,
): ScalarFieldBuilder<ScalarFieldState<ColumnTypeDescriptor, TypeRef, false, undefined>>;
function namedTypeField<TypeRef extends StorageTypeInstance>(
  typeRef: TypeRef,
): ScalarFieldBuilder<
  ScalarFieldState<ColumnTypeDescriptor<TypeRef['codecId']>, TypeRef, false, undefined>
>;
function namedTypeField<Handle extends EnumTypeHandle>(
  typeRef: Handle,
): EnumScalarFieldBuilder<Handle>;
function namedTypeField(typeRef: NamedStorageTypeRef): ScalarFieldBuilder {
  if (isEnumTypeHandle(typeRef)) {
    return new EnumScalarFieldBuilder(
      blindCast<
        ScalarFieldState<ColumnTypeDescriptor, typeof typeRef, false, undefined>,
        'literal object lacks explicit many; cast to the full ScalarFieldState so optional() conditional resolves Many = false'
      >({
        kind: 'scalar',
        typeRef,
        nullable: false,
      }),
      typeRef,
    );
  }
  return new ScalarFieldBuilder({
    kind: 'scalar',
    typeRef,
    nullable: false,
  });
}

export function buildFieldPreset(
  descriptor: AuthoringFieldPresetDescriptor,
  args: readonly unknown[],
  namedConstraintOptions?: NamedConstraintSpec,
): ScalarFieldBuilder {
  const preset = instantiateAuthoringFieldPreset(descriptor, args);

  return new ScalarFieldBuilder({
    kind: 'scalar',
    descriptor: preset.descriptor,
    nullable: preset.nullable,
    ...ifDefined('default', preset.default),
    ...ifDefined('executionDefaults', preset.executionDefaults),
    ...(preset.id
      ? {
          id: namedConstraintOptions?.name ? { name: namedConstraintOptions.name } : {},
        }
      : {}),
    ...(preset.unique
      ? {
          unique: namedConstraintOptions?.name ? { name: namedConstraintOptions.name } : {},
        }
      : {}),
  });
}

type RelationModelRefSource = 'string' | 'token' | 'lazyToken';
type TargetFieldRefSource = 'string' | 'token';

type EagerRelationModelName<
  ModelName extends string = string,
  Source extends Exclude<RelationModelRefSource, 'lazyToken'> = Exclude<
    RelationModelRefSource,
    'lazyToken'
  >,
> = {
  readonly kind: 'relationModelName';
  readonly source: Source;
  readonly modelName: ModelName;
};

type LazyRelationModelName<ModelName extends string = string> = {
  readonly kind: 'lazyRelationModelName';
  readonly source: 'lazyToken';
  readonly resolve: () => ModelName;
};

type RelationModelSource<ModelName extends string = string> =
  | EagerRelationModelName<ModelName>
  | LazyRelationModelName<ModelName>;

type BelongsToRelation<
  ToModel extends string = string,
  FromField extends string | readonly string[] = string | readonly string[],
  ToField extends string | readonly string[] = string | readonly string[],
  SqlSpec extends BelongsToRelationSqlSpec | undefined = undefined,
> = {
  readonly kind: 'belongsTo';
  readonly toModel: RelationModelSource<ToModel>;
  readonly from: FromField;
  readonly to: ToField;
  readonly sql?: SqlSpec;
  /**
   * Whether the related row may be absent. Defaults to whether any `from`
   * field is nullable; an explicit value that contradicts them is rejected.
   */
  readonly optional?: boolean;
  /**
   * Contract-space identity of the target model. Populated when
   * `belongsTo` receives a cross-space branded handle. Absent for
   * local (same-space) relations.
   */
  readonly spaceId?: string;
  /**
   * Physical table name of the cross-space target model. Only set
   * when `spaceId` is present; read from the handle's `tableName`.
   */
  readonly tableName?: string;
  /**
   * Namespace coordinate of the cross-space target model.
   * Only set when `spaceId` is present.
   */
  readonly namespaceId?: string;
};

type HasManyRelation<
  ToModel extends string = string,
  ByField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'hasMany';
  readonly toModel: RelationModelSource<ToModel>;
  readonly by: ByField;
};

type HasOneRelation<
  ToModel extends string = string,
  ByField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'hasOne';
  readonly toModel: RelationModelSource<ToModel>;
  readonly by: ByField;
};

type ManyToManyRelation<
  ToModel extends string = string,
  ThroughModel extends string = string,
  FromField extends string | readonly string[] = string | readonly string[],
  ToField extends string | readonly string[] = string | readonly string[],
> = {
  readonly kind: 'manyToMany';
  readonly toModel: RelationModelSource<ToModel>;
  readonly through: RelationModelSource<ThroughModel>;
  readonly from: FromField;
  readonly to: ToField;
};

export type RelationState =
  | BelongsToRelation<
      string,
      string | readonly string[],
      string | readonly string[],
      BelongsToRelationSqlSpec | undefined
    >
  | HasManyRelation
  | HasOneRelation
  | ManyToManyRelation;

type AnyRelationState = RelationState;
export type AnyRelationBuilder = RelationBuilder<AnyRelationState>;

type ApplyBelongsToRelationSqlSpec<
  State extends RelationState,
  SqlSpec extends BelongsToRelationSqlSpec,
> =
  State extends BelongsToRelation<
    infer ToModel,
    infer FromField,
    infer ToField,
    BelongsToRelationSqlSpec | undefined
  >
    ? BelongsToRelation<ToModel, FromField, ToField, SqlSpec>
    : never;

export class RelationBuilder<State extends RelationState = AnyRelationState> {
  declare readonly __state: State;

  constructor(private readonly state: State) {}

  sql<const SqlSpec extends BelongsToRelationSqlSpec>(
    this: State extends BelongsToRelation<
      string,
      string | readonly string[],
      string | readonly string[],
      BelongsToRelationSqlSpec | undefined
    >
      ? RelationBuilder<State>
      : never,
    spec: SqlSpec,
  ): RelationBuilder<ApplyBelongsToRelationSqlSpec<State, SqlSpec>> {
    if (this.state.kind !== 'belongsTo') {
      throw contractError(
        'CONTRACT.RELATION_INVALID',
        'relation.sql(...) is only supported for belongsTo relations.',
        { meta: { relationKind: this.state.kind } },
      );
    }

    return new RelationBuilder({
      ...this.state,
      sql: spec,
    } as ApplyBelongsToRelationSqlSpec<State, SqlSpec>);
  }

  build(): State {
    return this.state;
  }
}

/**
 * Reference to a column on the current (local) model.
 *
 * Source columns are always local to the contract being authored. The
 * cross-space brand lives on `TargetFieldRef` (the target side of a foreign
 * key), not here.
 */
export type ColumnRef<FieldName extends string = string> = {
  readonly kind: 'columnRef';
  readonly fieldName: FieldName;
};

/**
 * Reference to a field on a target model, produced by model `.refs` and
 * `constraints.ref(modelName, fieldName)`.
 *
 * The `TSpaceId` phantom parameter carries the contract-space identity of the
 * target model. Local model handles produce `TSpaceId = '<self>'`; extension
 * handles carry the extension's `spaceId`. The brand is propagated from the
 * parent `ContractModelBuilder` via the `spaceId?` property: absent means local
 * (`'<self>'`), present means cross-space.
 */
export type TargetFieldRef<
  ModelName extends string = string,
  FieldName extends string = string,
  TSpaceId extends string = string,
> = {
  readonly kind: 'targetFieldRef';
  readonly source: TargetFieldRefSource;
  readonly modelName: ModelName;
  readonly fieldName: FieldName;
  /**
   * Cross-space discriminator. When present, the referenced model lives in a
   * different contract space identified by this value. Absent for local refs.
   */
  readonly spaceId?: TSpaceId extends '<self>' ? never : TSpaceId;
  /**
   * Namespace id of the cross-space target model (e.g. `'auth'` for
   * `supabase` `auth.User`). Only present for cross-space refs.
   */
  readonly namespaceId?: string;
  /**
   * Physical table name of the cross-space target model. Only present for
   * cross-space refs; allows the lowering path to bypass the local model
   * registry.
   */
  readonly tableName?: string;
  /**
   * Physical column name of the target field. Populated for cross-space refs
   * when the extension handle's field used `.column(name)` to rename the
   * physical column. When absent the logical `fieldName` is used as the column
   * name. Only relevant for cross-space FK lowering — local FKs resolve column
   * names via the local `fieldToColumn` map.
   */
  readonly columnName?: string;
};

export type ModelTokenRefs<
  ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  TSpaceId extends string = '<self>',
> = {
  readonly [K in keyof Fields]: TargetFieldRef<ModelName, K & string, TSpaceId>;
};

type ConstraintOptions<Name extends string | undefined = string | undefined> = {
  readonly name?: Name;
};

export type IndexTypeMap = Record<string, { readonly options: unknown }>;

type IndexOptionsBase<Name extends string | undefined> = {
  readonly name?: Name;
  /** Exact physical name — adopted verbatim, no wire hash. Xor `name`. */
  readonly map?: string;
  /** Opaque SQL: partial-index predicate (WHERE body, without the keyword). */
  readonly where?: string;
  readonly unique?: boolean;
};

type IndexInput<
  Name extends string | undefined,
  IndexTypes extends IndexTypeMap,
> = keyof IndexTypes extends never
  ? IndexOptionsBase<Name>
  :
      | (IndexOptionsBase<Name> & { readonly type?: never; readonly options?: never })
      | {
          readonly [K in keyof IndexTypes & string]: IndexOptionsBase<Name> & {
            readonly type: K;
            readonly options: IndexTypes[K]['options'];
          };
        }[keyof IndexTypes & string];

/**
 * The expression overload's input: the whole CREATE INDEX element list as
 * one opaque string. `name` or `map` is required — enforced at lowering
 * with the same diagnostics as PSL.
 */
type ExpressionIndexInput<
  Name extends string | undefined,
  IndexTypes extends IndexTypeMap,
> = IndexInput<Name, IndexTypes> & { readonly expression: IndexExpressionInput };

type ForeignKeyOptions<Name extends string | undefined = string | undefined> =
  ConstraintOptions<Name> & {
    readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly constraint?: boolean;
    readonly index?: boolean;
  };

type BelongsToRelationSqlSpec<Name extends string | undefined = string | undefined> = {
  readonly fk?: ForeignKeyOptions<Name>;
};

export type IdConstraint<
  FieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = {
  readonly kind: 'id';
  readonly fields: FieldNames;
  readonly name?: Name;
};

export type UniqueConstraint<FieldNames extends readonly string[] = readonly string[]> = {
  readonly kind: 'unique';
  readonly fields: FieldNames;
  readonly name?: string;
};

/**
 * An index expression rendered at lowering, once the storage column names are
 * known. `fields` resolve exactly as the field-tuple form's do — a `.column()`
 * override first, then the contract's column naming convention — and `render`
 * receives the resolved names in the same order. Authoring code cannot know
 * either, so an expression over a column has to be written this way rather
 * than as a string, or it silently stops matching the column it names.
 */
/** A field the lowering resolved, as the renderer sees it. */
export type DeferredIndexColumn = {
  /** The storage column name, after `.column()` and the naming convention. */
  readonly name: string;
  /** The codec the column stores its values through. */
  readonly codecId: string;
};

export type DeferredIndexExpression = {
  readonly fields: readonly ColumnRef[];
  readonly render: (columns: readonly DeferredIndexColumn[]) => string;
};

/** Opaque SQL, either written out or rendered at lowering. */
export type IndexExpressionInput = string | DeferredIndexExpression;

/** An authored index constraint's element structure — field tuple xor expression. */
export type IndexConstraintElements<FieldNames extends readonly string[] = readonly string[]> =
  | {
      /** Field-name tuple. */
      readonly fields: FieldNames;
      readonly expression?: never;
    }
  | {
      readonly fields?: never;
      /** Opaque SQL: the entire CREATE INDEX element list — never parsed. */
      readonly expression: IndexExpressionInput;
    };

/** Options only exist as options of a type, so the pair is one union. */
export type IndexConstraintMethod =
  | { readonly type?: undefined; readonly options?: undefined }
  | { readonly type: string; readonly options?: Record<string, unknown> };

export type IndexConstraint<
  FieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = IndexConstraintElements<FieldNames> &
  IndexConstraintMethod & {
    readonly kind: 'index';
    readonly where?: string;
    readonly unique?: boolean;
    readonly name?: Name;
    readonly map?: string;
  };

/**
 * An authored check constraint, as returned by {@link check}: `map` adopts an
 * exact physical name verbatim, `name` is a wire-name prefix. Unlike an
 * index there is no column tuple to derive a default name from, so exactly
 * one of `name` or `map` is required — enforced at lowering, same as PSL.
 */
export type AuthoredCheckConstraint = {
  readonly kind: 'check';
  readonly expression: string;
  readonly name?: string;
  readonly map?: string;
};

export type ForeignKeyConstraint<
  SourceFieldNames extends readonly string[] = readonly string[],
  TargetModelName extends string = string,
  TargetFieldNames extends readonly string[] = readonly string[],
  Name extends string | undefined = string | undefined,
> = {
  readonly kind: 'fk';
  readonly fields: SourceFieldNames;
  readonly targetModel: TargetModelName;
  readonly targetFields: TargetFieldNames;
  readonly targetSource?: TargetFieldRefSource;
  /**
   * Cross-space discriminator. When present, the FK target lives in a
   * different contract space identified by this value. Absent for local FKs.
   */
  readonly targetSpaceId?: string;
  /**
   * Namespace coordinate of the cross-space target model. Populated when
   * the target model handle carries a `namespace` (e.g. `auth` for supabase
   * `auth.User`). Absent for local FKs.
   */
  readonly targetNamespaceId?: string;
  /**
   * Table name of the cross-space target. Populated for cross-space FKs
   * so the lowering path doesn't need a local model lookup.
   */
  readonly targetTableName?: string;
  readonly name?: Name;
  readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
  readonly constraint?: boolean;
  readonly index?: boolean;
};

function normalizeFieldRefInput(input: ColumnRef | readonly ColumnRef[]): readonly string[] {
  return (Array.isArray(input) ? input : [input]).map((ref) => ref.fieldName);
}

function normalizeTargetFieldRefInput(input: TargetFieldRef | readonly TargetFieldRef[]): {
  readonly modelName: string;
  readonly fieldNames: readonly string[];
  readonly source: TargetFieldRefSource;
  readonly spaceId: string | undefined;
  readonly namespaceId: string | undefined;
  readonly tableName: string | undefined;
} {
  const refs = Array.isArray(input) ? input : [input];
  const [first] = refs;
  if (!first) {
    throw contractError('CONTRACT.FOREIGN_KEY_INVALID', 'Expected at least one target ref', {
      meta: { reason: 'empty-target-refs' },
    });
  }
  if (refs.some((ref) => ref.modelName !== first.modelName)) {
    throw contractError(
      'CONTRACT.FOREIGN_KEY_INVALID',
      'All target refs in a foreign key must point to the same model',
      { meta: { mismatch: 'modelName', models: refs.map((ref) => ref.modelName) } },
    );
  }
  // F-compound: all refs in a compound FK must share the same cross-space coordinate.
  // A mismatch in spaceId, namespaceId, or tableName means the refs come from
  // different spaces despite having the same modelName — an impossible FK.
  if (refs.some((ref) => ref.spaceId !== first.spaceId)) {
    throw contractError(
      'CONTRACT.FOREIGN_KEY_INVALID',
      `All target refs in a compound foreign key must share the same spaceId (found mismatch: "${first.spaceId ?? '<local>'}" vs "${refs.find((r) => r.spaceId !== first.spaceId)?.spaceId ?? '<local>'}")`,
      {
        meta: {
          mismatch: 'spaceId',
          first: first.spaceId,
          second: refs.find((r) => r.spaceId !== first.spaceId)?.spaceId,
        },
      },
    );
  }
  if (refs.some((ref) => ref.namespaceId !== first.namespaceId)) {
    throw contractError(
      'CONTRACT.FOREIGN_KEY_INVALID',
      'All target refs in a compound foreign key must share the same namespaceId (found mismatch)',
      { meta: { mismatch: 'namespaceId' } },
    );
  }
  if (refs.some((ref) => ref.tableName !== first.tableName)) {
    throw contractError(
      'CONTRACT.FOREIGN_KEY_INVALID',
      'All target refs in a compound foreign key must share the same tableName (found mismatch)',
      { meta: { mismatch: 'tableName' } },
    );
  }
  return {
    modelName: first.modelName,
    // F-col: for cross-space refs, prefer the physical column name (columnName) over
    // the logical field name. Local refs have no columnName and use fieldName directly.
    fieldNames: refs.map((ref) => ref.columnName ?? ref.fieldName),
    source: refs.some((ref) => ref.source === 'string') ? 'string' : 'token',
    spaceId: first.spaceId,
    namespaceId: first.namespaceId,
    tableName: first.tableName,
  };
}

function createConstraintsDsl<IndexTypes extends IndexTypeMap = Record<never, never>>() {
  function ref<ModelName extends string, FieldName extends string>(
    modelName: ModelName,
    fieldName: FieldName,
  ): TargetFieldRef<ModelName, FieldName> {
    return {
      kind: 'targetFieldRef',
      source: 'string',
      modelName,
      fieldName,
    };
  }

  function id<FieldName extends string, Name extends string | undefined = undefined>(
    field: ColumnRef<FieldName>,
    options?: NamedConstraintSpec<Name>,
  ): IdConstraint<readonly [FieldName], Name>;
  function id<FieldNames extends readonly string[], Name extends string | undefined = undefined>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: NamedConstraintSpec<Name>,
  ): IdConstraint<FieldNames, Name>;
  function id(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    options?: NamedConstraintSpec,
  ): IdConstraint {
    return {
      kind: 'id',
      fields: normalizeFieldRefInput(fieldOrFields),
      ...(options?.name ? { name: options.name } : {}),
    };
  }

  function unique<FieldName extends string>(
    field: ColumnRef<FieldName>,
    options?: ConstraintOptions,
  ): UniqueConstraint<readonly [FieldName]>;
  function unique<FieldNames extends readonly string[]>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: ConstraintOptions,
  ): UniqueConstraint<FieldNames>;
  function unique(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    options?: ConstraintOptions,
  ): UniqueConstraint {
    return {
      kind: 'unique',
      fields: normalizeFieldRefInput(fieldOrFields),
      ...(options?.name ? { name: options.name } : {}),
    };
  }

  function index<
    FieldNames extends readonly string[],
    const Name extends string | undefined = undefined,
  >(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: IndexInput<Name, IndexTypes>,
  ): IndexConstraint<FieldNames, Name>;
  function index<const Name extends string | undefined = undefined>(
    options: ExpressionIndexInput<Name, IndexTypes>,
  ): IndexConstraint<never, Name>;
  function index(
    fieldsOrOptions:
      | ColumnRef
      | readonly ColumnRef[]
      | {
          readonly expression: IndexExpressionInput;
          readonly name?: string;
          readonly map?: string;
          readonly where?: string;
          readonly unique?: boolean;
          readonly type?: string;
          readonly options?: unknown;
        },
    options?: {
      readonly name?: string;
      readonly map?: string;
      readonly where?: string;
      readonly unique?: boolean;
      readonly type?: string;
      readonly options?: unknown;
    },
  ): IndexConstraint {
    const isExpressionForm =
      !Array.isArray(fieldsOrOptions) &&
      typeof fieldsOrOptions === 'object' &&
      'expression' in fieldsOrOptions;
    const opts = isExpressionForm ? fieldsOrOptions : options;
    const carried = {
      kind: 'index' as const,
      ...(opts?.name !== undefined ? { name: opts.name } : {}),
      ...(opts?.map !== undefined ? { map: opts.map } : {}),
      ...(opts?.where !== undefined ? { where: opts.where } : {}),
      ...(opts?.unique !== undefined ? { unique: opts.unique } : {}),
      ...(opts?.type !== undefined ? { type: opts.type } : {}),
      ...(opts?.options !== undefined
        ? {
            options: blindCast<
              Record<string, unknown>,
              'the public overloads type options as the pack-declared options object; the loose implementation signature erases it to unknown'
            >(opts.options),
          }
        : {}),
    };
    return isExpressionForm
      ? { ...carried, expression: fieldsOrOptions.expression }
      : { ...carried, fields: normalizeFieldRefInput(fieldsOrOptions) };
  }

  function foreignKey<
    SourceFieldName extends string,
    TargetModelName extends string,
    TargetFieldName extends string,
    const Name extends string | undefined = undefined,
  >(
    field: ColumnRef<SourceFieldName>,
    target: TargetFieldRef<TargetModelName, TargetFieldName>,
    options?: ForeignKeyOptions<Name>,
  ): ForeignKeyConstraint<
    readonly [SourceFieldName],
    TargetModelName,
    readonly [TargetFieldName],
    Name
  >;
  function foreignKey<
    SourceFieldNames extends readonly string[],
    TargetModelName extends string,
    TargetFieldNames extends readonly string[],
    const Name extends string | undefined = undefined,
  >(
    fields: { readonly [K in keyof SourceFieldNames]: ColumnRef<SourceFieldNames[K] & string> },
    target: {
      readonly [K in keyof TargetFieldNames]: TargetFieldRef<
        TargetModelName,
        TargetFieldNames[K] & string
      >;
    },
    options?: ForeignKeyOptions<Name>,
  ): ForeignKeyConstraint<SourceFieldNames, TargetModelName, TargetFieldNames, Name>;
  function foreignKey(
    fieldOrFields: ColumnRef | readonly ColumnRef[],
    target: TargetFieldRef | readonly TargetFieldRef[],
    options?: ForeignKeyOptions,
  ): ForeignKeyConstraint {
    const normalizedTarget = normalizeTargetFieldRefInput(target);
    return {
      kind: 'fk',
      fields: normalizeFieldRefInput(fieldOrFields),
      targetModel: normalizedTarget.modelName,
      targetFields: normalizedTarget.fieldNames,
      targetSource: normalizedTarget.source,
      ...(normalizedTarget.spaceId !== undefined
        ? { targetSpaceId: normalizedTarget.spaceId }
        : {}),
      ...(normalizedTarget.namespaceId !== undefined
        ? { targetNamespaceId: normalizedTarget.namespaceId }
        : {}),
      ...(normalizedTarget.tableName !== undefined
        ? { targetTableName: normalizedTarget.tableName }
        : {}),
      ...(options?.name ? { name: options.name } : {}),
      ...(options?.onDelete ? { onDelete: options.onDelete } : {}),
      ...(options?.onUpdate ? { onUpdate: options.onUpdate } : {}),
      ...(options?.constraint !== undefined ? { constraint: options.constraint } : {}),
      ...(options?.index !== undefined ? { index: options.index } : {}),
    };
  }

  return {
    ref,
    id,
    unique,
    index,
    foreignKey,
  };
}

export type ConstraintsDsl = ReturnType<typeof createConstraintsDsl>;

/**
 * Declares an authored CHECK constraint for a model's `.sql({ checks: [...] })`.
 * Unlike `index()`, `check()` names no column tuple — the predicate is opaque
 * SQL — so it needs no field-ref context and is a plain top-level function
 * rather than a method on `constraints`.
 */
export function check(input: {
  readonly expression: string;
  readonly name?: string;
  readonly map?: string;
}): AuthoredCheckConstraint {
  return {
    kind: 'check',
    expression: input.expression,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.map !== undefined ? { map: input.map } : {}),
  };
}

export type ModelAttributesSpec = {
  readonly id?: IdConstraint;
  readonly uniques?: readonly UniqueConstraint[];
};

export type SqlStageSpec = {
  readonly table?: string;
  readonly control?: ControlPolicy;
  readonly indexes?: readonly IndexConstraint[];
  readonly checks?: readonly AuthoredCheckConstraint[];
  readonly foreignKeys?: readonly ForeignKeyConstraint[];
};

type FieldRefs<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly [K in keyof Fields]: ColumnRef<K & string>;
};

type AttributeContext<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly fields: FieldRefs<Fields>;
  readonly constraints: Pick<ConstraintsDsl, 'id' | 'unique'>;
};

type PackAwareIndex<IndexTypes extends IndexTypeMap> = {
  <FieldNames extends readonly string[], const Name extends string | undefined = undefined>(
    fields: { readonly [K in keyof FieldNames]: ColumnRef<FieldNames[K] & string> },
    options?: IndexInput<Name, IndexTypes>,
  ): IndexConstraint<FieldNames, Name>;
  <const Name extends string | undefined = undefined>(
    options: ExpressionIndexInput<Name, IndexTypes>,
  ): IndexConstraint<never, Name>;
};

type PackAwareSqlConstraints<IndexTypes extends IndexTypeMap> = {
  readonly foreignKey: ConstraintsDsl['foreignKey'];
  readonly ref: ConstraintsDsl['ref'];
  readonly index: PackAwareIndex<IndexTypes>;
};

export type SqlContext<
  Fields extends Record<string, ScalarFieldBuilder>,
  IndexTypes extends IndexTypeMap = Record<never, never>,
> = {
  readonly cols: FieldRefs<Fields>;
  readonly constraints: PackAwareSqlConstraints<IndexTypes>;
};

function createFieldRefs<Fields extends Record<string, ScalarFieldBuilder>>(
  fields: Fields,
): FieldRefs<Fields> {
  const refs = {} as Record<string, ColumnRef>;
  for (const fieldName of Object.keys(fields)) {
    refs[fieldName] = { kind: 'columnRef', fieldName };
  }
  return refs as FieldRefs<Fields>;
}

function createModelTokenRefs<
  ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  TSpaceId extends string = '<self>',
>(
  modelName: ModelName,
  fields: Fields,
  crossSpaceCoordinate?: {
    readonly spaceId: TSpaceId;
    readonly namespaceId?: string;
    readonly tableName?: string;
  },
): ModelTokenRefs<ModelName, Fields, TSpaceId> {
  const refs = {} as Record<string, TargetFieldRef>;
  for (const [fieldName, fieldBuilder] of Object.entries(fields)) {
    const physicalColumn =
      crossSpaceCoordinate !== undefined ? fieldBuilder.physicalColumnName : undefined;
    refs[fieldName] = {
      kind: 'targetFieldRef',
      source: 'token',
      modelName,
      fieldName,
      ...(crossSpaceCoordinate !== undefined
        ? {
            spaceId: crossSpaceCoordinate.spaceId,
            ...(crossSpaceCoordinate.namespaceId !== undefined
              ? { namespaceId: crossSpaceCoordinate.namespaceId }
              : {}),
            ...(crossSpaceCoordinate.tableName !== undefined
              ? { tableName: crossSpaceCoordinate.tableName }
              : {}),
            ...(physicalColumn !== undefined ? { columnName: physicalColumn } : {}),
          }
        : {}),
    };
  }
  return refs as ModelTokenRefs<ModelName, Fields, TSpaceId>;
}

type StageInput<Context, Spec> = Spec | ((context: Context) => Spec);

function buildStageSpec<Context, Spec>(
  stageInput: StageInput<Context, Spec>,
  context: Context,
): Spec {
  if (typeof stageInput === 'function') {
    return (stageInput as (context: Context) => Spec)(context);
  }
  return stageInput;
}

function createAttributeConstraintsDsl(): AttributeContext<
  Record<string, ScalarFieldBuilder>
>['constraints'] {
  const constraints = createConstraintsDsl();
  return {
    id: constraints.id,
    unique: constraints.unique,
  };
}

function createSqlConstraintsDsl<
  IndexTypes extends IndexTypeMap = Record<never, never>,
>(): SqlContext<Record<string, ScalarFieldBuilder>, IndexTypes>['constraints'] {
  const constraints = createConstraintsDsl<IndexTypes>();
  return {
    index: constraints.index,
    foreignKey: constraints.foreignKey,
    ref: constraints.ref,
  };
}

function createColumnRefs<Fields extends Record<string, ScalarFieldBuilder>>(
  fields: Fields,
): SqlContext<Fields>['cols'] {
  return createFieldRefs(fields);
}

type StaticLiteralName<Name> = Name extends string ? (string extends Name ? never : Name) : never;

type NamedConstraintLiteralName<Constraint> = Constraint extends { readonly name?: infer Name }
  ? StaticLiteralName<Name>
  : never;

type DuplicateLiteralNames<
  Items extends readonly unknown[],
  Seen extends string = never,
  Duplicates extends string = never,
> = Items extends readonly [infer First, ...infer Rest extends readonly unknown[]]
  ? NamedConstraintLiteralName<First> extends infer Name extends string
    ? Name extends Seen
      ? DuplicateLiteralNames<Rest, Seen, Duplicates | Name>
      : DuplicateLiteralNames<Rest, Seen | Name, Duplicates>
    : DuplicateLiteralNames<Rest, Seen, Duplicates>
  : Duplicates;

type InlineIdLiteralName<Fields extends Record<string, ScalarFieldBuilder>> = {
  readonly [FieldName in keyof Fields]: FieldStateOf<Fields[FieldName]> extends {
    readonly id: { readonly name?: infer Name };
  }
    ? StaticLiteralName<Name>
    : never;
}[keyof Fields];

type AttributeIdLiteralName<AttributesSpec extends ModelAttributesSpec | undefined> =
  AttributesSpec extends {
    readonly id?: { readonly name?: infer Name };
  }
    ? StaticLiteralName<Name>
    : never;

type ModelIdLiteralName<
  Fields extends Record<string, ScalarFieldBuilder>,
  AttributesSpec extends ModelAttributesSpec | undefined,
> = [AttributeIdLiteralName<AttributesSpec>] extends [never]
  ? InlineIdLiteralName<Fields>
  : AttributeIdLiteralName<AttributesSpec>;

type SqlIndexes<SqlSpec extends SqlStageSpec> = SqlSpec extends {
  readonly indexes?: infer Indexes extends readonly unknown[];
}
  ? Indexes
  : readonly [];

type SqlForeignKeys<SqlSpec extends SqlStageSpec> = SqlSpec extends {
  readonly foreignKeys?: infer ForeignKeys extends readonly unknown[];
}
  ? ForeignKeys
  : readonly [];

type SqlNamedObjects<SqlSpec extends SqlStageSpec> = [
  ...SqlIndexes<SqlSpec>,
  ...SqlForeignKeys<SqlSpec>,
];

type ValidateSqlStageSpec<
  Fields extends Record<string, ScalarFieldBuilder>,
  AttributesSpec extends ModelAttributesSpec | undefined,
  SqlSpec extends SqlStageSpec,
> = [DuplicateLiteralNames<SqlNamedObjects<SqlSpec>>] extends [never]
  ? [
      Extract<
        ModelIdLiteralName<Fields, AttributesSpec>,
        NamedConstraintLiteralName<SqlNamedObjects<SqlSpec>[number]>
      >,
    ] extends [never]
    ? SqlSpec
    : never
  : never;

type ValidateAttributesStageSpec<
  Fields extends Record<string, ScalarFieldBuilder>,
  SqlSpec extends SqlStageSpec | undefined,
  AttributesSpec extends ModelAttributesSpec,
> = SqlSpec extends SqlStageSpec
  ? [
      Extract<
        ModelIdLiteralName<Fields, AttributesSpec>,
        NamedConstraintLiteralName<SqlNamedObjects<SqlSpec>[number]>
      >,
    ] extends [never]
    ? AttributesSpec
    : never
  : AttributesSpec;

function findDuplicateRelationName(
  existingRelations: Record<string, AnyRelationBuilder>,
  nextRelations: Record<string, AnyRelationBuilder>,
): string | undefined {
  return Object.keys(nextRelations).find((relationName) =>
    Object.hasOwn(existingRelations, relationName),
  );
}

export class ContractModelBuilder<
  ModelName extends string | undefined,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
  AttributesSpec extends ModelAttributesSpec | undefined = undefined,
  SqlSpec extends SqlStageSpec | undefined = undefined,
  IndexTypes extends IndexTypeMap = Record<never, never>,
  TSpaceId extends string = '<self>',
> {
  declare readonly __name: ModelName;
  declare readonly __fields: Fields;
  declare readonly __relations: Relations;
  declare readonly __attributes: AttributesSpec;
  declare readonly __sql: SqlSpec;
  declare readonly __indexTypes: IndexTypes;
  declare readonly __spaceId: TSpaceId;
  readonly refs: ModelName extends string ? ModelTokenRefs<ModelName, Fields, TSpaceId> : never;

  constructor(
    readonly stageOne: {
      readonly modelName?: ModelName;
      readonly namespace?: string;
      readonly fields: Fields;
      readonly relations: Relations;
    },
    readonly attributesFactory?: StageInput<AttributeContext<Fields>, AttributesSpec>,
    readonly sqlFactory?: StageInput<SqlContext<Fields, IndexTypes>, SqlSpec>,
    readonly spaceId?: TSpaceId,
    readonly tableName?: string,
  ) {
    const crossSpaceCoordinate =
      spaceId !== undefined
        ? {
            spaceId,
            ...(stageOne.namespace !== undefined ? { namespaceId: stageOne.namespace } : {}),
            ...(tableName !== undefined ? { tableName } : {}),
          }
        : undefined;
    this.refs = blindCast<
      ModelName extends string ? ModelTokenRefs<ModelName, Fields, TSpaceId> : never,
      'conditional generic: stageOne.modelName presence matches ModelName extends string'
    >(
      stageOne.modelName
        ? createModelTokenRefs(stageOne.modelName, stageOne.fields, crossSpaceCoordinate)
        : undefined,
    );
  }

  ref<FieldName extends keyof Fields & string>(
    this: ModelName extends string
      ? ContractModelBuilder<ModelName, Fields, Relations, AttributesSpec, SqlSpec, IndexTypes>
      : never,
    fieldName: FieldName,
  ): TargetFieldRef<ModelName & string, FieldName> {
    const modelName = this.stageOne.modelName;
    if (!modelName) {
      throw contractError(
        'CONTRACT.MODEL_TOKEN_INVALID',
        'Model tokens require model("ModelName", ...) before calling .ref(...)',
      );
    }

    return {
      kind: 'targetFieldRef',
      source: 'token',
      modelName,
      fieldName,
    } as TargetFieldRef<ModelName & string, FieldName>;
  }

  relations<const NextRelations extends Record<string, AnyRelationBuilder>>(
    relations: NextRelations,
  ): ContractModelBuilder<
    ModelName,
    Fields,
    Relations & NextRelations,
    AttributesSpec,
    SqlSpec,
    IndexTypes,
    TSpaceId
  > {
    const duplicateRelationName = findDuplicateRelationName(this.stageOne.relations, relations);
    if (duplicateRelationName) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Model "${this.stageOne.modelName ?? '<anonymous>'}" already defines relation "${duplicateRelationName}".`,
        {
          meta: {
            kind: 'relation',
            name: duplicateRelationName,
            modelName: this.stageOne.modelName,
          },
        },
      );
    }

    return new ContractModelBuilder(
      {
        ...this.stageOne,
        relations: {
          ...this.stageOne.relations,
          ...relations,
        } as Relations & NextRelations,
      },
      this.attributesFactory,
      this.sqlFactory,
      this.spaceId,
      this.tableName,
    );
  }

  attributes<const NextAttributesSpec extends ModelAttributesSpec>(
    specOrFactory: StageInput<
      AttributeContext<Fields>,
      ValidateAttributesStageSpec<Fields, SqlSpec, NextAttributesSpec>
    >,
  ): ContractModelBuilder<
    ModelName,
    Fields,
    Relations,
    NextAttributesSpec,
    SqlSpec,
    IndexTypes,
    TSpaceId
  > {
    return new ContractModelBuilder(
      this.stageOne,
      specOrFactory,
      this.sqlFactory,
      this.spaceId,
      this.tableName,
    );
  }

  sql<const NextSqlSpec extends SqlStageSpec>(
    specOrFactory: StageInput<SqlContext<Fields, IndexTypes>, NextSqlSpec>,
  ): [ValidateSqlStageSpec<Fields, AttributesSpec, NextSqlSpec>] extends [never]
    ? ContractModelBuilder<
        ModelName,
        Fields,
        Relations,
        AttributesSpec,
        never,
        IndexTypes,
        TSpaceId
      >
    : ContractModelBuilder<
        ModelName,
        Fields,
        Relations,
        AttributesSpec,
        NextSqlSpec,
        IndexTypes,
        TSpaceId
      > {
    // Conditional return type cannot be verified by the implementation; the runtime value is always a valid ContractModelBuilder regardless of the validation outcome (validation is type-level only).
    // When specOrFactory is a static object (not a function), extract tableName for the cross-space coordinate.
    const nextTableName =
      typeof specOrFactory !== 'function' ? specOrFactory.table : this.tableName;
    return blindCast<
      never,
      'conditional return type; runtime value is always a valid ContractModelBuilder'
    >(
      new ContractModelBuilder(
        this.stageOne,
        this.attributesFactory,
        specOrFactory,
        this.spaceId,
        nextTableName,
      ),
    );
  }

  buildAttributesSpec(): AttributesSpec {
    if (!this.attributesFactory) {
      return undefined as AttributesSpec;
    }

    return buildStageSpec(this.attributesFactory, {
      fields: createFieldRefs(this.stageOne.fields),
      constraints: createAttributeConstraintsDsl() as AttributeContext<Fields>['constraints'],
    });
  }

  buildSqlSpec(): SqlSpec {
    if (!this.sqlFactory) {
      return undefined as SqlSpec;
    }
    return buildStageSpec(this.sqlFactory, {
      cols: createColumnRefs(this.stageOne.fields),
      constraints: createSqlConstraintsDsl<IndexTypes>(),
    });
  }
}

type NamedModelTokenShape<
  ModelName extends string = string,
  Fields extends Record<string, ScalarFieldBuilder> = Record<string, ScalarFieldBuilder>,
> = {
  readonly stageOne: {
    readonly modelName?: ModelName;
    readonly fields: Fields;
  };
};

type AnyNamedModelToken = NamedModelTokenShape<string, Record<string, ScalarFieldBuilder>>;

type LazyNamedModelToken<Token extends AnyNamedModelToken = AnyNamedModelToken> = () => Token;

type RelationFieldSelection<FieldName extends string> = FieldName | readonly FieldName[];

type RelationModelName<Target> =
  Target extends NamedModelTokenShape<
    infer ModelName extends string,
    Record<string, ScalarFieldBuilder>
  >
    ? ModelName
    : Target extends () => infer Token
      ? RelationModelName<Token>
      : never;

type RelationModelFieldNames<Target> =
  Target extends NamedModelTokenShape<string, infer Fields>
    ? keyof Fields & string
    : Target extends () => infer Token
      ? RelationModelFieldNames<Token>
      : never;

function isLazyRelationModelName(value: unknown): value is LazyRelationModelName<string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    (value as { kind?: unknown }).kind === 'lazyRelationModelName' &&
    'resolve' in value &&
    typeof (value as { resolve?: unknown }).resolve === 'function'
  );
}

function resolveNamedModelTokenName(token: {
  readonly stageOne: {
    readonly modelName?: string | undefined;
  };
}): string {
  const modelName = token.stageOne.modelName;
  if (!modelName) {
    throw contractError(
      'CONTRACT.MODEL_TOKEN_INVALID',
      'Relation targets require named model tokens. Use model("ModelName", ...) before passing a token to rel.*(...).',
    );
  }
  return modelName;
}

function normalizeRelationModelSource<Token extends AnyNamedModelToken>(
  target: Token | LazyNamedModelToken<Token>,
): RelationModelSource<RelationModelName<Token>>;
function normalizeRelationModelSource<ToModel extends string>(
  target: ToModel,
): RelationModelSource<ToModel>;
function normalizeRelationModelSource(
  target: string | AnyNamedModelToken | LazyNamedModelToken,
): RelationModelSource<string>;
function normalizeRelationModelSource(
  target: string | AnyNamedModelToken | LazyNamedModelToken,
): RelationModelSource<string> {
  if (typeof target === 'string') {
    return {
      kind: 'relationModelName',
      source: 'string',
      modelName: target,
    };
  }

  if (typeof target === 'function') {
    return {
      kind: 'lazyRelationModelName',
      source: 'lazyToken',
      resolve: () => resolveNamedModelTokenName(target()),
    };
  }

  return {
    kind: 'relationModelName',
    source: 'token',
    modelName: resolveNamedModelTokenName(target),
  };
}

export type ContractInput<
  Family extends FamilyPackRef<string> = FamilyPackRef<string>,
  Target extends TargetPackRef<'sql', string> = TargetPackRef<'sql', string>,
  Types extends Record<string, StorageTypeInstance> = Record<never, never>,
  Models extends Record<
    string,
    ContractModelBuilder<
      string | undefined,
      Record<string, ScalarFieldBuilder>,
      Record<string, AnyRelationBuilder>,
      ModelAttributesSpec | undefined,
      SqlStageSpec | undefined
    >
  > = Record<never, never>,
  Extensions extends Record<string, ExtensionPackRef<'sql', string>> | undefined = undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensions?: Extensions;
  readonly naming?: NamingConfig;
  readonly storageHash?: string;
  readonly foreignKeyDefaults?: ForeignKeyDefaultsState;
  readonly defaultControlPolicy?: ControlPolicy;
  /**
   * Declared namespace coordinates the contract recognises. Per-model
   * `namespace` references must reference an entry in this list (or the
   * Postgres-specific late-binding keyword `unbound`). Reserved values:
   *
   * - `__unbound__` — IR sentinel for the late-binding slot.
   * - `__unspecified__` — parser-synthesised AST bucket for top-level
   *   declarations (not a real namespace).
   * - `unbound` — Postgres-specific reserved keyword (the PSL surface
   *   uses `namespace unbound { … }` to opt into late binding).
   *
   * SQLite contracts must declare an empty list (or omit the field) —
   * SQLite has no schema concept and emits unqualified DDL.
   *
   * Populates `SqlStorage.namespaces` together with the
   * {@link ContractInput.createNamespace} factory: each declared name
   * (plus the framework-reserved `UNBOUND_NAMESPACE_ID` sentinel) is
   * resolved through `createNamespace` and stored as the matching slot
   * value. Models reference declared namespaces via their per-model
   * `namespace` coordinate; entries that go unreferenced still occupy a
   * slot so contracts that pre-declare schemas surface them on the live
   * storage walk.
   */
  readonly namespaces?: readonly string[];
  /**
   * Target-supplied factory that materialises a `SqlNamespaceBase` concretion
   * for a declared namespace coordinate. The SQL family layer is
   * target-agnostic and cannot import concretions like
   * `PostgresSchema` or `SqliteUnboundDatabase`; the factory is the
   * seam by which target packs hand the family the right runtime
   * representation.
   *
   * Called once per distinct namespace id discovered in the contract:
   * each entry of {@link ContractInput.namespaces}, every
   * `StorageTable.namespaceId` referenced by a model, and the
   * framework `UNBOUND_NAMESPACE_ID` sentinel (always present so the
   * late-bound slot stays available regardless of authoring choices).
   */
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly types?: Types;
  readonly models?: Models;
  readonly codecLookup?: CodecLookup;
  /**
   * Domain enum handles authored via `enumType()`. Each handle lowers to a
   * domain `enum` entry and a storage `valueSet` entry in the target's
   * default namespace. Fields reference the enum via `field.namedType(handle)`.
   */
  readonly enums?: Record<string, import('./enum-type').EnumTypeHandle>;
  /**
   * Author-declared pack-entity handles, lowered by the pack that registered
   * each handle's `entityKind` (through the SQL-family batch lowering hook)
   * into namespace-scoped entry attachments at build time. Generic on
   * purpose — neither this type nor the walk names a specific kind; a handle
   * whose kind no composed pack registers is a build error. This is the only
   * public channel for attaching pack entities.
   */
  readonly entities?: readonly import('@internal/sql-contract/entity-handle-lowering-hook').PackEntityHandle[];
};

export function model<
  const ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
>(
  modelName: ModelName,
  input: {
    readonly fields: Fields;
    readonly relations?: Relations;
    readonly namespace?: string;
  },
): ContractModelBuilder<ModelName, Fields, Relations>;

export function model<
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
>(input: {
  readonly fields: Fields;
  readonly relations?: Relations;
  readonly namespace?: string;
}): ContractModelBuilder<undefined, Fields, Relations>;

export function model<
  const ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<never, never>,
>(
  modelNameOrInput:
    | ModelName
    | {
        readonly fields: Fields;
        readonly relations?: Relations;
        readonly namespace?: string;
      },
  maybeInput?: {
    readonly fields: Fields;
    readonly relations?: Relations;
    readonly namespace?: string;
  },
): ContractModelBuilder<ModelName | undefined, Fields, Relations> {
  const input = typeof modelNameOrInput === 'string' ? maybeInput : modelNameOrInput;

  if (!input) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      'model("ModelName", ...) requires a model definition.',
    );
  }

  return new ContractModelBuilder({
    ...(typeof modelNameOrInput === 'string' ? { modelName: modelNameOrInput } : {}),
    ...(input.namespace !== undefined ? { namespace: input.namespace } : {}),
    fields: input.fields,
    relations: (input.relations ?? {}) as Relations,
  });
}

/**
 * Factory for building a standalone branded extension model handle.
 *
 * Use this instead of `new ContractModelBuilder(…)` when constructing handles
 * for models that live in a foreign contract space (e.g. a Supabase extension
 * model referenced by a user's contract). The `spaceId` brands the returned
 * handle so `refs.<field>.spaceId` carries the foreign space identifier.
 *
 * @param name - The domain model name as declared in the foreign contract
 *   (e.g. `'AuthUser'`, not a bare table alias like `'User'`).
 * @param input.namespace - The namespace within the foreign space (e.g. `'auth'`).
 * @param input.fields - Field definitions (use `field.column(…)`).
 * @param input.table - The physical table name in the foreign schema.
 * @param spaceId - The extension space identifier (e.g. `'supabase'`).
 */
export function extensionModel<
  const ModelName extends string,
  Fields extends Record<string, ScalarFieldBuilder>,
  const TSpaceId extends string,
>(
  name: ModelName,
  input: {
    readonly namespace: string;
    readonly fields: Fields;
    readonly table: string;
  },
  spaceId: TSpaceId,
): ContractModelBuilder<
  ModelName,
  Fields,
  Record<never, never>,
  undefined,
  undefined,
  Record<never, never>,
  TSpaceId
> {
  const builder = new ContractModelBuilder<
    ModelName,
    Fields,
    Record<never, never>,
    undefined,
    undefined,
    Record<never, never>,
    TSpaceId
  >(
    { modelName: name, namespace: input.namespace, fields: input.fields, relations: {} },
    undefined,
    undefined,
    spaceId,
    input.table,
  );
  return builder;
}

/**
 * Narrow shape for detecting a cross-space branded model handle at runtime.
 * `ContractModelBuilder` exposes these fields but `AnyNamedModelToken` does
 * not declare them; this guard bridges the gap without a bare cast.
 */
type CrossSpaceHandle = {
  readonly spaceId: string;
  readonly tableName?: string;
  readonly stageOne: { readonly namespace?: string };
};

export function isCrossSpaceHandle(value: unknown): value is CrossSpaceHandle {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const rec = blindCast<
    Record<PropertyKey, unknown>,
    'object null-check above; property access needed for runtime shape detection'
  >(value);
  return (
    typeof rec['spaceId'] === 'string' &&
    typeof rec['stageOne'] === 'object' &&
    rec['stageOne'] !== null
  );
}

function belongsTo<
  Token extends AnyNamedModelToken,
  FromField extends string | readonly string[],
  ToField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly from: FromField; readonly to: ToField; readonly optional?: boolean },
): RelationBuilder<BelongsToRelation<RelationModelName<Token>, FromField, ToField>>;
function belongsTo<
  ToModel extends string,
  FromField extends string | readonly string[],
  ToField extends string | readonly string[],
>(
  toModel: ToModel,
  options: { readonly from: FromField; readonly to: ToField; readonly optional?: boolean },
): RelationBuilder<BelongsToRelation<ToModel, FromField, ToField>>;
function belongsTo(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: {
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
    readonly optional?: boolean;
  },
): RelationBuilder<BelongsToRelation> {
  // F-lazy: when the model is a lazy thunk (() => handle), resolve it before
  // the brand check so cross-space handles passed as lazy tokens are detected.
  // normalizeRelationModelSource still receives the original toModel (which
  // handles both lazy and non-lazy forms correctly for model-name resolution).
  const resolvedModel = typeof toModel === 'function' ? toModel() : toModel;

  // Extract cross-space brand from the handle when it carries a spaceId.
  // ContractModelBuilder exposes spaceId/tableName at runtime even though
  // the AnyNamedModelToken interface does not declare them.
  const crossSpaceCoordinate = isCrossSpaceHandle(resolvedModel)
    ? {
        spaceId: resolvedModel.spaceId,
        ...(resolvedModel.tableName !== undefined ? { tableName: resolvedModel.tableName } : {}),
        ...(resolvedModel.stageOne.namespace !== undefined
          ? { namespaceId: resolvedModel.stageOne.namespace }
          : {}),
      }
    : undefined;

  return new RelationBuilder({
    kind: 'belongsTo',
    toModel: normalizeRelationModelSource(toModel),
    from: options.from,
    to: options.to,
    ...ifDefined('optional', options.optional),
    ...(crossSpaceCoordinate !== undefined ? crossSpaceCoordinate : {}),
  });
}

function hasMany<
  Token extends AnyNamedModelToken,
  ByField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly by: ByField },
): RelationBuilder<HasManyRelation<RelationModelName<Token>, ByField>>;
function hasMany<ToModel extends string, ByField extends string | readonly string[]>(
  toModel: ToModel,
  options: { readonly by: ByField },
): RelationBuilder<HasManyRelation<ToModel, ByField>>;
function hasMany(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: { readonly by: string | readonly string[] },
): RelationBuilder<HasManyRelation> {
  return new RelationBuilder({
    kind: 'hasMany',
    toModel: normalizeRelationModelSource(toModel),
    by: options.by,
  });
}

function hasOne<
  Token extends AnyNamedModelToken,
  ByField extends RelationFieldSelection<RelationModelFieldNames<Token>>,
>(
  toModel: Token | LazyNamedModelToken<Token>,
  options: { readonly by: ByField },
): RelationBuilder<HasOneRelation<RelationModelName<Token>, ByField>>;
function hasOne<ToModel extends string, ByField extends string | readonly string[]>(
  toModel: ToModel,
  options: { readonly by: ByField },
): RelationBuilder<HasOneRelation<ToModel, ByField>>;
function hasOne(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: { readonly by: string | readonly string[] },
): RelationBuilder<HasOneRelation> {
  return new RelationBuilder({
    kind: 'hasOne',
    toModel: normalizeRelationModelSource(toModel),
    by: options.by,
  });
}

function manyToMany<
  ToToken extends AnyNamedModelToken,
  ThroughToken extends AnyNamedModelToken,
  FromField extends RelationFieldSelection<RelationModelFieldNames<ThroughToken>>,
  ToField extends RelationFieldSelection<RelationModelFieldNames<ThroughToken>>,
>(
  toModel: ToToken | LazyNamedModelToken<ToToken>,
  options: {
    readonly through: ThroughToken | LazyNamedModelToken<ThroughToken>;
    readonly from: FromField;
    readonly to: ToField;
  },
): RelationBuilder<
  ManyToManyRelation<
    RelationModelName<ToToken>,
    RelationModelName<ThroughToken>,
    FromField,
    ToField
  >
>;
function manyToMany<
  ToModel extends string,
  ThroughModel extends string,
  FromField extends string | readonly string[],
  ToField extends string | readonly string[],
>(
  toModel: ToModel,
  options: {
    readonly through: ThroughModel;
    readonly from: FromField;
    readonly to: ToField;
  },
): RelationBuilder<ManyToManyRelation<ToModel, ThroughModel, FromField, ToField>>;
function manyToMany(
  toModel: string | AnyNamedModelToken | LazyNamedModelToken,
  options: {
    readonly through: string | AnyNamedModelToken | LazyNamedModelToken;
    readonly from: string | readonly string[];
    readonly to: string | readonly string[];
  },
): RelationBuilder<ManyToManyRelation> {
  return new RelationBuilder({
    kind: 'manyToMany',
    toModel: normalizeRelationModelSource(toModel),
    through: normalizeRelationModelSource(options.through),
    from: options.from,
    to: options.to,
  });
}

export const rel = {
  belongsTo,
  hasMany,
  hasOne,
  manyToMany,
};

export const field = {
  column: columnField,
  generated: generatedField,
  namedType: namedTypeField,
};

export function isContractInput(value: unknown): value is ContractInput {
  if (typeof value !== 'object' || value === null || !('target' in value) || !('family' in value)) {
    return false;
  }
  const target = (value as { target: unknown }).target;
  const family = (value as { family: unknown }).family;
  return (
    typeof target === 'object' &&
    target !== null &&
    'kind' in target &&
    target.kind === 'target' &&
    typeof family === 'object' &&
    family !== null &&
    'kind' in family &&
    family.kind === 'family'
  );
}

function isRelationFieldArray(value: string | readonly string[]): value is readonly string[] {
  return Array.isArray(value);
}

export function normalizeRelationFieldNames(value: string | readonly string[]): readonly string[] {
  if (isRelationFieldArray(value)) {
    return value;
  }
  return [value];
}

export function resolveRelationModelName(value: RelationModelSource<string>): string {
  if (isLazyRelationModelName(value)) {
    return value.resolve();
  }
  return value.modelName;
}

export function applyNaming(name: string, strategy: NamingStrategy | undefined): string {
  if (!strategy || strategy === 'identity') {
    return name;
  }

  let result = '';
  for (let index = 0; index < name.length; index += 1) {
    const char = name[index];
    if (!char) continue;
    const lower = char.toLowerCase();
    const isUpper = char !== lower;
    if (isUpper && index > 0) {
      const prev = name[index - 1];
      const next = name[index + 1];
      const prevIsLower = !!prev && prev === prev.toLowerCase();
      const nextIsLower = !!next && next === next.toLowerCase();
      if (prevIsLower || nextIsLower) {
        result += '_';
      }
    }
    result += lower;
  }
  return result;
}

export type FieldStateOf<T> = T extends ScalarFieldBuilder<infer State> ? State : never;
export type RelationStateOf<T> = T extends RelationBuilder<infer State> ? State : never;

export type ModelFieldsOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    infer Fields,
    Record<string, AnyRelationBuilder>,
    ModelAttributesSpec | undefined,
    SqlStageSpec | undefined
  >
    ? Fields
    : never;

export type ModelRelationsOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    infer Relations,
    ModelAttributesSpec | undefined,
    SqlStageSpec | undefined
  >
    ? Relations
    : never;

export type ModelAttributesOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    infer AttributesSpec,
    SqlStageSpec | undefined
  >
    ? AttributesSpec
    : undefined;

export type ModelSqlOf<T> =
  T extends ContractModelBuilder<
    string | undefined,
    Record<string, ScalarFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    ModelAttributesSpec | undefined,
    infer SqlSpec
  >
    ? SqlSpec
    : undefined;

export type IdFieldNames<T> =
  T extends IdConstraint<infer FieldNames> ? FieldNames : readonly string[];

export type AttributeStageIdFieldNames<T> = T extends { readonly id?: infer I }
  ? I extends IdConstraint
    ? IdFieldNames<I>
    : undefined
  : undefined;
