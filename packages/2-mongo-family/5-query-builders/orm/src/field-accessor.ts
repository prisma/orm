import type {
  ContractField,
  ContractValueObject,
  ContractValueObjectDefinitions,
} from '@internal/contract/types';
import type {
  AnyMongoTypeMaps,
  ExtractMongoCodecTypes,
  InferModelRow,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelsMap,
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
    readonly type: { readonly kind: 'valueObject'; readonly name: string };
  }
    ? K
    : never;
}[keyof MongoModelsMap<TContract>[ModelName]['fields'] & string];

type ResolvedModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = InferModelRow<TContract, ModelName>;

type ResolveFieldType<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  K extends keyof MongoModelsMap<TContract>[ModelName]['fields'] & string,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
  readonly type: {
    readonly kind: 'scalar';
    readonly codecId: infer CId extends string & keyof TCodecTypes;
  };
  readonly many: true;
  readonly nullable: true;
}
  ? readonly TCodecTypes[CId]['output'][] | null
  : MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: infer CId extends string & keyof TCodecTypes;
        };
        readonly many: true;
      }
    ? readonly TCodecTypes[CId]['output'][]
    : MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
          readonly type: {
            readonly kind: 'scalar';
            readonly codecId: infer CId extends string & keyof TCodecTypes;
          };
          readonly nullable: true;
        }
      ? TCodecTypes[CId]['output'] | null
      : MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
            readonly type: {
              readonly kind: 'scalar';
              readonly codecId: infer CId extends string & keyof TCodecTypes;
            };
          }
        ? TCodecTypes[CId]['output']
        : K extends keyof ResolvedModelRow<TContract, ModelName>
          ? ResolvedModelRow<TContract, ModelName>[K]
          : unknown;

type NumericOps = {
  inc(value: number): FieldOperation;
  mul(value: number): FieldOperation;
};

export type FieldExpression<T = unknown> = {
  set(value: T): FieldOperation;
  unset(): FieldOperation;
  push(value: T extends readonly (infer E)[] ? E : unknown): FieldOperation;
  pull(match: T extends readonly (infer E)[] ? E | Partial<E> : unknown): FieldOperation;
  addToSet(value: T extends readonly (infer E)[] ? E : unknown): FieldOperation;
  pop(end: 1 | -1): FieldOperation;
} & ([NonNullable<T>] extends [never]
  ? unknown
  : NonNullable<T> extends number
    ? NumericOps
    : unknown);

type HasValueObjects = MongoContract;

type MergedContractValueObjects<TContract extends HasValueObjects> =
  ContractValueObjectDefinitions<TContract> &
    (TContract extends { readonly valueObjects?: infer VOs }
      ? VOs extends Record<string, ContractValueObject>
        ? VOs
        : Record<string, never>
      : Record<string, never>);

type VOFields<
  TContract extends HasValueObjects,
  VOName extends string,
> = VOName extends keyof MergedContractValueObjects<TContract>
  ? MergedContractValueObjects<TContract>[VOName] extends {
      readonly fields: infer F extends Record<string, ContractField>;
    }
    ? F
    : never
  : never;

type VOScalarFieldKeys<Fields extends Record<string, ContractField>> = {
  [K in keyof Fields & string]: Fields[K] extends { readonly type: { readonly kind: 'scalar' } }
    ? K
    : never;
}[keyof Fields & string];

type VOValueObjectFieldKeys<Fields extends Record<string, ContractField>> = {
  [K in keyof Fields & string]: Fields[K] extends {
    readonly type: { readonly kind: 'valueObject'; readonly name: string };
  }
    ? K
    : never;
}[keyof Fields & string];

type VODotPaths<
  TContract extends HasValueObjects,
  Fields extends Record<string, ContractField>,
  Prefix extends string,
> =
  | { [K in VOScalarFieldKeys<Fields>]: `${Prefix}${K}` }[VOScalarFieldKeys<Fields>]
  | {
      [K in VOValueObjectFieldKeys<Fields>]: Fields[K] extends {
        readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
      }
        ? VODotPaths<TContract, VOFields<TContract, N>, `${Prefix}${K}.`>
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
    readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
  }
    ? VODotPaths<TContract, VOFields<TContract, N>, `${K}.`>
    : never;
}[ValueObjectFieldKeys<TContract, ModelName>];

type ResolveDotPathInFields<
  TContract extends HasValueObjects,
  Fields extends Record<string, ContractField>,
  Path extends string,
  TCodecTypes extends Record<string, { output: unknown }>,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof Fields & string
    ? Fields[Head] extends {
        readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
      }
      ? ResolveDotPathInFields<TContract, VOFields<TContract, N>, Rest, TCodecTypes>
      : never
    : never
  : Path extends keyof Fields & string
    ? Fields[Path] extends {
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: infer CId extends string & keyof TCodecTypes;
        };
      }
      ? TCodecTypes[CId]['output']
      : unknown
    : never;

export type ResolveDotPathType<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  Path extends string,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = Path extends `${infer Head}.${infer Rest}`
  ? Head extends keyof MongoModelsMap<TContract>[ModelName]['fields'] & string
    ? MongoModelsMap<TContract>[ModelName]['fields'][Head] extends {
        readonly type: { readonly kind: 'valueObject'; readonly name: infer N extends string };
      }
      ? ResolveDotPathInFields<TContract, VOFields<TContract, N>, Rest, TCodecTypes>
      : never
    : never
  : never;

export type FieldAccessor<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  readonly [K in ScalarFieldKeys<TContract, ModelName>]: FieldExpression<
    ResolveFieldType<TContract, ModelName, K, TCodecTypes>
  >;
} & {
  readonly [K in ValueObjectFieldKeys<TContract, ModelName>]: FieldExpression<
    ResolveFieldType<TContract, ModelName, K, TCodecTypes>
  >;
} & (<P extends DotPath<TContract, ModelName>>(
    path: P,
  ) => FieldExpression<ResolveDotPathType<TContract, ModelName, P, TCodecTypes>>);

// ── Runtime implementation ───────────────────────────────────────────────────

// Runtime expression has all methods; type-level gating happens via FieldExpression<T>
interface RuntimeFieldExpression extends NumericOps {
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
    inc(value: number): FieldOperation {
      return { operator: '$inc', field: fieldPath, value: new MongoParamRef(value) };
    },
    mul(value: number): FieldOperation {
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
): Record<string, Record<string, MongoValue>> {
  const grouped: Record<string, Record<string, MongoValue>> = {};
  for (const op of ops) {
    let group = grouped[op.operator];
    if (!group) {
      group = {};
      grouped[op.operator] = group;
    }
    group[op.field] = wrapValue(op.field, op.value, op.operator);
  }
  return grouped;
}
