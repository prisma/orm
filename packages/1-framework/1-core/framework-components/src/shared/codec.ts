/**
 * Codec interface (consumer surface) and abstract `CodecImpl` base (codec-author surface).
 *
 * Consumers depend on the {@link Codec} interface — it describes the runtime instance returned by a descriptor's curried factory and is what the framework threads through emit, validate, and execute paths.
 *
 * Codec authors `extend` the {@link CodecImpl} abstract class to declare a typed runtime codec instance. The class carries a variance-erased descriptor reference (`CodecDescriptor<any>`); `id` proxies through the descriptor so one source of truth governs both metadata reads and aliasing semantics (alias subclasses inherit the descriptor's id automatically).
 *
 * Class generic shape: `Id`, `TTraits`, `TWire`, `TInput`. Method generics on the codec subclass's own surface (e.g. arktype-json's schema generic, pgvector's dimension generic) flow through the subclass's constructor and propagate via the descriptor's typed `factory(params)` return at *direct* call sites.
 */

import type { JsonValue } from '@internal/contract/types';
import { InternalError } from '@internal/utils/internal-error';
import type { CodecDescriptorTemplate } from './codec-descriptor';
import type { CodecCallContext, CodecTrait } from './codec-types';
import {
  type DataType,
  type DataTypeParams,
  type DataTypeValue,
  dataTypeParamsOf,
  dataTypeValueFor,
} from './data-type';

/**
 * A codec converts a value of one data type to the value an application holds, and that application value to and from what the database driver exchanges (ADR 254).
 *
 * `TInput` is the application value and `TWire` the wire value. The runtime instance carries its `id` (the descriptor's `codecId`), the {@link DataType} it converts values of, and four methods. Static metadata (`traits`) and the build-time `renderOutputType` renderer live on the {@link CodecDescriptor} keyed by `codecId`; consumers that need them resolve through `descriptorFor(codecId)`.
 *
 * Target-family codec interfaces extend this base; family-specific concerns (e.g. the SQL `column?` per-call context) layer on through the `CodecCallContext` extension pattern.
 */
export interface Codec<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> {
  /** Unique codec identifier in `namespace/name@version` format (e.g. `pg/timestamptz-temporal@1`). The factory sets this to the descriptor's `codecId`; consumers use it as a back-reference for descriptor lookups and for decode-error diagnostics. */
  readonly id: Id;
  /** Phantom carrier for the `TTraits` generic; type-only, undefined at runtime. Runtime traits live on {@link CodecDescriptor.traits}. Implemented as a string-key phantom (`__codecTraits`) rather than `unique symbol` so bundlers that split `.d.ts` chunks do not strand symbol identity on chunk-private paths (the same `TS2742` family that the public re-export of `CodecTypes` works around). */
  readonly __codecTraits?: TTraits;
  /** The data type whose values this codec converts. */
  readonly dataType: DataType;
  /**
   * Returns the application value for a value of the codec's data type. It refuses only a value the application value cannot hold exactly, such as digit text past 2^53 for a `number`, because the data type has already refused every value it does not hold; it is synchronous.
   */
  fromDataTypeValue(value: DataTypeValue): TInput;
  /**
   * Returns the value of the codec's data type that an application value is, under the codec's parameters. It builds the value through the data type, so it cannot return a value its type does not hold; it is synchronous.
   */
  toDataTypeValue(input: TInput): DataTypeValue;
  /**
   * Reads a value the database driver returns into the application value. It is asynchronous and receives the per-call {@link CodecCallContext}, which family layers may narrow (SQL adds `column`).
   */
  fromWire(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
  /**
   * Writes an application value as the value the database driver takes. It is asynchronous and receives the per-call {@link CodecCallContext}, which family layers may narrow.
   */
  toWire(input: TInput, ctx: CodecCallContext): Promise<TWire>;
}

/**
 * The application value `codec` gives for `json`, a value a contract stores for a column with the column's `typeParams`: the codec's data type reads it with the parameters it declares, and the codec converts the value.
 */
export function readContractValue(
  codec: Pick<Codec, 'dataType' | 'fromDataTypeValue'>,
  json: JsonValue,
  typeParams: unknown,
): unknown {
  return codec.fromDataTypeValue(
    codec.dataType.fromContract(json, dataTypeParamsOf(codec.dataType, typeParams)),
  );
}

function namedDataType(descriptor: object): unknown {
  return Reflect.get(descriptor, 'dataType');
}

/**
 * Abstract base class for concrete codec implementations.
 *
 * A codec is built with its descriptor, the data type it converts values of and the column's parameters of that type. `fromDataTypeValue` and `toDataTypeValue` convert between a value of the type and the application value, and `toDataTypeValue` finishes with {@link CodecImpl.dataTypeValueOf}, which constructs the value through the type. `fromWire` and `toWire` read and write what the driver exchanges, asynchronously.
 */
export abstract class CodecImpl<
  Id extends string = string,
  TTraits extends readonly CodecTrait[] = readonly CodecTrait[],
  TWire = unknown,
  TInput = unknown,
> implements Codec<Id, TTraits, TWire, TInput>
{
  /**
   * The descriptor is variance-erased: concrete codec subclasses receive the typed descriptor in their own constructors and forward it via `super(descriptor, dataType, params)`; the variance erasure lives at this base because the abstract surface can't carry the concrete `TParams`.
   */
  constructor(
    // biome-ignore lint/suspicious/noExplicitAny: variance-erased descriptor reference; subclasses retain typed access via their own state
    public readonly descriptor: CodecDescriptorTemplate<any>,
    public readonly dataType: DataType,
    protected readonly dataTypeParams: DataTypeParams = {},
  ) {
    const named = namedDataType(descriptor);
    if (named !== undefined && named !== dataType.id) {
      throw new InternalError(
        `Codec ${descriptor.codecId} is built with the data type ${dataType.id}, but its descriptor names ${String(named)}.`,
      );
    }
  }

  get id(): Id {
    return this.descriptor.codecId as Id;
  }

  /** The value of the codec's data type that `json` stores, under the codec's parameters. */
  protected dataTypeValueOf<J extends JsonValue>(json: J): DataTypeValue<J> {
    return dataTypeValueFor(this.dataType, this.dataTypeParams, json);
  }

  abstract fromDataTypeValue(value: DataTypeValue): TInput;
  abstract toDataTypeValue(input: TInput): DataTypeValue;
  abstract fromWire(wire: TWire, ctx: CodecCallContext): Promise<TInput>;
  abstract toWire(input: TInput, ctx: CodecCallContext): Promise<TWire>;
}
