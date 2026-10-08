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
import { InternalError } from '@internal/utils/internal-error';
import type { Type } from 'arktype';
import { canonicalizeJson } from '../utils/canonicalize-json';
import { DATA_TYPE_ID_PATTERN } from './data-type-id-pattern';
import { refuseJsonValue } from './json-readers';
import { runtimeError } from './runtime-error';

/**
 * The identity of a data type: `owner/name`, with no version. A type's identity does not change;
 * what changes over time is a representation of it, which is a codec, and codec ids carry a
 * version. The two forms differ visibly so that one string never names both.
 */
export type DataTypeId = string & { readonly __dataTypeId: 'DataTypeId' };

/**
 * A pure function from the canonical form of the type it casts from to the canonical form of the
 * type that declares it. It may throw a structured error for a value it cannot convert.
 */
export type Cast = (value: JsonValue) => JsonValue;

/**
 * How a type whose single value holds several elements takes a written list: each element's type
 * must be one of `of`, and `cast` receives the elements' canonical forms in written order.
 */
export interface ListCast {
  readonly of: readonly DataTypeId[];
  readonly cast: (elements: readonly JsonValue[]) => JsonValue;
}

/**
 * A pure function from any value the type reads to its one canonical form, for a type whose
 * values have more than one written form, such as a date written with or without a fraction. It
 * may throw a structured error for a value the type does not hold.
 */
export type ToCanonicalForm = (value: JsonValue) => JsonValue;

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
 * A value of a data type: the type's id, the parameters it holds the value under, and `value`, the JSON form `contract.json` stores. Only a data type constructs one, through {@link DataType.fromContract} and {@link DataType.withParams}. ADR 254.
 */
export type DataTypeValue<J extends JsonValue = JsonValue> = DataTypeValueRecord<J>;

/** Reads JSON the type stores, under the type's parameters, and returns it; it refuses any other JSON, and a value the parameters exclude, with `refuseJsonValue`. */
export type DataTypeReader = (json: JsonValue, params: DataTypeParams) => JsonValue;

/** The spelling a type's parameters give a value the reader accepted, for a type whose parameters change how a value is written. */
export type DataTypeSpelling = (json: JsonValue, params: DataTypeParams) => JsonValue;

export interface DataType {
  readonly id: DataTypeId;
  /** An arktype object schema of the type's parameters. A type without one has no parameters. */
  readonly params?: Type<unknown>;
  /** Keyed by the id of the type each cast takes values of. */
  readonly casts: Readonly<Record<DataTypeId, Cast>>;
  readonly listCast?: ListCast;
  /**
   * Gives a value of this type its canonical form, so two forms of one value are one value. Read it
   * through `canonicalFormOf`, which takes a codec's own form in its place.
   */
  readonly toCanonicalForm?: ToCanonicalForm;
  /** The value `json` stores under `params`. It refuses JSON the type does not store in that form, a value the parameters exclude, and JSON in a spelling other than the one the parameters give. */
  fromContract(json: JsonValue, params: DataTypeParams): DataTypeValue;
  /** The JSON `contract.json` stores for `value`. */
  toContract(value: DataTypeValue): JsonValue;
  /** `value` under `params`: it refuses a value they exclude and writes the spelling they give it. */
  withParams(value: DataTypeValue, params: DataTypeParams): DataTypeValue;
}

export interface DataTypeSpec {
  readonly params?: Type<unknown>;
  readonly casts?: Readonly<Record<string, Cast>>;
  readonly listCast?: { readonly of: readonly string[]; readonly cast: ListCast['cast'] };
  readonly toCanonicalForm?: ToCanonicalForm;
  readonly read: DataTypeReader;
  readonly spell?: DataTypeSpelling;
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

/**
 * How each declared type constructs a value from JSON it reads and spells under the parameters, keyed by the type's `fromContract`, which a declaration that spreads another (`sqlDataType`, `mongoDataType`) keeps.
 */
const valueConstructors = new WeakMap<
  DataType['fromContract'],
  (json: JsonValue, params: DataTypeParams) => DataTypeValue
>();

/** Declare a data type. Every id it names, its own and each cast's source, is validated here. */
export function dataType(id: string, spec: DataTypeSpec): DataType {
  const typeId = dataTypeId(id);
  const casts: Record<string, Cast> = {};
  for (const [source, cast] of Object.entries(spec.casts ?? {})) {
    casts[dataTypeId(source)] = cast;
  }
  const listCast = spec.listCast;
  const { read, spell } = spec;
  const ownValue = (value: DataTypeValue): DataTypeValue => {
    if (value.type !== typeId || !DataTypeValueRecord.isConstructed(value)) {
      throw new InternalError(`A value of ${value.type} was handed to the data type ${typeId}.`);
    }
    return value;
  };
  const construct = (json: JsonValue, params: DataTypeParams): DataTypeValue =>
    new DataTypeValueRecord(typeId, Object.freeze({ ...params }), json);
  const spelledUnder = (json: JsonValue, params: DataTypeParams): JsonValue => {
    const accepted = read(json, params);
    return spell === undefined ? accepted : spell(accepted, params);
  };
  const fromContract = (json: JsonValue, params: DataTypeParams): DataTypeValue => {
    const spelled = spelledUnder(json, params);
    if (canonicalizeJson(spelled) !== canonicalizeJson(json)) {
      return refuseJsonValue(
        typeId,
        `${JSON.stringify(spelled)}, the spelling its parameters give this value`,
        json,
      );
    }
    return construct(json, params);
  };
  valueConstructors.set(fromContract, (json, params) =>
    construct(spelledUnder(json, params), params),
  );
  return {
    id: typeId,
    ...ifDefined('params', spec.params),
    casts,
    ...(listCast === undefined
      ? {}
      : { listCast: { of: listCast.of.map(dataTypeId), cast: listCast.cast } }),
    ...(spec.toCanonicalForm === undefined ? {} : { toCanonicalForm: spec.toCanonicalForm }),
    fromContract,
    toContract: (value) => ownValue(value).value,
    withParams: (value, params) => construct(spelledUnder(ownValue(value).value, params), params),
  };
}

/**
 * The value of `type` that `json` gives under `params`, in the spelling the parameters give it. A codec builds every value it hands over through this, so it cannot hand over one its type does not hold.
 */
export function dataTypeValueFor<J extends JsonValue>(
  type: DataType,
  params: DataTypeParams,
  json: J,
): DataTypeValue<J> {
  const construct = valueConstructors.get(type.fromContract);
  if (construct === undefined) {
    throw new InternalError(`The data type ${type.id} was not declared with dataType().`);
  }
  return blindCast<
    DataTypeValue<J>,
    "a type's reader and spelling return JSON of the kind they read"
  >(construct(json, params));
}

/** The parameters in `typeParams` that `type` declares; keys a codec keeps for itself are dropped. */
export function dataTypeParamsOf(type: DataType, typeParams: unknown): DataTypeParams {
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

type SchemaProp = { readonly key: PropertyKey; readonly kind?: unknown };

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
