import type { JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type DataType,
  type DataTypeValue,
  dataType,
  readContractValue,
} from '@internal/framework-components/codec';
import {
  SqlCharCodec,
  SqlFloatCodec,
  SqlIntCodec,
  SqlTextCodec,
  SqlVarcharCodec,
  sqlCharDescriptor,
  sqlFloatDescriptor,
  sqlIntDescriptor,
  sqlTextDescriptor,
  sqlVarcharDescriptor,
} from '../src/ast/sql-codecs';

type LengthParams = { readonly length?: number };

/** Stands in for the target data type a template codec is adapted with; it stores any JSON. */
function anyJsonType(id: string) {
  return dataType(id, { read: (json) => json });
}

export const sqlTextCodec = () => new SqlTextCodec(sqlTextDescriptor, anyJsonType('test/text'));
export const sqlIntCodec = () => new SqlIntCodec(sqlIntDescriptor, anyJsonType('test/int'));
export const sqlFloatCodec = () => new SqlFloatCodec(sqlFloatDescriptor, anyJsonType('test/float'));
export const sqlCharCodec = (params: LengthParams = {}) =>
  new SqlCharCodec(sqlCharDescriptor, anyJsonType('test/char'), params);
export const sqlVarcharCodec = (params: LengthParams = {}) =>
  new SqlVarcharCodec(sqlVarcharDescriptor, anyJsonType('test/varchar'), params);

/** The JSON a contract stores for `value`. */
export function storedJson<TInput>(
  codec: { readonly dataType: DataType; toDataTypeValue(value: TInput): DataTypeValue },
  value: TInput,
): JsonValue {
  return codec.dataType.toContract(codec.toDataTypeValue(value));
}

/** The application value `codec` reads from stored `json`. */
export function readStored(codec: Pick<Codec, 'dataType' | 'fromDataTypeValue'>, json: JsonValue) {
  return readContractValue(codec, json, undefined);
}
