// The types an application's exported contract names when it uses this pack, so its declaration output can name them through this entry.

export { pgvectorPackMeta as default } from '../core/descriptor-meta';
export type {
  CodecTypes,
  ParameterizedOutputTypesForTypeParams,
  Vector,
} from '../types/codec-types';
export type { QueryOperationTypesForCodecs } from '../types/operation-types';
