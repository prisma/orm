import type { MongoOrmCodecs } from '../src/collection';

/** Codecs for a contract without enums, in which the ORM never looks a codec up. */
export const noEnumCodecs: MongoOrmCodecs = { get: () => undefined };
