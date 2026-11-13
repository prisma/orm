import { MongoParamRef, type MongoParamRefOptions } from '@internal/mongo-value';
import { rejectPlaceholder } from './prepared-placeholders';

/** Wraps a value the ORM sends as a parameter. Every ORM value goes through it, so a prepared placeholder in it is refused. */
export function ormParam(
  value: unknown,
  path: string,
  options?: MongoParamRefOptions,
): MongoParamRef {
  rejectPlaceholder(value, path);
  return new MongoParamRef(value, options);
}
