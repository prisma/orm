import type {
  ContractField,
  ContractValueObjectAt,
  ValueObjectReference,
} from '@internal/contract/types';
import type {
  AnyMongoTypeMaps,
  ExtractMongoCodecTypes,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelsMap,
  MongoUnboundFieldInputTypes,
} from '@internal/mongo-contract';
import type { MongoValue } from '@internal/mongo-value';
import { MongoParamRef } from '@internal/mongo-value';

// ── Runtime types ────────────────────────────────────────────────────────────

export type UpdateOperator =
  | '$set'
  | '$unset'
  | '$inc'
  | '$mul'
  | '$push'
  | '$pull'
  | '$addToSet'
  | '$pop';

export interface FieldOperation {
  readonly operator: UpdateOperator;
  readonly field: string;
  readonly value: MongoValue;
}

// ── Compile-time types ───────────────────────────────────────────────────────

type ScalarFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in keyof MongoModelsMap<TContract>[ModelName]['fields'] &
    string]: MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
    readonly type: { readonly kind: 'scalar' };
  }
    ? K
    : never;
}[keyof MongoModelsMap<TContract>[ModelName]['fields'] & string];

type ValueObjectFieldKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in keyof MongoModelsMap<TContract>[ModelName]['fields'] &
    string]: MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
    readonly type: ValueObjectReference;
  }
    ? K
    : never;
}[keyof MongoModelsMap<TContract>[ModelName]['fields'] & string];

// The input row of a model: the type each field takes on write, from the contract's field input types.
type ModelInputRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string,
> = ModelName extends keyof MongoUnboundFieldInputTypes<TContract>
  ? MongoUnboundFieldInputTypes<TContract>[ModelName]
  : Record<never, never>;

type ResolveFieldType<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  K extends string,
> = K extends keyof ModelInputRow<TContract, ModelName>
  ? ModelInputRow<TContract, ModelName>[K]
  : unknown;

type NumericOps<Operand> = {
  inc(value: Operand): FieldOperation;
  mul(value: Operand): FieldOperation;
};

type NumericOperandOf<T> = [T] extends [number] ? number : [T] extends [bigint] ? bigint : never;

/**
 * The update operations on a field whose value is `T`. `inc` and `mul` exist when `NumericOperand` is not `never`, and take it as their operand; by default a `number` field takes a `number` and a `bigint` field a `bigint`.
 */
export type FieldExpression<T = unknown, NumericOperand = NumericOperandOf<T>> = {
  set(value: T): FieldOperation;
  unset(): FieldOperation;
  push(value: T extends readonly (infer E)[] ? E : unknown): FieldOperation;
  pull(match: T extends readonly (infer E)[] ? E | Partial<E> : unknown): FieldOperation;
  addToSet(value: T extends readonly (infer E)[] ? E : unknown): FieldOperation;
  pop(end: 1 | -1): FieldOperation;
} & ([NumericOperand] extends [never] ? unknown : NumericOps<NumericOperand>);

type VOFields<TContract extends MongoContract, Reference extends ValueObjectReference> =
  ContractValueObjectAt<TContract['storage'], Reference> extends {
    readonly fields: infer F extends Record<string, ContractField>;
  }
    ? F
    : never;

type VOScalarFieldKeys<Fields extends Record<string, ContractField>> = {
  [K in keyof Fields & string]: Fields[K] extends { readonly type: { readonly kind: 'scalar' } }
    ? K
    : never;
}[keyof Fields & string];

type VOValueObjectFieldKeys<Fields extends Record<string, ContractField>> = {
  [K in keyof Fields & string]: Fields[K] extends {
    readonly type: ValueObjectReference;
  }
    ? K
    : never;
}[keyof Fields & string];

/** A value object's storage coordinate as one string, so the value objects a path has entered form a union. */
type ValueObjectKey<Reference extends ValueObjectReference> =
  `${Reference['namespaceId']}.${Reference['entityName']}`;

/** The dot paths into a value object's fields. A path ends at a value object it has already entered, so a value object that contains itself gives finitely many paths. */
type VODotPaths<
  TContract extends MongoContract,
  Fields extends Record<string, ContractField>,
  Prefix extends string,
  Entered extends string,
> =
  | { [K in VOScalarFieldKeys<Fields>]: `${Prefix}${K}` }[VOScalarFieldKeys<Fields>]
  | {
      [K in VOValueObjectFieldKeys<Fields>]: Fields[K] extends {
        readonly type: infer Reference extends ValueObjectReference;
      }
        ? ValueObjectKey<Reference> extends Entered
          ? never
          : VODotPaths<
              TContract,
              VOFields<TContract, Reference>,
              `${Prefix}${K}.`,
              Entered | ValueObjectKey<Reference>
            >
        : never;
    }[VOValueObjectFieldKeys<Fields>];

export type DotPath<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in ValueObjectFieldKeys<
    TContract,
    ModelName
  >]: MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
    readonly type: infer Reference extends ValueObjectReference;
  }
    ? VODotPaths<TContract, VOFields<TContract, Reference>, `${K}.`, ValueObjectKey<Reference>>
    : never;
}[ValueObjectFieldKeys<TContract, ModelName>];

// One step of a dot path: the field `Key` of a value object, or of each element of a list of them.
type PathStep<Value, Key extends string> =
  NonNullable<Value> extends readonly (infer Element)[]
    ? PathStep<Element, Key>
    : Key extends keyof NonNullable<Value>
      ? NonNullable<Value>[Key]
      : never;

type ResolvePath<Value, Path extends string> = Path extends `${infer Head}.${infer Rest}`
  ? ResolvePath<PathStep<Value, Head>, Rest>
  : PathStep<Value, Path>;

/** The input type of the field a dot path into a value object names, read from the model's input row. */
export type ResolveDotPathType<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  Path extends string,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof ModelInputRow<TContract, ModelName>
    ? ResolvePath<ModelInputRow<TContract, ModelName>[Head], Rest>
    : never
  : never;

/**
 * The operand of `inc` and `mul` on a required, single-valued scalar field: the codec's input type when its codec has the `numeric` trait, or, for a codec map without traits, a `number` or `bigint` output. A codec entry typed `never` gives no operand.
 */
type ScalarNumericOperand<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  K extends keyof MongoModelsMap<TContract>[ModelName]['fields'] & string,
  TCodecTypes extends Record<string, { output: unknown }>,
> = MongoModelsMap<TContract>[ModelName]['fields'][K] extends
  | { readonly nullable: true }
  | { readonly many: { readonly elementNullable: boolean } }
  ? never
  : MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: infer CId extends string & keyof TCodecTypes;
        };
      }
    ? [TCodecTypes[CId]] extends [never]
      ? never
      : TCodecTypes[CId] extends { readonly traits: infer Traits; readonly input: infer Input }
        ? 'numeric' extends Traits
          ? Input
          : never
        : NumericOperandOf<TCodecTypes[CId]['output']>
    : never;

export type FieldAccessor<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  readonly [K in ScalarFieldKeys<TContract, ModelName>]: FieldExpression<
    ResolveFieldType<TContract, ModelName, K>,
    ScalarNumericOperand<TContract, ModelName, K, TCodecTypes>
  >;
} & {
  readonly [K in ValueObjectFieldKeys<TContract, ModelName>]: FieldExpression<
    ResolveFieldType<TContract, ModelName, K>
  >;
} & (<P extends DotPath<TContract, ModelName>>(
    path: P,
  ) => FieldExpression<ResolveDotPathType<TContract, ModelName, P>>);

// ── Runtime implementation ───────────────────────────────────────────────────

// Runtime expression has all methods; type-level gating happens via FieldExpression<T>
interface RuntimeFieldExpression extends NumericOps<unknown> {
  set(value: unknown): FieldOperation;
  unset(): FieldOperation;
  push(value: unknown): FieldOperation;
  pull(match: unknown): FieldOperation;
  addToSet(value: unknown): FieldOperation;
  pop(end: 1 | -1): FieldOperation;
}

function createFieldExpression(fieldPath: string): RuntimeFieldExpression {
  return {
    set(value: unknown): FieldOperation {
      return { operator: '$set', field: fieldPath, value: new MongoParamRef(value) };
    },
    unset(): FieldOperation {
      return { operator: '$unset', field: fieldPath, value: new MongoParamRef('') };
    },
    inc(value: unknown): FieldOperation {
      return { operator: '$inc', field: fieldPath, value: new MongoParamRef(value) };
    },
    mul(value: unknown): FieldOperation {
      return { operator: '$mul', field: fieldPath, value: new MongoParamRef(value) };
    },
    push(value: unknown): FieldOperation {
      return { operator: '$push', field: fieldPath, value: new MongoParamRef(value) };
    },
    pull(match: unknown): FieldOperation {
      return { operator: '$pull', field: fieldPath, value: new MongoParamRef(match) };
    },
    addToSet(value: unknown): FieldOperation {
      return { operator: '$addToSet', field: fieldPath, value: new MongoParamRef(value) };
    },
    pop(end: 1 | -1): FieldOperation {
      return { operator: '$pop', field: fieldPath, value: new MongoParamRef(end) };
    },
  };
}

export function createFieldAccessor<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
>(): FieldAccessor<TContract, ModelName, TCodecTypes> {
  return new Proxy((() => {}) as unknown as FieldAccessor<TContract, ModelName, TCodecTypes>, {
    get(_target, prop: string): RuntimeFieldExpression {
      return createFieldExpression(prop);
    },
    apply(_target, _thisArg, args: [string]): RuntimeFieldExpression {
      return createFieldExpression(args[0]);
    },
  });
}

export function compileFieldOperations(
  ops: readonly FieldOperation[],
  wrapValue: (field: string, value: MongoValue, operator: UpdateOperator) => MongoValue,
  storedPathOf: (field: string) => string = (field) => field,
): Record<string, Record<string, MongoValue>> {
  const grouped: Record<string, Record<string, MongoValue>> = {};
  for (const op of ops) {
    let group = grouped[op.operator];
    if (!group) {
      group = {};
      grouped[op.operator] = group;
    }
    group[storedPathOf(op.field)] = wrapValue(op.field, op.value, op.operator);
  }
  return grouped;
}
