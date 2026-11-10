import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import type { OpFactoryCall } from './op-factory-call';

export function renderOps(calls: ReadonlyArray<OpFactoryCall>): AnyMongoMigrationOperation[] {
  return calls.map((call) => call.toOp());
}
