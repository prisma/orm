import { paradedbPackMeta } from '../core/descriptor-meta';

// The types an application's exported contract names when it uses this pack, so its declaration output can name them through this entry.
export type { ParadeDbProximityChain, ProximityWithinOptions } from '../core/proximity-chain';
export type { QueryOperationTypesForCodecs } from '../types/operation-types';

const paradedbPack = paradedbPackMeta;

export default paradedbPack;
