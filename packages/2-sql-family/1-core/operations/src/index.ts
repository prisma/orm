import type {
  OperationDescriptor,
  OperationDescriptors,
  OperationRegistry,
} from '@internal/operations';
import { createOperationRegistry } from '@internal/operations';
import type { QueryOperationTypeEntry } from '@internal/sql-contract/types';

export interface SqlLoweringSpec {
  readonly targetFamily: 'sql';
  readonly template: string;
}

/**
 * Runtime shape of a SQL operation entry — tightened beyond the framework's
 * target-agnostic `OperationEntry` so `impl` returns a codec-exact
 * `QueryOperationReturn` instead of `unknown`. Consumers (ORM column helper,
 * sql-builder `fns` dispatch) can read `result.returnType.codecId` without a
 * cast.
 */
export type SqlOperationEntry = QueryOperationTypeEntry;

export type SqlOperationDescriptor = OperationDescriptor<SqlOperationEntry>;

export type SqlOperationDescriptors = OperationDescriptors<SqlOperationEntry>;

export type SqlOperationRegistry = OperationRegistry<SqlOperationEntry>;

export function createSqlOperationRegistry(): SqlOperationRegistry {
  return createOperationRegistry<SqlOperationEntry>();
}
