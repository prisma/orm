/**
 * Test-only helper that constructs a SQL-family `Codec` instance from author-side wire and data type value functions. Replaces the legacy public `mkCodec()` factory (deleted under TML-2357); tests that need a stub codec for behavioural assertions instantiate one through this helper rather than going through `descriptor.factory(...)`.
 */
import type { JsonValue } from '@internal/contract/types';
import {
  type CodecTrait,
  type DataType,
  type DataTypeValue,
  dataType,
  dataTypeValueFor,
} from '@internal/framework-components/codec';
import type { Codec, SqlCodecCallContext } from '@internal/sql-relational-core/ast';

type DataTypeValueConfig<TInput> = [TInput] extends [JsonValue]
  ? {
      toDataTypeValue?: (value: TInput) => JsonValue;
      fromDataTypeValue?: (value: DataTypeValue) => TInput;
    }
  : {
      toDataTypeValue: (value: TInput) => JsonValue;
      fromDataTypeValue: (value: DataTypeValue) => TInput;
    };

export function defineTestCodec<
  Id extends string,
  const TTraits extends readonly CodecTrait[] = readonly [],
  TWire = unknown,
  TInput = unknown,
>(
  config: {
    typeId: Id;
    dataType?: DataType;
    targetTypes?: readonly string[];
    toWire: (value: TInput, ctx: SqlCodecCallContext) => TWire | Promise<TWire>;
    fromWire: (wire: TWire, ctx: SqlCodecCallContext) => TInput | Promise<TInput>;
    traits?: TTraits;
  } & DataTypeValueConfig<TInput>,
): Codec<Id, TTraits, TWire, TInput> {
  const type =
    config.dataType ?? dataType(config.typeId.replace(/@[^@]*$/, ''), { read: (json) => json });
  const userToWire = config.toWire;
  const userFromWire = config.fromWire;
  const widenedConfig = config as {
    toDataTypeValue?: (value: TInput) => JsonValue;
    fromDataTypeValue?: (value: DataTypeValue) => TInput;
  };
  const toJson = widenedConfig.toDataTypeValue ?? ((value: TInput) => value as JsonValue);
  const fromValue =
    widenedConfig.fromDataTypeValue ?? ((value: DataTypeValue) => value.value as TInput);
  return {
    id: config.typeId,
    dataType: type,
    toWire: (value, ctx) => {
      try {
        return Promise.resolve(userToWire(value, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    fromWire: (wire, ctx) => {
      try {
        return Promise.resolve(userFromWire(wire, ctx));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    toDataTypeValue: (value) => dataTypeValueFor(type, {}, toJson(value)),
    fromDataTypeValue: fromValue,
  };
}
