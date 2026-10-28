/**
 * Data types, their values and casts.
 *
 * A data type is a stored type made first-class. It is owned by the pack that registers it, it
 * owns its values and the one form the contract stores for each, and it declares the casts that
 * say which other types' values it takes and how. A codec converts a value of one data type.
 *
 * Casts are declared by the type that receives, never by the source, so there is at most one cast
 * for any pair and the owner of a type is the only one who decides what it takes.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError, isInternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { type as arktype, type Type } from 'arktype';
import { canonicalizeJson } from '../utils/canonicalize-json';
import { DATA_TYPE_ID_PATTERN } from './data-type-id-pattern';
import { assertOneFrameworkCopy, registerFrameworkCopy } from './framework-copies';
import { refuseJsonValue } from './json-readers';
import { runtimeError } from './runtime-error';

registerFrameworkCopy();

/**
 * The identity of a data type: `owner/name`, with no version. A type's identity does not change;
 * what changes over time is a representation of it, which is a codec, and codec ids carry a
 * version. The two forms differ visibly so that one string never names both.
 */
export type DataTypeId = string & { readonly __dataTypeId: 'DataTypeId' };

/**
 * A pure function from the stored form of a value of the type it casts from to JSON the type that
 * declares it constructs its value from. It may throw a structured error for a value it cannot
 * convert.
 */
export type Cast = (value: JsonValue) => JsonValue;

/**
 * How a type whose single value holds several elements takes a written list: each element's type
 * must be one of `of`, `cast` receives the elements' stored forms in written order, and the type
 * constructs its value from what it returns.
 */
export interface ListCast {
  readonly of: readonly DataTypeId[];
  readonly cast: (elements: readonly JsonValue[]) => JsonValue;
}

/** A data type's parameters: an empty object for a type without any. */
export type DataTypeParams = Readonly<Record<string, unknown>>;

class DataTypeValueRecord<J extends JsonValue> {
  readonly #constructedByItsType = true;

  constructor(
    readonly type: DataTypeId,
    readonly params: DataTypeParams,
    readonly value: J,
  ) {
    Object.freeze(this);
  }

  static isConstructed(value: unknown): boolean {
    return (
      typeof value === 'object' &&
      value !== null &&
      #constructedByItsType in value &&
      value.#constructedByItsType
    );
  }
}

/**
 * A value of a data type: the type's id, the parameters it holds the value under, and `value`, the JSON form `contract.json` stores. Only a data type constructs one, through {@link DataType.fromContract} and {@link DataType.valueFrom}. ADR 254.
 */
export type DataTypeValue<J extends JsonValue = JsonValue> = DataTypeValueRecord<J>;

/** Reads JSON the type stores, under the type's parameters, and returns it; it refuses any other JSON, and a value the parameters exclude, with `refuseJsonValue`. */
export type DataTypeReader = (json: JsonValue, params: DataTypeParams) => JsonValue;

/** The one spelling of a value the reader accepted, under the column's parameters: the type's whole spelling step, whether or not parameters change it, as `pg/uuid` writes lower case and `numeric(10,2)` two fraction digits. A stored value in another spelling is refused, and a value a codec hands over is written in this one. */
export type DataTypeSpelling = (json: JsonValue, params: DataTypeParams) => JsonValue;

export interface DataType {
  readonly id: DataTypeId;
  /** An arktype object schema of the type's parameters. A type without one has no parameters. */
  readonly params?: Type<unknown>;
  /** Keyed by the id of the type each cast takes values of. */
  readonly casts: Readonly<Record<DataTypeId, Cast>>;
  readonly listCast?: ListCast;
  /** The value `json` stores under `params`. It refuses JSON the type does not store in that form, a value the parameters exclude, and JSON in a spelling other than the one the parameters give. A codec whose application value is the stored form builds its values here too. */
  fromContract(json: JsonValue, params: DataTypeParams): DataTypeValue;
  /** A value of the type built from `json`: read under `params`, which refuse a value they exclude, and written in the spelling they give. Every producer of a value that is not reading `contract.json` builds it here: a written default, a cast, and a codec, except a codec whose application value is the stored form, which builds it with `fromContract` so that only the stored spelling is taken. */
  valueFrom<J extends JsonValue>(json: J, params: DataTypeParams): DataTypeValue<J>;
  /** The JSON `contract.json` stores for `value`. */
  toContract(value: DataTypeValue): JsonValue;
  /** A key two stored forms share exactly when the type's equality holds them equal. Declared by a type whose equal values have more than one stored form, as `numeric` stores `0.5` and `0.50`; for every other type, values are equal when their stored forms are. */
  readonly equalityKey?: (json: JsonValue) => string;
}

export interface DataTypeSpec {
  readonly params?: Type<unknown>;
  readonly casts?: Readonly<Record<string, Cast>>;
  readonly listCast?: { readonly of: readonly string[]; readonly cast: ListCast['cast'] };
  /** Accepts every spelling of a value the type holds, and refuses anything else. */
  readonly read: DataTypeReader;
  /** Gives an accepted value its one spelling; a type whose values have one spelling only declares none. */
  readonly spell?: DataTypeSpelling;
  /** See {@link DataType.equalityKey}. */
  readonly equalityKey?: (json: JsonValue) => string;
  /** The one form of parameters that mean the same type, such as `numeric(10)` and `numeric(10,0)`; a value stores its parameters in it. A type whose parameters have one form only declares none. */
  normalize?(params: DataTypeParams): DataTypeParams;
}

/** The assembled types of one stack, by id. */
export interface DataTypeLookup {
  get(id: string): DataType | undefined;
  has(id: string): boolean;
}

/** Read `id` as a data type id, refusing anything that is not `owner/name` in lower case. */
export function dataTypeId(id: string): DataTypeId {
  if (!DATA_TYPE_ID_PATTERN.test(id)) {
    throw runtimeError(
      'CONTRACT.DATA_TYPE_ID_INVALID',
      `"${id}" is not a data type id. A data type id is "owner/name" in lower case and carries no version, as in "owner/name"; a versioned id names a codec.`,
      { id },
    );
  }
  return blindCast<DataTypeId, 'the pattern above is the whole of what a data type id is'>(id);
}

/** Declare a data type. Every id it names, its own and each cast's source, is validated here. */
export function dataType(id: string, spec: DataTypeSpec): DataType {
  const typeId = dataTypeId(id);
  const casts: Record<string, Cast> = {};
  for (const [source, cast] of Object.entries(spec.casts ?? {})) {
    casts[dataTypeId(source)] = cast;
  }
  const listCast = spec.listCast;
  const { read, spell, normalize } = spec;
  const construct = (json: JsonValue, params: DataTypeParams): DataTypeValue =>
    new DataTypeValueRecord(
      typeId,
      Object.freeze({ ...(normalize === undefined ? params : normalize(params)) }),
      json,
    );
  const spelledUnder = (json: JsonValue, params: DataTypeParams): JsonValue => {
    const accepted = read(json, params);
    return spell === undefined ? accepted : spell(accepted, params);
  };
  /** Whether `json` is already the spelling the type gives it without parameters, so that a difference under `params` is theirs. */
  const spelledWithoutParams = (json: JsonValue): boolean => {
    try {
      return canonicalizeJson(spelledUnder(json, {})) === canonicalizeJson(json);
    } catch (error) {
      if (isInternalError(error)) throw error;
      return false;
    }
  };
  const fromContract = (json: JsonValue, params: DataTypeParams): DataTypeValue => {
    const spelled = spelledUnder(json, params);
    if (canonicalizeJson(spelled) !== canonicalizeJson(json)) {
      return refuseJsonValue(
        typeId,
        Object.keys(params).length > 0 && spelledWithoutParams(json)
          ? `${JSON.stringify(spelled)}, the spelling its parameters give this value`
          : `${JSON.stringify(spelled)}, as ${typeId} stores this value`,
        json,
      );
    }
    return construct(json, params);
  };
  return {
    id: typeId,
    ...ifDefined('params', spec.params),
    casts,
    ...(listCast === undefined
      ? {}
      : { listCast: { of: listCast.of.map(dataTypeId), cast: listCast.cast } }),
    fromContract,
    valueFrom: <J extends JsonValue>(json: J, params: DataTypeParams) =>
      blindCast<DataTypeValue<J>, "a type's reader and spelling return JSON of the kind they read">(
        construct(spelledUnder(json, params), params),
      ),
    toContract: (value) => requireValueOf(typeId, value, `Data type ${typeId}`).value,
    ...ifDefined('equalityKey', spec.equalityKey),
  };
}

/** What is wrong with the parameters given a data type: the message to report and each parameter it refuses. */
export interface DataTypeParamsProblem {
  readonly dataType: DataTypeId;
  readonly message: string;
  readonly parameters: readonly string[];
}

/** What is wrong with `params` for `type`, or undefined when `type` accepts them or has no parameter schema. */
export function dataTypeParamsProblem(
  type: DataType,
  params: Readonly<Record<string, unknown>>,
): DataTypeParamsProblem | undefined {
  const result = type.params?.(params);
  if (!(result instanceof arktype.errors)) return undefined;
  return {
    dataType: type.id,
    message: `${type.id}: ${result.summary}`,
    parameters: [...new Set(result.map((error) => error.path.map(String).join('.')))],
  };
}

/** Refuses `params` that `type` does not accept with `CONTRACT.TYPE_PARAMS_INVALID`, naming the data type and each parameter it refuses, plus the facts in `meta`. */
export function assertDataTypeParams(
  type: DataType,
  params: Readonly<Record<string, unknown>>,
  meta: Readonly<Record<string, unknown>> = {},
): void {
  const problem = dataTypeParamsProblem(type, params);
  if (problem === undefined) return;
  throw structuredError('CONTRACT.TYPE_PARAMS_INVALID', problem.message, {
    meta: { dataType: problem.dataType, parameters: problem.parameters, ...meta },
  });
}

/** `value`, when it is a value of `type` that a data type constructed; anything else is a bug in `holder`'s caller. */
export function requireValueOf(
  type: DataTypeId,
  value: DataTypeValue,
  holder: string,
): DataTypeValue {
  if (!DataTypeValueRecord.isConstructed(value)) {
    assertOneFrameworkCopy();
    throw new InternalError(
      `${holder} takes only values of ${type}, and was handed an object no data type constructed.`,
    );
  }
  if (value.type !== type) {
    throw new InternalError(
      `${holder} takes only values of ${type}, and was handed a value of ${value.type}.`,
    );
  }
  return value;
}

/** The parameters in `typeParams` that `type` declares; keys a codec keeps for itself are dropped. */
export function dataTypeParams(type: DataType, typeParams: unknown): DataTypeParams {
  if (typeof typeParams !== 'object' || typeParams === null) return {};
  const kept: Record<string, unknown> = {};
  for (const key of objectSchemaKeys(type.params) ?? []) {
    if (Object.hasOwn(typeParams, key)) kept[key] = Reflect.get(typeParams, key);
  }
  return kept;
}

/** Whether two values are one: the same type, equal parameters, and JSON equal as canonical JSON. */
export function dataTypeValuesEqual(a: DataTypeValue, b: DataTypeValue): boolean {
  return (
    a.type === b.type &&
    canonicalizeJson(a.params) === canonicalizeJson(b.params) &&
    canonicalizeJson(a.value) === canonicalizeJson(b.value)
  );
}

type SchemaProp = { readonly key: PropertyKey; readonly kind?: unknown; readonly value?: unknown };

function isSchemaPropList(value: unknown): value is readonly SchemaProp[] {
  return (
    Array.isArray(value) &&
    value.every(
      (prop) =>
        prop !== null && (typeof prop === 'object' || typeof prop === 'function') && 'key' in prop,
    )
  );
}

function describesObjects(schema: object): boolean {
  const extendsType: unknown = Reflect.get(schema, 'extends');
  return typeof extendsType === 'function' && extendsType.call(schema, 'object') === true;
}

function objectSchemaProps(schema: unknown): readonly SchemaProp[] | undefined {
  if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function')) {
    return undefined;
  }
  if (!describesObjects(schema)) return undefined;
  const props = readProps(schema);
  return isSchemaPropList(props) ? props : undefined;
}

/** Arktype throws from `props` for a union or a morph, whose keys it cannot list. */
function readProps(schema: object): unknown {
  try {
    return Reflect.get(schema, 'props');
  } catch {
    return undefined;
  }
}

/** The keys an arktype object schema declares, or undefined when `schema` is not one. */
export function objectSchemaKeys(schema: unknown): readonly string[] | undefined {
  return objectSchemaProps(schema)?.flatMap((prop) =>
    typeof prop.key === 'string' ? [prop.key] : [],
  );
}

/** The required keys an arktype object schema declares, or undefined when `schema` is not one. */
export function requiredSchemaKeys(schema: unknown): readonly string[] | undefined {
  return objectSchemaProps(schema)?.flatMap((prop) =>
    prop.kind === 'required' && typeof prop.key === 'string' ? [prop.key] : [],
  );
}

function propAllows(prop: SchemaProp, value: unknown): boolean {
  const schema = prop.value;
  if (schema === null || (typeof schema !== 'object' && typeof schema !== 'function')) return false;
  const allows: unknown = Reflect.get(schema, 'allows');
  return typeof allows === 'function' && allows.call(schema, value) === true;
}

/** The keys of an arktype object schema whose own schema accepts `value`, or undefined when `schema` is not one. */
export function schemaKeysAllowing(schema: unknown, value: unknown): readonly string[] | undefined {
  return objectSchemaProps(schema)?.flatMap((prop) =>
    typeof prop.key === 'string' && propAllows(prop, value) ? [prop.key] : [],
  );
}

/** The parameters a data type requires. */
export function requiredParamKeys(type: DataType): readonly string[] {
  return requiredSchemaKeys(type.params) ?? [];
}

export function createDataTypeLookup(types: readonly DataType[]): DataTypeLookup {
  const byId = new Map<string, DataType>(types.map((type) => [type.id, type]));
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
  };
}

/** Collect every data type the composed components register, refusing two declarations of one id. */
export function assembleDataTypes(
  descriptors: ReadonlyArray<{
    readonly id?: string;
    readonly dataTypes?: ReadonlyArray<DataType>;
  }>,
): {
  readonly lookup: DataTypeLookup;
  readonly declared: ReadonlyArray<{ readonly type: DataType; readonly contributedBy: string }>;
} {
  const declared: { type: DataType; contributedBy: string }[] = [];
  const owners = new Map<string, string>();

  for (const descriptor of descriptors) {
    const contributedBy = descriptor.id ?? '<unknown>';
    for (const type of descriptor.dataTypes ?? []) {
      const existingOwner = owners.get(type.id);
      if (existingOwner !== undefined) {
        throw runtimeError(
          'CONTRACT.DATA_TYPE_DUPLICATE',
          `Duplicate data type "${type.id}". Component "${contributedBy}" conflicts with "${existingOwner}". ` +
            'Each data type has exactly one owner across the composed stack.',
          { dataType: type.id, contributedBy, owner: existingOwner },
        );
      }
      owners.set(type.id, contributedBy);
      declared.push({ type, contributedBy });
    }
  }

  return { lookup: createDataTypeLookup(declared.map((entry) => entry.type)), declared };
}
